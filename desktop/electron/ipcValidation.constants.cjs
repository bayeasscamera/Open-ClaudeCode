/**
 * ipcValidation.constants.cjs
 *
 * Named constants extracted from ipcValidation.cjs so the input bounds are
 * discoverable, testable, and can be referenced (not duplicated) by callers.
 *
 * Layout:
 *  - Text length caps (per-field, grouped by payload kind)
 *  - Array length caps (per-collection)
 *  - Numeric clamps (range bounds for numbers)
 *  - Whitelists (permission modes, command-intent sources, state search types,
 *    local-only HTTP hostnames)
 *
 * Stability: these are part of the IPC contract — changing a value can
 * shift what the renderer is allowed to send. Treat as a breaking change.
 */

// ---------------------------------------------------------------------------
// Text length caps
// ---------------------------------------------------------------------------

/** Hard ceiling for the run prompt (user message forwarded to the CLI). */
const MAX_PROMPT_CHARS = 500_000

/** Default text ceiling for short free-form strings (path, name, error...). */
const MAX_STRING_CHARS = 4096

/** Refine-prompt IPC accepts a longer input — it is rewritten by the LLM. */
const MAX_REFINE_PROMPT_CHARS = 20_000

/** Per-tool string passed via the allowedTools allow-list. */
const MAX_TOOL_NAME_CHARS = 1000

/** Per-command string after normalization (strips quotes / whitespace). */
const MAX_COMMAND_CHARS = 1000

/** Bounded inputs the user can type — IDs, paths, modes. */
const MAX_SHORT_ID_CHARS = 120
const MAX_MEDIUM_TEXT_CHARS = 240
const MAX_LONG_TEXT_CHARS = 256

/** Permission-mode / effort / role / transport / search-type freeform tags. */
const MAX_TAG_CHARS = 40

/** Human-readable reason / description freeform. */
const MAX_REASON_CHARS = 240
const MAX_DESCRIPTION_CHARS = 800
const MAX_QUERY_CHARS = 600
const MAX_ERROR_CHARS = 400
const MAX_SUMMARY_CHARS = 1200

/** Project-file indexedAt timestamp / cache header. */
const MAX_INDEXED_AT_CHARS = 120

/** Project-file snippet text (chunk) — each snippet is a paragraph. */
const MAX_SNIPPET_CHARS = 300
const MAX_SNIPPETS = 4

/** Project-file keyword / heading text. */
const MAX_KEYWORD_CHARS = 80
const MAX_KEYWORDS = 10
const MAX_HEADING_CHARS = 180
const MAX_HEADINGS = 6

/** Probe-service friendly name. */
const MAX_SERVICE_NAME_CHARS = 80

/** Provider / model identifiers. */
const MAX_MODEL_CHARS = 256

// ---------------------------------------------------------------------------
// Array length caps
// ---------------------------------------------------------------------------

/** Max number of tasks accepted by a probe-services payload. */
const MAX_TASKS = 20

/** Max services per task. */
const MAX_SERVICES_PER_TASK = 20

/** Max project-context files attached to a run payload. */
const MAX_PROJECT_CONTEXT_FILES = 20

/** Max allowedTools entries after normalization. */
const MAX_ALLOWED_TOOLS = 80

/** Max models in a pause request. */
const MAX_PAUSE_MODELS = 80

/** Max state-search result cap. */
const STATE_SEARCH_LIMIT_MIN = 1
const STATE_SEARCH_LIMIT_MAX = 50
const STATE_SEARCH_DEFAULT_LIMIT = 10

// ---------------------------------------------------------------------------
// Numeric clamps
// ---------------------------------------------------------------------------

/** Claude Code rejects > 999 turns; we cap at 1000 to stay predictable. */
const MAX_TURNS = 1000

/** Sanity ceiling for maxBudgetUsd — avoid Number.MAX_VALUE leaks. */
const MAX_BUDGET_USD = 10_000

/** Clamp for normalizeMaxTurns / normalizeMaxBudgetUsd. */
const PID_MIN = 1
/** PID upper bound — well below Number.MAX_SAFE_INTEGER to keep JSON safe. */
const PID_MAX = Number.MAX_SAFE_INTEGER

// ---------------------------------------------------------------------------
// Whitelists
// ---------------------------------------------------------------------------

/** Commands the user can pin as "trusted bypass" without re-prompting. */
const TRUSTED_BYPASS_COMMANDS = Object.freeze([
  'pnpm tools-dev start',
  'pnpm tools-dev run web',
  'pnpm tools-dev dev',
  'npm run dev',
  'npm run start',
  'pnpm dev',
  'pnpm start',
])

/** Valid Claude Code permission modes. */
const PERMISSION_MODES = Object.freeze(new Set([
  'default',
  'acceptEdits',
  'auto',
  'plan',
  'dontAsk',
  'bypassPermissions',
]))

/** Permission modes that effectively bypass the prompt. */
const BYPASS_PERMISSION_MODES = Object.freeze(new Set([
  'acceptEdits',
  'auto',
  'dontAsk',
  'bypassPermissions',
]))

/** Sources allowed in a commandIntent payload. */
const COMMAND_INTENT_SOURCES = Object.freeze(new Set([
  'prompt',
  'tool-history',
  'message-intent',
]))

/** State search types accepted by the state search IPC. */
const STATE_SEARCH_TYPES = Object.freeze(new Set([
  'messages',
  'project_files',
]))

/** Hostnames considered local for URL opening from the renderer. */
const LOCAL_HTTP_HOSTNAMES = Object.freeze([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  '[::1]',
])

/** Default permission mode for normalizePermissionMode when input is invalid. */
const DEFAULT_PERMISSION_MODE = 'default'

module.exports = {
  // text caps
  MAX_PROMPT_CHARS,
  MAX_STRING_CHARS,
  MAX_REFINE_PROMPT_CHARS,
  MAX_TOOL_NAME_CHARS,
  MAX_COMMAND_CHARS,
  MAX_SHORT_ID_CHARS,
  MAX_MEDIUM_TEXT_CHARS,
  MAX_LONG_TEXT_CHARS,
  MAX_TAG_CHARS,
  MAX_REASON_CHARS,
  MAX_DESCRIPTION_CHARS,
  MAX_QUERY_CHARS,
  MAX_ERROR_CHARS,
  MAX_SUMMARY_CHARS,
  MAX_INDEXED_AT_CHARS,
  MAX_SNIPPET_CHARS,
  MAX_SNIPPETS,
  MAX_KEYWORD_CHARS,
  MAX_KEYWORDS,
  MAX_HEADING_CHARS,
  MAX_HEADINGS,
  MAX_SERVICE_NAME_CHARS,
  MAX_MODEL_CHARS,
  // array caps
  MAX_TASKS,
  MAX_SERVICES_PER_TASK,
  MAX_PROJECT_CONTEXT_FILES,
  MAX_ALLOWED_TOOLS,
  MAX_PAUSE_MODELS,
  STATE_SEARCH_LIMIT_MIN,
  STATE_SEARCH_LIMIT_MAX,
  STATE_SEARCH_DEFAULT_LIMIT,
  // numeric clamps
  MAX_TURNS,
  MAX_BUDGET_USD,
  PID_MIN,
  PID_MAX,
  // whitelists
  TRUSTED_BYPASS_COMMANDS,
  PERMISSION_MODES,
  BYPASS_PERMISSION_MODES,
  COMMAND_INTENT_SOURCES,
  STATE_SEARCH_TYPES,
  LOCAL_HTTP_HOSTNAMES,
  DEFAULT_PERMISSION_MODE,
}
