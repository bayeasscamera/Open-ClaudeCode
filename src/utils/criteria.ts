import type { Criterion } from './verification.js'

/**
 * Rich DSL for declarative criteria.
 *
 * Each non-empty, non-comment line of a task text is parsed into a Criterion.
 * Supported line shapes (case-insensitive prefix, colon is mandatory):
 *
 *   fileExists: <relative-or-absolute-path>
 *   fileContains: <path> | <substring>
 *   matchRegex: <path> | /<pattern>/<flags>
 *   command: <executable> [arg1 arg2 ...]
 *   lines: <path> == <n>     (or <, <=, >, >=, !=)
 *   not: <single criterion line without its own "not:">
 *   all: <criterion1>, <criterion2>, ...   (logical AND of inline criteria)
 *
 * Anything starting with `#` is a comment. Blank lines are ignored.
 *
 * Unparseable lines are collected into `parseErrors` so the caller can
 * surface them instead of silently dropping malformed tasks.
 */

export interface ParseResult {
  criteria: Criterion[]
  /** Lines that could not be interpreted, with their 1-based line number. */
  parseErrors: { line: number; text: string; reason: string }[]
}

const PREFIX_RE = /^\s*([a-zA-Z]+)\s*:\s*(.*)$/

function stripComment(line: string): string {
  // Treat '#' as comment only when it starts the trimmed line — avoids
  // misinterpreting substrings like "command: echo '#hello'".
  const t = line.trim()
  if (t.startsWith('#')) return ''
  return line
}

function splitOnFirstPipe(s: string): [string, string] | null {
  const idx = s.indexOf('|')
  if (idx === -1) return null
  return [s.slice(0, idx).trim(), s.slice(idx + 1).trim()]
}

function parseRegexLiteral(s: string): { pattern: string; flags: string } | null {
  // Expected: /pattern/flags
  const m = s.match(/^\/(.+)\/([a-z]*)$/)
  if (!m) return null
  return { pattern: m[1] ?? '', flags: m[2] ?? '' }
}

function parseCountOp(
  op: string,
): 'eq' | 'lt' | 'lte' | 'gt' | 'gte' | 'neq' | null {
  switch (op) {
    case '==':
    case '=':
      return 'eq'
    case '!=':
    case '<>':
      return 'neq'
    case '<':
      return 'lt'
    case '<=':
      return 'lte'
    case '>':
      return 'gt'
    case '>=':
      return 'gte'
    default:
      return null
  }
}

