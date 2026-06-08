/**
 * Centralized resource limits for OPC.
 *
 * These constants define hard/soft caps on file reads, array lengths, and string
 * sizes to prevent unbounded growth and OOMs in long-running sessions.
 */

/** Maximum bytes to read from a file in one operation. */
export const MAX_FILE_READ_BYTES = 50 * 1024 * 1024 // 50 MB

/** Maximum length for any array that could grow unbounded. */
export const MAX_ARRAY_LENGTH = 100_000

/** Maximum character length for any generic string. */
export const MAX_STRING_LENGTH = 100_000

/** Hard cap for mutable message store to prevent unbounded memory growth. */
export const HARD_MAX_MESSAGES = 10_000

/** Maximum transcript write batch size (bytes). */
export const MAX_TRANSCRIPT_BATCH_BYTES = 100 * 1024 * 1024 // 100 MB

/** Maximum CLI stdout capture. */
export const MAX_STDOUT_BYTES = 1024 * 1024 // 1 MB

/** Maximum CLI stderr capture. */
export const MAX_STDERR_BYTES = 256 * 1024 // 256 KB
