/**
 * Tool registry for the OPC loop.
 *
 * Per the loop-engineering spec, tools are declared centrally with:
 *   - name, description, inputSchema (JSON Schema)
 *   - execute(args, ctx) — pure-ish (no hidden state)
 *   - requiresApproval flag (Phase 4 security/approval)
 *
 * The registry is decoupled from the runner so it can be reused:
 *   - by the ReAct loop (via the existing `act` callback)
 *   - by an MCP server
 *   - by tests (mock tools without touching the runner)
 *
 * Built-in tools wrap existing OPC primitives (`file.ts`, `ripgrep.ts`,
 * `execFileNoThrow.ts`) to avoid duplication. New tools register via
 * `registerTool()` — the runner sees them through `registry.list()`.
 */

import { readFile } from 'fs/promises'
import { isAbsolute, join } from 'path'
import { execFile as execFileCb } from 'child_process'
import { promisify } from 'util'
import { actionKey } from './loopBudget.js'
import type { HumanGate } from './humanInTheLoop.js'

const execFileAsync = promisify(execFileCb)

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type JsonSchema = Record<string, unknown>

export interface ToolContext {
  /** Absolute project root — tools MUST resolve relative paths against this. */
  cwd: string
  /** Wall-clock timeout for the tool call, in ms. */
  timeoutMs: number
  /** Per-tool override; falls back to ctx.timeoutMs. */
  signal?: AbortSignal
}

export interface ToolResult<T = unknown> {
  ok: boolean
  /** Tool-specific structured payload (kept narrow — avoid `any` upstream). */
  data?: T
  /** Short human-readable detail for logs / UIs. */
  detail?: string
  durationMs: number
}

export interface Tool<TArgs = unknown> {
  name: string
  description: string
  inputSchema: JsonSchema
  /** When true, the executor routes the call through the human gate. */
  requiresApproval?: boolean
  execute(args: TArgs, ctx: ToolContext): Promise<ToolResult>
}

export type AnyTool = Tool<any>

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export class ToolRegistry {
  private readonly tools = new Map<string, AnyTool>()

  register<T>(tool: Tool<T>): this {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered`)
    }
    this.tools.set(tool.name, tool as AnyTool)
    return this
  }

  get(name: string): AnyTool | undefined {
    return this.tools.get(name)
  }

  require(name: string): AnyTool {
    const t = this.tools.get(name)
    if (!t) throw new Error(`Tool "${name}" not found in registry`)
    return t
  }

  list(): AnyTool[] {
    return [...this.tools.values()]
  }

  size(): number {
    return this.tools.size
  }

  clear(): void {
    this.tools.clear()
  }
}

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

export interface ExecutorOptions {
  /** Default timeout when the tool itself does not specify one. */
  defaultTimeoutMs?: number
  /** Human gate used when a tool has `requiresApproval: true`. */
  humanGate?: HumanGate
  /** Optional listener invoked once per execution (logs / metrics / events). */
  onExecute?: (info: {
    tool: string
    key: string
    ok: boolean
    durationMs: number
    approved: boolean
  }) => void
}

export class ToolExecutor {
  constructor(
    private readonly registry: ToolRegistry,
    private readonly opts: ExecutorOptions = {},
  ) {}

  /**
   * Resolve a tool and run it with timeout + optional approval gate.
   *
   * Approval flow:
   *   1. If `tool.requiresApproval` is true and a `humanGate` is provided,
   *      the executor asks the gate before invoking `execute()`.
   *   2. On reject / timeout, the executor returns `{ ok: false }` without
   *      calling the tool — so a refused action never reaches the system.
   */
  async call<TArgs = unknown, TData = unknown>(
    name: string,
    args: TArgs,
    overrides: Partial<ToolContext> = {},
  ): Promise<ToolResult<TData>> {
    const tool = this.registry.require(name)
    const ctx: ToolContext = {
      cwd: overrides.cwd ?? process.cwd(),
      timeoutMs: overrides.timeoutMs ?? this.opts.defaultTimeoutMs ?? 30_000,
      signal: overrides.signal,
    }
    const key = actionKey(name, args)
    const started = Date.now()
    let approved = !tool.requiresApproval

    if (tool.requiresApproval && this.opts.humanGate) {
      const decision = await this.opts.humanGate.ask({
        id: key,
        question: `Approve tool call: ${name}`,
        context: typeof args === 'object' ? JSON.stringify(args) : String(args),
        timeoutMs: ctx.timeoutMs,
      })
      approved = decision === 'approved'
      if (!approved) {
        const durationMs = Date.now() - started
        this.notify(name, key, false, durationMs, approved)
        return {
          ok: false,
          detail: `Human gate: ${decision}`,
          durationMs,
        }
      }
    }

    try {
      const result = await withTimeout(
        Promise.resolve(tool.execute(args, ctx)),
        ctx.timeoutMs,
        name,
      )
      const durationMs = Date.now() - started
      this.notify(name, key, result.ok, durationMs, approved)
      return result as ToolResult<TData>
    } catch (e) {
      const durationMs = Date.now() - started
      const message = e instanceof Error ? e.message : String(e)
      this.notify(name, key, false, durationMs, approved)
      return { ok: false, detail: message, durationMs }
    }
  }

  private notify(
    tool: string,
    key: string,
    ok: boolean,
    durationMs: number,
    approved: boolean,
  ): void {
    try {
      this.opts.onExecute?.({ tool, key, ok, durationMs, approved })
    } catch {
      /* never let a listener break the loop */
    }
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  if (ms <= 0) return p
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Tool "${label}" timed out after ${ms}ms`)), ms)
    t.unref?.()
    p.then(
      v => {
        clearTimeout(t)
        resolve(v)
      },
      e => {
        clearTimeout(t)
        reject(e instanceof Error ? e : new Error(String(e)))
      },
    )
  })
}