function parseOneLine(line: string): Criterion | Criterion[] | null {
  const m = PREFIX_RE.exec(line)
  if (!m) return null
  const prefix = (m[1] ?? '').toLowerCase()
  const rest = (m[2] ?? '').trim()
  if (!rest) return null

  switch (prefix) {
    case 'fileexists': {
      return { type: 'fileExists', path: rest }
    }

    case 'filecontains': {
      const parts = splitOnFirstPipe(rest)
      if (!parts) return null
      const [path, substring] = parts
      if (!path || !substring) return null
      return { type: 'fileContains', path, substring }
    }

    case 'matchregex': {
      const parts = splitOnFirstPipe(rest)
      if (!parts) return null
      const [path, regexLit] = parts
      const parsed = parseRegexLiteral(regexLit ?? '')
      if (!path || !parsed) return null
      const re = new RegExp(parsed.pattern, parsed.flags)
      // Encoded as a custom criterion so the runner can handle I/O and
      // regex matching without leaking into the public Criterion union.
      return {
        type: 'custom',
        name: `matchRegex:${path}`,
        check: async () => {
          const { existsSync } = await import('fs')
          const { readFile } = await import('fs/promises')
          const { isAbsolute, join } = await import('path')
          const { getProjectRoot } = await import('../bootstrap/state.js')
          const abs = isAbsolute(path) ? path : join(getProjectRoot(), path)
          if (!existsSync(abs)) {
            return { passed: false, detail: `File missing: ${abs}` }
          }
          const content = await readFile(abs, 'utf-8')
          const passed = re.test(content)
          return {
            passed,
            detail: passed
              ? `Pattern matched in ${abs}`
              : `Pattern did not match in ${abs}`,
          }
        },
      }
    }

    case 'command': {
      const parts = rest.split(/\s+/).filter(Boolean)
      const [command, ...args] = parts
      if (!command) return null
      return { type: 'command', command, args }
    }

    case 'lines': {
      // lines: <path> <op> <n>
      const tokens = rest.split(/\s+/).filter(Boolean)
      if (tokens.length < 3) return null
      const [path, opRaw, nRaw, ...rest2] = tokens
      if (!path || !opRaw || !nRaw || rest2.length > 0) return null
      const op = parseCountOp(opRaw)
      const expected = Number.parseInt(nRaw, 10)
      if (!op || !Number.isFinite(expected)) return null
      return {
        type: 'custom',
        name: `lines:${path}:${opRaw}:${expected}`,
        check: async () => {
          const { existsSync } = await import('fs')
          const { readFile } = await import('fs/promises')
          const { isAbsolute, join } = await import('path')
          const { getProjectRoot } = await import('../bootstrap/state.js')
          const abs = isAbsolute(path) ? path : join(getProjectRoot(), path)
          if (!existsSync(abs)) {
            return { passed: false, detail: `File missing: ${abs}` }
          }
          const content = await readFile(abs, 'utf-8')
          const actual = content.split('\n').length
          const ops: Record<typeof op, (a: number, b: number) => boolean> = {
            eq: (a, b) => a === b,
            neq: (a, b) => a !== b,
            lt: (a, b) => a < b,
            lte: (a, b) => a <= b,
            gt: (a, b) => a > b,
            gte: (a, b) => a >= b,
          }
          const passed = ops[op](actual, expected)
          return {
            passed,
            detail: `lines(${abs}) = ${actual} ${opRaw} ${expected} → ${passed ? 'OK' : 'FAIL'}`,
          }
        },
      }
    }

    case 'all': {
      // Inline aggregation: each comma-separated piece must parse as a
      // single Criterion. If any piece fails, the whole `all:` is null
      // (caller sees it as a parse error).
      const pieces = rest
        .split(',')
        .map(p => p.trim())
        .filter(Boolean)
      const out: Criterion[] = []
      for (const piece of pieces) {
        const c = parseOneLine(piece)
        if (!c) return null
        if (Array.isArray(c)) return null // nested `all:` not allowed
        out.push(c)
      }
      if (out.length === 0) return null
      return out
    }

    case 'not': {
      const inner = parseOneLine(rest)
      if (!inner) return null
      if (Array.isArray(inner)) return null // can't negate a group
      return {
        type: 'custom',
        name: `not:${inner.type}`,
        check: async () => {
          const { runCriterion } = await import('./verification.js')
          const r = await runCriterion(inner)
          return {
            passed: !r.passed,
            detail: r.passed
              ? `NOT expected failure but criterion passed: ${r.detail ?? ''}`
              : `NOT satisfied: ${r.detail ?? 'criterion failed as expected'}`,
          }
        },
      }
    }

    default:
      return null
  }
}

export function parseCriteriaFromTaskText(text: string): ParseResult {
  const criteria: Criterion[] = []
  const parseErrors: ParseResult['parseErrors'] = []

  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i += 1) {
    const raw = stripComment(lines[i] ?? '')
    if (!raw.trim()) continue
    const parsed = parseOneLine(raw)
    if (parsed === null) {
      parseErrors.push({
        line: i + 1,
        text: raw,
        reason: 'Unrecognized directive (expected fileExists:, fileContains:, matchRegex:, command:, lines:, all:, not:)',
      })
      continue
    }
    if (Array.isArray(parsed)) {
      criteria.push(...parsed)
    } else {
      criteria.push(parsed)
    }
  }

  return { criteria, parseErrors }
}
