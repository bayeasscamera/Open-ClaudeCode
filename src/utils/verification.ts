import { execFile } from 'child_process'
import { existsSync } from 'fs'
import { readFile } from 'fs/promises'
import { join, isAbsolute } from 'path'
import { promisify } from 'util'
import { getProjectRoot } from '../bootstrap/state.js'
import { appendMemory } from './memory.js'

const execFileAsync = promisify(execFile)

/**
 * Verification layer for the OPC loop.
 *
 * Each Criterion is an atomic, declarative check. The loop consumes the
 * resulting VerificationReport to decide between continue / retry / escalate.
 */

export type Criterion =
  | {
      type: 'command'
      command: string
      args?: string[]
      cwd?: string
      expectExitCode?: number
      timeoutMs?: number
    }
  | {
      type: 'fileExists'
      path: string
    }
  | {
      type: 'fileContains'
      path: string
      substring: string
    }
  | {
      type: 'custom'
      name: string
      check: () => Promise<{ passed: boolean; detail?: string }>
    }

export interface VerificationResult {
  criterion: Criterion
  passed: boolean
  exitCode?: number
  stdout?: string
  stderr?: string
  detail?: string
  durationMs: number
  timestamp: string
  error?: string
}

export interface VerificationReport {
  results: VerificationResult[]
  allPassed: boolean
  startedAt: string
  finishedAt: string
  totalDurationMs: number
}

export const DEFAULT_VERIFY_COMMAND = 'npm'
export const DEFAULT_VERIFY_ARGS: string[] = ['run', 'verify:ci']
export const DEFAULT_VERIFY_TIMEOUT_MS = 300_000

const STDERR_HEAD_LINES = 8
const STDOUT_HEAD_LINES = 4

function resolveProjectPath(p: string): string {
  if (isAbsolute(p)) return p
  return join(getProjectRoot(), p)
}

function trimForLog(s: string | undefined, headLines: number): string {
  if (!s) return ''
  return s.split('\n').slice(0, headLines).join('\n')
}

export async function runCriterion(criterion: Criterion): Promise<VerificationResult> {
  const timestamp = new Date().toISOString()
  const start = Date.now()

  try {
    if (criterion.type === 'command') {
      const {
        command,
        args = [],
        cwd,
        expectExitCode = 0,
        timeoutMs = 120_000,
      } = criterion

      try {
        const { stdout, stderr } = await execFileAsync(command, args, {
          cwd: cwd ?? getProjectRoot(),
          timeout: timeoutMs,
          maxBuffer: 10 * 1024 * 1024,
        })
        return {
          criterion,
          passed: true,
          exitCode: 0,
          stdout,
          stderr,
          durationMs: Date.now() - start,
          timestamp,
        }
      } catch (e) {
        const err = e as {
          code?: number | string
          stdout?: string
          stderr?: string
          message?: string
        }
        const actualExit =
          typeof err.code === 'number' ? err.code : undefined
        return {
          criterion,
          passed: actualExit === expectExitCode,
          exitCode: actualExit,
          stdout: err.stdout ?? '',
          stderr: err.stderr ?? err.message ?? '',
          durationMs: Date.now() - start,
          timestamp,
          error: err.message,
        }
      }
    }

    if (criterion.type === 'fileExists') {
      const path = resolveProjectPath(criterion.path)
      const exists = existsSync(path)
      return {
        criterion,
        passed: exists,
        detail: exists ? `Found: ${path}` : `Missing: ${path}`,
        durationMs: Date.now() - start,
        timestamp,
      }
    }

    if (criterion.type === 'fileContains') {
      const path = resolveProjectPath(criterion.path)
      if (!existsSync(path)) {
        return {
          criterion,
          passed: false,
          detail: `File missing: ${path}`,
          durationMs: Date.now() - start,
          timestamp,
        }
      }
      const content = await readFile(path, 'utf-8')
      const passed = content.includes(criterion.substring)
      return {
        criterion,
        passed,
        detail: passed
          ? `Substring found in ${path}`
          : `Substring not found in ${path}`,
        durationMs: Date.now() - start,
        timestamp,
      }
    }

    if (criterion.type === 'custom') {
      const { passed, detail } = await criterion.check()
      return {
        criterion,
        passed,
        detail,
        durationMs: Date.now() - start,
        timestamp,
      }
    }

    // Exhaustiveness guard. If a new Criterion variant is added and this line
    // is reached, TypeScript will fail to compile.
    const exhaustive: never = criterion
    throw new Error(
      `Unknown criterion type: ${JSON.stringify(exhaustive)}`,
    )
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return {
      criterion,
      passed: false,
      detail: message,
      durationMs: Date.now() - start,
      timestamp,
      error: message,
    }
  }
}

export async function runVerification(
  criteria: Criterion[],
): Promise<VerificationReport> {
  const startedAt = new Date().toISOString()
  const start = Date.now()
  const results: VerificationResult[] = []

  for (const criterion of criteria) {
    results.push(await runCriterion(criterion))
  }

  return {
    results,
    allPassed: results.every(r => r.passed),
    startedAt,
    finishedAt: new Date().toISOString(),
    totalDurationMs: Date.now() - start,
  }
}

/**
 * Run the project-level verify:ci gate. Logs outcome to memory for traceability.
 */
export async function verifyProject(): Promise<VerificationReport> {
  const report = await runVerification([
    {
      type: 'command',
      command: DEFAULT_VERIFY_COMMAND,
      args: DEFAULT_VERIFY_ARGS,
      timeoutMs: DEFAULT_VERIFY_TIMEOUT_MS,
    },
  ])

  const tag = report.allPassed ? 'PASS' : 'FAIL'
  const firstFail = report.results.find(r => !r.passed)
  const detail = firstFail
    ? trimForLog(firstFail.stderr, STDERR_HEAD_LINES)
    : 'all checks passed'

  appendMemory(
    'Loop verification',
    `verify:ci → ${tag} (${report.totalDurationMs}ms)\n${detail}`,
  )

  return report
}

function describeCriterion(c: Criterion): string {
  switch (c.type) {
    case 'command':
      return `command: ${c.command} ${(c.args ?? []).join(' ')}`
    case 'fileExists':
      return `fileExists: ${c.path}`
    case 'fileContains':
      return `fileContains: ${c.path} ⊇ "${c.substring}"`
    case 'custom':
      return `custom: ${c.name}`
  }
}

export function formatReport(report: VerificationReport): string {
  const lines: string[] = []
  lines.push(
    `Verification ${report.startedAt} → ${report.finishedAt} (${report.totalDurationMs}ms) — ${report.allPassed ? 'PASS' : 'FAIL'}`,
  )
  for (const r of report.results) {
    const tag = r.passed ? '[OK]  ' : '[FAIL]'
    lines.push(`${tag} (${r.durationMs}ms) ${describeCriterion(r.criterion)}`)
    if (r.detail) {
      lines.push(`        ${r.detail}`)
    }
    if (!r.passed && r.stderr) {
      const trimmed = trimForLog(r.stderr, STDERR_HEAD_LINES)
      if (trimmed) {
        lines.push(`        stderr: ${trimmed}`)
      }
    }
    if (!r.passed && r.stdout) {
      const trimmed = trimForLog(r.stdout, STDOUT_HEAD_LINES)
      if (trimmed) {
        lines.push(`        stdout: ${trimmed}`)
      }
    }
  }
  return lines.join('\n')
}
