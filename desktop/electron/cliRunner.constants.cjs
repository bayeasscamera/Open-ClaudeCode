// Named constants for the CLI runner. Centralising these values lets tests
// pin the contract, lets ops tune behaviour without touching logic, and keeps
// cliRunner.cjs focused on orchestration.
//
// Grouped by concern (timeouts, payload caps, runtime cadence, exit codes,
// validation clamps). All values are positive integers or string sets and
// must not embed user-controlled input.

// ── Idle watchdog ─────────────────────────────────────────────────────────
const DEFAULT_IDLE_TIMEOUT_MS = 300000
const DEFAULT_LONG_TOOL_IDLE_TIMEOUT_MS = 1800000
const MAX_TOOL_IDLE_TIMEOUT_MS = 7200000
const IDLE_CHECK_INTERVAL_MS = 5000
const IDLE_TIMEOUT_MIN_MS = 30000
const IDLE_TIMEOUT_MAX_MS = 900000

// ── Payload caps (defense against runaway CLI output) ────────────────────
const MAX_STDOUT_CHARS = 1024 * 1024
const MAX_STDERR_CHARS = 256 * 1024
// Bound individual `opc:event` payloads sent to the renderer. A runaway CLI
// emitting a single very long stderr line would otherwise ship unbounded data
// over IPC, blocking the event loop and the renderer DOM.
const MAX_STDERR_EVENT_CHARS = 32 * 1024

// ── Runtime supervisor cadence ───────────────────────────────────────────
const RUNTIME_ACTIVITY_MIN_INTERVAL_MS = 1000

// ── Linger cleanup (delays applied after `finishRun` to mop up detached
//    child processes that ignored SIGTERM) ────────────────────────────────
const LINGER_TERM_DELAY_MS = 1000
const LINGER_KILL_DELAY_MS = 2500
const LINGER_TERM_SOFT_KILL_MS = 1200
const LINGER_KILL_SOFT_KILL_MS = 50

// ── Process probes ───────────────────────────────────────────────────────
const CLI_VERSION_PROBE_TIMEOUT_MS = 5000

// ── Exit codes surfaced to the renderer / memory store ───────────────────
// 124 — convention for "command timed out" (Coreutils timeout(1)).
// 130 — convention for "terminated by SIGINT" (128 + 2).
const EXIT_CODE_IDLE_TIMEOUT = 124
const EXIT_CODE_USER_STOP = 130

// ── Cwd resolution ───────────────────────────────────────────────────────
const DEFAULT_LOCAL_CWD = process.env.OPC_DEFAULT_CWD || ''

// ── Bundled plugin names shipped with every CLI session ──────────────────
const BUNDLED_PLUGIN_NAMES = Object.freeze(['gstack-workflows'])

module.exports = {
  BUNDLED_PLUGIN_NAMES,
  CLI_VERSION_PROBE_TIMEOUT_MS,
  DEFAULT_IDLE_TIMEOUT_MS,
  DEFAULT_LOCAL_CWD,
  DEFAULT_LONG_TOOL_IDLE_TIMEOUT_MS,
  EXIT_CODE_IDLE_TIMEOUT,
  EXIT_CODE_USER_STOP,
  IDLE_CHECK_INTERVAL_MS,
  IDLE_TIMEOUT_MAX_MS,
  IDLE_TIMEOUT_MIN_MS,
  LINGER_KILL_DELAY_MS,
  LINGER_KILL_SOFT_KILL_MS,
  LINGER_TERM_DELAY_MS,
  LINGER_TERM_SOFT_KILL_MS,
  MAX_STDERR_CHARS,
  MAX_STDERR_EVENT_CHARS,
  MAX_STDOUT_CHARS,
  MAX_TOOL_IDLE_TIMEOUT_MS,
  RUNTIME_ACTIVITY_MIN_INTERVAL_MS,
}
