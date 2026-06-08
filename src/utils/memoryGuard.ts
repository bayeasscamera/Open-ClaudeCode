import {
  clampLimit,
  guardArrayPush,
  guardNumeric,
  HARD_MAX_MESSAGES,
  LimitExceededError,
  MAX_FILE_READ_BYTES,
  MAX_STRING_LENGTH,
  sanitizeArray,
  sanitizeString,
} from './sanitization.js'

// ---------------------------------------------------------------------------
// Re-export all guard functions for backward compat
// ---------------------------------------------------------------------------
export {
  clampLimit,
  guardArrayPush,
  guardNumeric,
  HARD_MAX_MESSAGES,
  LimitExceededError,
  MAX_FILE_READ_BYTES,
  MAX_STRING_LENGTH,
  sanitizeArray,
  sanitizeString,
}

// ---------------------------------------------------------------------------
// Convenience helpers
// ---------------------------------------------------------------------------

/**
 * Clamp a mutable message array to a hard maximum.
 */
export function capMutableMessages(
  messages: unknown[],
  maxLength: number = HARD_MAX_MESSAGES,
): void {
  if (messages.length > maxLength) {
    messages.splice(0, messages.length - maxLength)
  }
}

/**
 * Aggregate object to null out large buffers for GC.
 */
export function releaseBuffer(obj: Record<string, unknown>, key: string): void {
  if (key in obj) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(obj as any)[key] = null
  }
}
