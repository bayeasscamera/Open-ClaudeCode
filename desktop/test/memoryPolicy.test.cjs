const assert = require('node:assert/strict')
const test = require('node:test')
const {
  buildMemoryPrompt,
  parseRecentEntries,
  runMemoryEntry,
  serializeRecentEntries,
} = require('../electron/memoryPolicy.cjs')

test('memory policy parses recent jsonl entries and ignores invalid lines', () => {
  const entries = parseRecentEntries('bad\n{"model":"a"}\n{"model":"b"}\n', 1)
  assert.deepEqual(entries, [{ model: 'b' }])
})

test('memory policy builds bounded prompt with notes and recent sessions', () => {
  const prompt = buildMemoryPrompt({
    cwd: '/tmp/project',
    model: 'mock/model',
    notes: 'Note durable',
    recentEntries: [{ timestamp: '2026-01-01T00:00:00.000Z', cwd: '/tmp/project', model: 'mock/model', prompt: 'hello', result: 'ok' }],
    maxChars: 400,
  })
  assert.equal(prompt.includes('MÉMOIRE DURE OPC'), true)
  assert.equal(prompt.includes('Note durable'), true)
  assert.equal(prompt.includes('hello'), true)
})

test('memory policy truncates recorded run content', () => {
  const entry = runMemoryEntry(
    { cwd: '/tmp/project', model: 'mock/model', prompt: 'x'.repeat(900) },
    1,
    12,
    'y'.repeat(1300),
  )
  assert.equal(entry.status, 'error')
  assert.equal(entry.prompt.length, 800)
  assert.equal(entry.result.length, 1200)
})

test('memory policy redacts API secrets before durable storage', () => {
  const entry = runMemoryEntry(
    { cwd: '/tmp/project', model: 'mock/model', prompt: 'clé nvapi-abcDEF_1234567890SECRET et api_key: sk-secret1234567890' },
    0,
    12,
    'Bearer abcdefghijklmnopqrstuvwxyz123456',
  )
  assert.equal(entry.prompt.includes('nvapi-abcDEF'), false)
  assert.equal(entry.prompt.includes('sk-secret'), false)
  assert.equal(entry.result.includes('abcdefghijklmnopqrstuvwxyz'), false)
  assert.match(entry.prompt, /\[REDACTED\]/)
  assert.match(entry.result, /\[REDACTED\]/)
})

test('memory policy serializes bounded jsonl history', () => {
  const jsonl = serializeRecentEntries([{ id: 1 }, { id: 2 }], { id: 3 }, 2)
  assert.equal(jsonl, '{"id":2}\n{"id":3}\n')
})
