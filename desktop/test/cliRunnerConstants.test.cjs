const assert = require('node:assert/strict')
const test = require('node:test')
const constants = require('../electron/cliRunner.constants.cjs')
const { CLI_RUNNER_CONSTANTS } = require('../electron/cliRunner.cjs')

// ── Sprint 4 — constants module shape & values ─────────────────────────────

test('cli runner constants module exports every named constant', () => {
  const expectedKeys = [
    'BUNDLED_PLUGIN_NAMES',
    'CLI_VERSION_PROBE_TIMEOUT_MS',
    'DEFAULT_IDLE_TIMEOUT_MS',
    'DEFAULT_LOCAL_CWD',
    'DEFAULT_LONG_TOOL_IDLE_TIMEOUT_MS',
    'EXIT_CODE_IDLE_TIMEOUT',
    'EXIT_CODE_USER_STOP',
    'IDLE_CHECK_INTERVAL_MS',
    'IDLE_TIMEOUT_MAX_MS',
    'IDLE_TIMEOUT_MIN_MS',
    'LINGER_KILL_DELAY_MS',
    'LINGER_KILL_SOFT_KILL_MS',
    'LINGER_TERM_DELAY_MS',
    'LINGER_TERM_SOFT_KILL_MS',
    'MAX_STDERR_CHARS',
    'MAX_STDERR_EVENT_CHARS',
    'MAX_STDOUT_CHARS',
    'MAX_TOOL_IDLE_TIMEOUT_MS',
    'RUNTIME_ACTIVITY_MIN_INTERVAL_MS',
  ]
  for (const key of expectedKeys) {
    assert.ok(key in constants, `expected ${key} in cliRunner.constants`)
  }
})

test('cli runner constants have the expected values and types', () => {
  // Payload caps (defense against runaway CLI output).
  assert.equal(constants.MAX_STDOUT_CHARS, 1024 * 1024)
  assert.equal(constants.MAX_STDERR_CHARS, 256 * 1024)
  assert.equal(constants.MAX_STDERR_EVENT_CHARS, 32 * 1024)

  // Idle watchdog.
  assert.equal(constants.DEFAULT_IDLE_TIMEOUT_MS, 300000)
  assert.equal(constants.DEFAULT_LONG_TOOL_IDLE_TIMEOUT_MS, 1800000)
  assert.equal(constants.MAX_TOOL_IDLE_TIMEOUT_MS, 7200000)
  assert.equal(constants.IDLE_CHECK_INTERVAL_MS, 5000)
  assert.equal(constants.IDLE_TIMEOUT_MIN_MS, 30000)
  assert.equal(constants.IDLE_TIMEOUT_MAX_MS, 900000)

  // Runtime cadence.
  assert.equal(constants.RUNTIME_ACTIVITY_MIN_INTERVAL_MS, 1000)

  // Linger cleanup.
  assert.equal(constants.LINGER_TERM_DELAY_MS, 1000)
  assert.equal(constants.LINGER_KILL_DELAY_MS, 2500)
  assert.equal(constants.LINGER_TERM_SOFT_KILL_MS, 1200)
  assert.equal(constants.LINGER_KILL_SOFT_KILL_MS, 50)

  // Process probes.
  assert.equal(constants.CLI_VERSION_PROBE_TIMEOUT_MS, 5000)

  // Exit codes (Linux convention: 128 + signal).
  assert.equal(constants.EXIT_CODE_IDLE_TIMEOUT, 124)
  assert.equal(constants.EXIT_CODE_USER_STOP, 130)

  // Bundled plugin list is frozen.
  assert.ok(Object.isFrozen(constants.BUNDLED_PLUGIN_NAMES))
  assert.deepEqual(constants.BUNDLED_PLUGIN_NAMES, ['gstack-workflows'])
})

test('cliRunner.cjs re-exports CLI_RUNNER_CONSTANTS matching the constants module', () => {
  // The re-export exists so consumers can discover the contract without
  // importing the dedicated constants module.
  assert.ok(CLI_RUNNER_CONSTANTS, 'CLI_RUNNER_CONSTANTS should be exported')
  assert.ok(Object.isFrozen(CLI_RUNNER_CONSTANTS), 'CLI_RUNNER_CONSTANTS should be frozen')
  for (const key of [
    'MAX_STDOUT_CHARS',
    'MAX_STDERR_CHARS',
    'MAX_STDERR_EVENT_CHARS',
    'EXIT_CODE_IDLE_TIMEOUT',
    'EXIT_CODE_USER_STOP',
    'RUNTIME_ACTIVITY_MIN_INTERVAL_MS',
    'LINGER_TERM_DELAY_MS',
    'LINGER_KILL_DELAY_MS',
    'LINGER_TERM_SOFT_KILL_MS',
    'LINGER_KILL_SOFT_KILL_MS',
  ]) {
    assert.equal(
      CLI_RUNNER_CONSTANTS[key],
      constants[key],
      `CLI_RUNNER_CONSTANTS.${key} must match the constants module value`,
    )
  }
})
