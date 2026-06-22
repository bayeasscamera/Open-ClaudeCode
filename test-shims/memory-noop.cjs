// In-memory no-op for src/utils/memory.ts during the loop test suite.
// Avoids touching the real filesystem so tests are hermetic.

const tasks = []

function appendMemory(title, summary) {
  tasks.push({ ts: Date.now(), title, summary })
}

function getMemory() {
  return tasks.map(t => `## ${t.title}\n\n${t.summary}\n`).join('\n')
}

function saveMemory(_content) {
  // intentionally empty
}

function getMemoryFilePath() {
  return '/tmp/opc-loop-tests/memory.md'
}

module.exports = {
  appendMemory,
  getMemory,
  saveMemory,
  getMemoryFilePath,
}