// ---------------------------------------------------------------------------
// Built-in tools — thin wrappers over existing OPC primitives.
// Keep these minimal; rich variants belong in their own modules.
// ---------------------------------------------------------------------------

export const readFileTool: Tool<{ path: string }> = {
  name: 'read_file',
  description: 'Read a UTF-8 text file. Path is relative to the project root unless absolute.',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Relative (to cwd) or absolute path' },
    },
    required: ['path'],
    additionalProperties: false,
  },
  execute: async ({ path }, ctx) => {
    const abs = isAbsolute(path) ? path : join(ctx.cwd, path)
    try {
      const content = await readFile(abs, 'utf-8')
      return {
        ok: true,
        data: { path: abs, content },
        detail: `Read ${abs} (${content.length} chars)`,
        durationMs: 0,
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      return { ok: false, detail: `read_file failed: ${message}`, durationMs: 0 }
    }
  },
}

export const runCommandTool: Tool<{ command: string; args?: string[]; expectExitCode?: number }> = {
  name: 'run_command',
  description: 'Run a shell command and return its stdout / stderr / exit code.',
  inputSchema: {
    type: 'object',
    properties: {
      command: { type: 'string' },
      args: { type: 'array', items: { type: 'string' } },
      expectExitCode: { type: 'integer', default: 0 },
    },
    required: ['command'],
    additionalProperties: false,
  },
  // Destructive by nature: ask the human before running.
  requiresApproval: true,
  execute: async ({ command, args = [], expectExitCode = 0 }, ctx) => {
    const started = Date.now()
    try {
      const { stdout, stderr } = await execFileAsync(command, args, {
        cwd: ctx.cwd,
        timeout: ctx.timeoutMs,
        maxBuffer: 10 * 1024 * 1024,
      })
      return {
        ok: true,
        data: { exitCode: 0, stdout, stderr },
        detail: `${command} ${args.join(' ')} → 0`,
        durationMs: Date.now() - started,
      }
    } catch (e) {
      const err = e as { code?: number | string; stdout?: string; stderr?: string; message?: string }
      const actualExit = typeof err.code === 'number' ? err.code : -1
      return {
        ok: actualExit === expectExitCode,
        data: { exitCode: actualExit, stdout: err.stdout ?? '', stderr: err.stderr ?? '' },
        detail: `${command} ${args.join(' ')} → ${actualExit}`,
        durationMs: Date.now() - started,
      }
    }
  },
}

export const grepTool: Tool<{ pattern: string; path?: string }> = {
  name: 'grep',
  description: 'Search a regex pattern in files. Default scope: project root.',
  inputSchema: {
    type: 'object',
    properties: {
      pattern: { type: 'string' },
      path: { type: 'string' },
    },
    required: ['pattern'],
    additionalProperties: false,
  },
  execute: async ({ pattern, path }, ctx) => {
    // Local ripgrep invocation — keeps the tool self-contained for tests.
    // The richer OPC wrapper lives in src/utils/ripgrep.ts.
    const searchPath = path ?? ctx.cwd
    const args = ['--line-number', '--no-heading', '-e', pattern, searchPath]
    const started = Date.now()
    try {
      const { stdout } = await execFileAsync('rg', args, {
        cwd: ctx.cwd,
        timeout: ctx.timeoutMs,
        maxBuffer: 10 * 1024 * 1024,
      })
      return {
        ok: true,
        data: { matches: stdout },
        detail: `${stdout.split('\n').filter(Boolean).length} match(es)`,
        durationMs: Date.now() - started,
      }
    } catch (e) {
      // rg exits 1 when no matches — that's a valid "no hits" outcome.
      const err = e as { code?: number | string; stdout?: string }
      if (err.code === 1) {
        return {
          ok: true,
          data: { matches: '' },
          detail: 'No matches',
          durationMs: Date.now() - started,
        }
      }
      const message = e instanceof Error ? e.message : String(e)
      return { ok: false, detail: `grep failed: ${message}`, durationMs: Date.now() - started }
    }
  },
}

/**
 * One-liner to bootstrap a registry with the default built-in tools.
 */
export function defaultRegistry(): ToolRegistry {
  return new ToolRegistry().register(readFileTool).register(runCommandTool).register(grepTool)
}
