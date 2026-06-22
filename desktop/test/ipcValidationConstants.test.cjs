const assert = require('node:assert/strict')
const test = require('node:test')
const constants = require('../electron/ipcValidation.constants.cjs')
const validation = require('../electron/ipcValidation.cjs')

// Sprint 5 — ipcValidation constants module shape & values

test('ipcValidation constants module exports every named constant', () => {
  const expectedKeys = [
    'MAX_PROMPT_CHARS', 'MAX_STRING_CHARS', 'MAX_REFINE_PROMPT_CHARS',
    'MAX_TOOL_NAME_CHARS', 'MAX_COMMAND_CHARS', 'MAX_SHORT_ID_CHARS',
    'MAX_MEDIUM_TEXT_CHARS', 'MAX_LONG_TEXT_CHARS', 'MAX_TAG_CHARS',
    'MAX_REASON_CHARS', 'MAX_DESCRIPTION_CHARS', 'MAX_QUERY_CHARS',
    'MAX_ERROR_CHARS', 'MAX_SUMMARY_CHARS', 'MAX_INDEXED_AT_CHARS',
    'MAX_SNIPPET_CHARS', 'MAX_SNIPPETS', 'MAX_KEYWORD_CHARS', 'MAX_KEYWORDS',
    'MAX_HEADING_CHARS', 'MAX_HEADINGS', 'MAX_SERVICE_NAME_CHARS',
    'MAX_MODEL_CHARS',
    'MAX_TASKS', 'MAX_SERVICES_PER_TASK', 'MAX_PROJECT_CONTEXT_FILES',
    'MAX_ALLOWED_TOOLS', 'MAX_PAUSE_MODELS',
    'STATE_SEARCH_LIMIT_MIN', 'STATE_SEARCH_LIMIT_MAX', 'STATE_SEARCH_DEFAULT_LIMIT',
    'MAX_TURNS', 'MAX_BUDGET_USD', 'PID_MIN', 'PID_MAX',
    'TRUSTED_BYPASS_COMMANDS', 'PERMISSION_MODES', 'BYPASS_PERMISSION_MODES',
    'COMMAND_INTENT_SOURCES', 'STATE_SEARCH_TYPES', 'LOCAL_HTTP_HOSTNAMES',
    'DEFAULT_PERMISSION_MODE',
  ]
  for (const key of expectedKeys) {
    assert.ok(key in constants, 'expected ' + key + ' in ipcValidation.constants')
  }
})

test('ipcValidation constants have the expected values and types', () => {
  assert.equal(constants.MAX_PROMPT_CHARS, 500000)
  assert.equal(constants.MAX_STRING_CHARS, 4096)
  assert.equal(constants.MAX_REFINE_PROMPT_CHARS, 20000)
  assert.equal(constants.MAX_TOOL_NAME_CHARS, 1000)
  assert.equal(constants.MAX_COMMAND_CHARS, 1000)
  assert.equal(constants.MAX_SHORT_ID_CHARS, 120)
  assert.equal(constants.MAX_MEDIUM_TEXT_CHARS, 240)
  assert.equal(constants.MAX_LONG_TEXT_CHARS, 256)
  assert.equal(constants.MAX_TAG_CHARS, 40)
  assert.equal(constants.MAX_REASON_CHARS, 240)
  assert.equal(constants.MAX_DESCRIPTION_CHARS, 800)
  assert.equal(constants.MAX_QUERY_CHARS, 600)
  assert.equal(constants.MAX_ERROR_CHARS, 400)
  assert.equal(constants.MAX_SUMMARY_CHARS, 1200)
  assert.equal(constants.MAX_INDEXED_AT_CHARS, 120)
  assert.equal(constants.MAX_SNIPPET_CHARS, 300)
  assert.equal(constants.MAX_SNIPPETS, 4)
  assert.equal(constants.MAX_KEYWORD_CHARS, 80)
  assert.equal(constants.MAX_KEYWORDS, 10)
  assert.equal(constants.MAX_HEADING_CHARS, 180)
  assert.equal(constants.MAX_HEADINGS, 6)
  assert.equal(constants.MAX_SERVICE_NAME_CHARS, 80)
  assert.equal(constants.MAX_MODEL_CHARS, 256)
  assert.equal(constants.MAX_TASKS, 20)
  assert.equal(constants.MAX_SERVICES_PER_TASK, 20)
  assert.equal(constants.MAX_PROJECT_CONTEXT_FILES, 20)
  assert.equal(constants.MAX_ALLOWED_TOOLS, 80)
  assert.equal(constants.MAX_PAUSE_MODELS, 80)
  assert.equal(constants.STATE_SEARCH_LIMIT_MIN, 1)
  assert.equal(constants.STATE_SEARCH_LIMIT_MAX, 50)
  assert.equal(constants.STATE_SEARCH_DEFAULT_LIMIT, 10)
  assert.equal(constants.MAX_TURNS, 1000)
  assert.equal(constants.MAX_BUDGET_USD, 10000)
  assert.equal(constants.PID_MIN, 1)
  assert.equal(constants.PID_MAX, Number.MAX_SAFE_INTEGER)
  assert.equal(constants.DEFAULT_PERMISSION_MODE, 'default')
})

test('ipcValidation re-exports the constants module identically', () => {
  for (const key of Object.keys(constants)) {
    assert.ok(key in validation, 'ipcValidation.cjs should re-export ' + key)
    assert.equal(validation[key], constants[key], 'mismatched value for ' + key)
  }
})

test('frozen whitelists are immutable and contain expected entries', () => {
  assert.ok(Object.isFrozen(constants.TRUSTED_BYPASS_COMMANDS))
  assert.ok(Object.isFrozen(constants.LOCAL_HTTP_HOSTNAMES))
  assert.ok(constants.PERMISSION_MODES.has('default'))
  assert.ok(constants.PERMISSION_MODES.has('bypassPermissions'))
  assert.ok(constants.BYPASS_PERMISSION_MODES.has('bypassPermissions'))
  assert.ok(!constants.BYPASS_PERMISSION_MODES.has('default'))
  assert.ok(constants.COMMAND_INTENT_SOURCES.has('prompt'))
  assert.ok(constants.STATE_SEARCH_TYPES.has('messages'))
  assert.ok(constants.STATE_SEARCH_TYPES.has('project_files'))
})
