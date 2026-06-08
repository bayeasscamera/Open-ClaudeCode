const assert = require('node:assert/strict')
const test = require('node:test')
const { STATE_SCHEMA_VERSION, stateRepositorySchema } = require('../electron/persistence/stateSchema.cjs')

test('state repository schema defines migration targets for local scale storage', () => {
  const schema = stateRepositorySchema()

  assert.equal(STATE_SCHEMA_VERSION, 2)
  assert.equal(schema.tables.chats.primaryKey, 'id')
  assert.equal(schema.tables.messages.indexes.includes('chatId'), true)
  assert.deepEqual(schema.tables.messages.fts, ['content', 'summary', 'toolText'])
  assert.equal(schema.tables.agent_task_ledger.indexes.includes('status'), true)
  assert.equal(schema.tables.provider_checks.indexes.includes('checkedAt'), true)
  assert.deepEqual(schema.tables.project_files.fts, ['name', 'summary', 'preview', 'searchIndex'])
})
