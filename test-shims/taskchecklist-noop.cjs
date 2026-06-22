// In-memory taskChecklist stub for the loop test suite.
// Lets the runner call saveTasks/getTasks without hitting disk.

const _store = {
  tasks: [],
}

function getTasks() {
  return _store.tasks.slice()
}

function saveTasks(tasks) {
  _store.tasks = Array.isArray(tasks) ? tasks.slice() : []
}

function getProjectRoot() {
  return '/tmp/opc-loop-tests'
}

function __resetForTests() {
  _store.tasks = []
}

module.exports = {
  getTasks,
  saveTasks,
  getProjectRoot,
  __resetForTests,
}
