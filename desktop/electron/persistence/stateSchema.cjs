const STATE_SCHEMA_VERSION = 2

const STATE_REPOSITORY_TABLES = Object.freeze({
  state_snapshots: {
    primaryKey: 'id',
    indexes: ['updatedAt'],
  },
  chats: {
    primaryKey: 'id',
    indexes: ['projectId', 'createdAt'],
  },
  messages: {
    primaryKey: 'id',
    indexes: ['chatId', 'role', 'createdAt'],
    fts: ['content', 'summary', 'toolText'],
  },
  projects: {
    primaryKey: 'id',
    indexes: ['updatedAt'],
  },
  provider_checks: {
    primaryKey: 'model',
    indexes: ['status', 'checkedAt'],
  },
  provider_check_history: {
    primaryKey: 'id',
    indexes: ['model', 'checkedAt', 'category'],
  },
  long_tasks: {
    primaryKey: 'id',
    indexes: ['cwd', 'status', 'updatedAt'],
  },
  companion_jobs: {
    primaryKey: 'id',
    indexes: ['taskId', 'chatId', 'status', 'updatedAt'],
  },
  agent_task_ledger: {
    primaryKey: 'id',
    indexes: ['status', 'updatedAt', 'assistantId', 'chatId'],
  },
  project_files: {
    primaryKey: 'id',
    indexes: ['projectId', 'path', 'indexedAt'],
    fts: ['name', 'summary', 'preview', 'searchIndex'],
  },
})

function stateRepositorySchema() {
  return {
    version: STATE_SCHEMA_VERSION,
    tables: STATE_REPOSITORY_TABLES,
  }
}

module.exports = {
  STATE_REPOSITORY_TABLES,
  STATE_SCHEMA_VERSION,
  stateRepositorySchema,
}
