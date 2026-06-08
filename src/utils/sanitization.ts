/**
 * Unicode Sanitization for Hidden Character Attack Mitigation
 *
 * This module implements security measures against Unicode-based hidden character attacks,
 * specifically targeting ASCII Smuggling and Hidden Prompt Injection vulnerabilities.
 * These attacks use invisible Unicode characters (such as Tag characters, format controls,
 * private use areas, and noncharacters) to hide malicious instructions that are invisible
 * to users but processed by AI models.
 *
 * The vulnerability was demonstrated in HackerOne report #3086545 targeting Claude Desktop's
 * MCP (Model Context Protocol) implementation, where attackers could inject hidden instructions
 * using Unicode Tag characters that would be executed by Claude but remain invisible to users.
 *
 * Reference: https://embracethered.com/blog/posts/2024/hiding-and-finding-text-with-unicode-tags/
 *
 * This implementation provides comprehensive protection by:
 * 1. Applying NFKC Unicode normalization to handle composed character sequences
 * 2. Removing dangerous Unicode categories while preserving legitimate text and formatting
 * 3. Supporting recursive sanitization of complex nested data structures
 * 4. Maintaining performance with efficient regex processing
 *
 * The sanitization is always enabled to protect against these attacks.
 */

export function partiallySanitizeUnicode(prompt: string): string {
  let current = prompt
  let previous = ''
  let iterations = 0
  const MAX_ITERATIONS = 10 // Safety limit to prevent infinite loops

  // Iteratively sanitize until no more changes occur or max iterations reached
  while (current !== previous && iterations < MAX_ITERATIONS) {
    previous = current

    // Apply NFKC normalization to handle composed character sequences
    current = current.normalize('NFKC')

    // Remove dangerous Unicode categories using explicit character ranges

    // Method 1: Strip dangerous Unicode property classes
    // This is the primary defence and is the solution that is widely used in OSS libraries.
    current = current.replace(/[\p{Cf}\p{Co}\p{Cn}]/gu, '')

    // Method 2: Explicit character ranges. There are some subtle issues with the above method
    // failing in certain environments that don't support regexes for unicode property classes,
    // so we also implement a fallback that strips out some specifically known dangerous ranges.
    current = current
      .replace(/[\u200B-\u200F]/g, '') // Zero-width spaces, LTR/RTL marks
      .replace(/[\u202A-\u202E]/g, '') // Directional formatting characters
      .replace(/[\u2066-\u2069]/g, '') // Directional isolates
      .replace(/[\uFEFF]/g, '') // Byte order mark
      .replace(/[\uE000-\uF8FF]/g, '') // Basic Multilingual Plane private use

    iterations++
  }

  // If we hit max iterations, crash loudly. This should only ever happen if there is a bug or if someone purposefully created a deeply nested unicode string.
  if (iterations >= MAX_ITERATIONS) {
    throw new Error(
      `Unicode sanitization reached maximum iterations (${MAX_ITERATIONS}) for input: ${prompt.slice(0, 100)}`,
    )
  }

  return current
}

export function recursivelySanitizeUnicode(value: string): string
export function recursivelySanitizeUnicode<T>(value: T[]): T[]
export function recursivelySanitizeUnicode<T extends object>(value: T): T
export function recursivelySanitizeUnicode<T>(value: T): T
export function recursivelySanitizeUnicode(value: unknown): unknown {
  if (typeof value === 'string') {
    return partiallySanitizeUnicode(value)
  }

  if (Array.isArray(value)) {
    return value.map(recursivelySanitizeUnicode)
  }

  if (value !== null && typeof value === 'object') {
    const sanitized: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value)) {
      sanitized[recursivelySanitizeUnicode(key)] =
        recursivelySanitizeUnicode(val)
    }
    return sanitized
  }

  // Return other primitive values (numbers, booleans, null, undefined) unchanged
  return value
}

// ---------------------------------------------------------------------------
// Input guards for size limits and null-byte stripping
// ---------------------------------------------------------------------------

import { logError } from './log.js'

/** Max characters in a single message content string. */
export const MAX_MESSAGE_LENGTH = 50_000
/** Max bytes to read from a file in one shot. */
export const MAX_FILE_READ_BYTES = 50 * 1024 * 1024
/** Max items in an array before truncation. */
export const MAX_ARRAY_LENGTH = 100_000
/** Max characters in any generic string. */
export const MAX_STRING_LENGTH = 100_000
/** Hard cap for mutableMessages store to prevent unbounded growth. */
export const HARD_MAX_MESSAGES = 10_000

/**
 * Sanitize a string by trimming, stripping null bytes, and clamping length.
 */
export function sanitizeString(
  input: unknown,
  maxLength: number = MAX_STRING_LENGTH,
): string {
  if (input === null || input === undefined) return ''
  let text = String(input)
  text = text.replace(/\x00/g, '')
  text = text.trim()
  if (text.length > maxLength) text = text.slice(0, maxLength)
  return text
}

/**
 * Sanitize an array by capping its length.
 */
export function sanitizeArray<T>(
  arr: T[],
  maxLength: number = MAX_ARRAY_LENGTH,
): T[] {
  if (!Array.isArray(arr)) return []
  return arr.length <= maxLength ? arr : arr.slice(0, maxLength)
}

/**
 * Safe array push that caps the array size.
 */
export function guardArrayPush<T>(
  arr: T[],
  item: T,
  maxLength: number = HARD_MAX_MESSAGES,
): T[] {
  arr.push(item)
  if (arr.length > maxLength) {
    arr.splice(0, arr.length - maxLength)
  }
  return arr
}

/**
 * Error thrown when a value exceeds a defined limit.
 */
export class LimitExceededError extends Error {
  constructor(
    public readonly valueName: string,
    public readonly value: number,
    public readonly limit: number,
  ) {
    super(`${valueName} exceeds limit: ${value} > ${limit}`)
    this.name = 'LimitExceededError'
  }
}

/**
 * Validate that a value is within bounds, log and cap if exceeded.
 */
export function guardNumeric(
  value: number,
  limit: number,
  name: string,
): number {
  if (!Number.isFinite(value) || value < 0) return 0
  if (value > limit) {
    logError(new LimitExceededError(name, value, limit))
    return limit
  }
  return value
}

/**
 * Clamp a numeric value to [0, limit].
 */
export function clampLimit(value: number, limit: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(Math.max(0, value), limit)
}
