import { truncateToWidth } from '../utils/format.js'

const TITLE_MAX_LEN = 80

/** Derive a session title from a user message: first line, truncated. */
export function deriveSessionTitle(text: string): string {
  // Collapse whitespace — newlines/tabs would break the single-line status display.
  const flat = text.replace(/\s+/g, ' ').trim()
  return truncateToWidth(flat, TITLE_MAX_LEN)
}
