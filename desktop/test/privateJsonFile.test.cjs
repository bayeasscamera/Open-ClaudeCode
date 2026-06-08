const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { privateJsonText, writePrivateJsonFile } = require('../electron/persistence/privateJsonFile.cjs')

test('private JSON helper writes mode 0600 JSON with optional newline', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opc-private-json-'))
  const filePath = path.join(dir, 'nested', 'state.json')

  writePrivateJsonFile(filePath, { ok: true }, { trailingNewline: false })

  assert.equal(fs.readFileSync(filePath, 'utf8'), '{\n  "ok": true\n}')
  assert.equal(fs.statSync(filePath).mode & 0o777, 0o600)
})

test('private JSON helper supports atomic replacement', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opc-private-json-'))
  const filePath = path.join(dir, 'config.json')
  fs.writeFileSync(filePath, '{"old":true}\n')

  writePrivateJsonFile(filePath, { next: true }, { atomic: true })

  assert.deepEqual(JSON.parse(fs.readFileSync(filePath, 'utf8')), { next: true })
  assert.equal(fs.statSync(filePath).mode & 0o777, 0o600)
  assert.equal(fs.readdirSync(dir).some(name => name.endsWith('.tmp')), false)
})

test('private JSON text defaults to newline for diff-friendly config files', () => {
  assert.equal(privateJsonText({ a: 1 }), '{\n  "a": 1\n}\n')
})
