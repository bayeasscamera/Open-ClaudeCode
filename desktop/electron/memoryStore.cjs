const fs = require('node:fs')
const path = require('node:path')
const memoryPolicy = require('./memoryPolicy.cjs')

function createMemoryStore({ dir, log }) {
  function memoryDir() {
    return dir()
  }

  function memoryPath() {
    return path.join(memoryDir(), 'OPC_MEMORY.md')
  }

  function recentMemoryPath() {
    return path.join(memoryDir(), 'recent-sessions.jsonl')
  }

  function ensureFiles() {
    fs.mkdirSync(memoryDir(), { recursive: true })
    if (!fs.existsSync(memoryPath())) fs.writeFileSync(memoryPath(), memoryPolicy.defaultMemoryText(), 'utf8')
    if (!fs.existsSync(recentMemoryPath())) fs.writeFileSync(recentMemoryPath(), '', 'utf8')
    fs.chmodSync(memoryPath(), 0o600)
    fs.chmodSync(recentMemoryPath(), 0o600)
  }

  function loadNotes() {
    try {
      ensureFiles()
      return fs.readFileSync(memoryPath(), 'utf8').trim()
    } catch (error) {
      log(`Memory notes unavailable: ${error.message}`)
      return ''
    }
  }

  function loadRecentEntries(limit = memoryPolicy.MEMORY_RECENT_LIMIT) {
    try {
      ensureFiles()
      return memoryPolicy.parseRecentEntries(fs.readFileSync(recentMemoryPath(), 'utf8'), limit)
    } catch (error) {
      log(`Recent memory unavailable: ${error.message}`)
      return []
    }
  }

  function buildPrompt(cwd, model) {
    const notes = loadNotes()
    return memoryPolicy.buildMemoryPrompt({ cwd, model, notes, recentEntries: loadRecentEntries() })
  }

  function info() {
    try {
      ensureFiles()
      return {
        enabled: true,
        path: memoryPath(),
        recentPath: recentMemoryPath(),
        recentCount: loadRecentEntries(memoryPolicy.MEMORY_STORED_RUNS).length,
      }
    } catch (error) {
      return { enabled: false, error: error.message }
    }
  }

  function recordRun(run, code, durationMs, result) {
    try {
      ensureFiles()
      const entry = memoryPolicy.runMemoryEntry(run, code, durationMs, result)
      const existing = memoryPolicy.parseRecentEntries(
        fs.readFileSync(recentMemoryPath(), 'utf8'),
        memoryPolicy.MEMORY_STORED_RUNS,
      )
      fs.writeFileSync(recentMemoryPath(), memoryPolicy.serializeRecentEntries(existing, entry), 'utf8')
    } catch (error) {
      log(`Memory write failed: ${error.message}`)
    }
  }

  return {
    memoryPath,
    buildPrompt,
    info,
    recordRun,
  }
}

module.exports = { createMemoryStore }
