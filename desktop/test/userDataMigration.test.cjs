const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { migrateLegacyProviderConfig, redactLegacyProviderSecrets } = require('../electron/userDataMigration.cjs')

test('legacy provider migration copies profiles into canonical OPC user data', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'opc-user-data-'))
  const canonicalPath = path.join(root, 'OPC', 'providers', 'nvidia.json')
  const legacyPath = path.join(root, 'opc-desktop', 'providers', 'nvidia.json')
  fs.mkdirSync(path.dirname(legacyPath), { recursive: true })
  fs.writeFileSync(legacyPath, JSON.stringify({
    defaultModel: 'legacy/model',
    baseUrl: 'https://legacy.test/v1',
    profiles: [
      { id: 'legacy/model', model: 'legacy/model', baseUrl: 'https://legacy.test/v1', apiKey: 'legacy-token' },
      { id: 'local/model', model: 'local/model', baseUrl: 'http://localhost:8317/v1', noAuth: true },
    ],
  }))

  const result = migrateLegacyProviderConfig({ canonicalPath, legacyPaths: [legacyPath] })
  const raw = JSON.parse(fs.readFileSync(canonicalPath, 'utf8'))

  assert.equal(result.migrated, true)
  assert.equal(result.added, 2)
  assert.equal(raw.defaultModel, 'legacy/model')
  assert.deepEqual(raw.profiles.map(profile => profile.model), ['legacy/model', 'local/model'])
  assert.equal((fs.statSync(canonicalPath).mode & 0o777), 0o600)
  const legacy = JSON.parse(fs.readFileSync(legacyPath, 'utf8'))
  assert.equal(legacy.migratedTo, 'OPC')
  assert.equal(legacy.profiles[0].apiKey, undefined)
})

test('legacy provider migration preserves canonical profiles and deduplicates legacy profiles', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'opc-user-data-'))
  const canonicalPath = path.join(root, 'OPC', 'providers', 'nvidia.json')
  const legacyPath = path.join(root, 'opc-desktop', 'providers', 'nvidia.json')
  fs.mkdirSync(path.dirname(canonicalPath), { recursive: true })
  fs.mkdirSync(path.dirname(legacyPath), { recursive: true })
  fs.writeFileSync(canonicalPath, JSON.stringify({
    defaultModel: 'canonical/model',
    profiles: [
      { id: 'canonical/model', model: 'canonical/model', baseUrl: 'https://canonical.test/v1', apiKey: 'canonical-token' },
    ],
  }))
  fs.writeFileSync(legacyPath, JSON.stringify({
    defaultModel: 'legacy/model',
    profiles: [
      { id: 'canonical/model', model: 'canonical/model', baseUrl: 'https://old.test/v1', apiKey: 'old-token' },
      { id: 'legacy/model', model: 'legacy/model', baseUrl: 'https://legacy.test/v1', apiKey: 'legacy-token' },
    ],
  }))

  const result = migrateLegacyProviderConfig({ canonicalPath, legacyPaths: [legacyPath] })
  const raw = JSON.parse(fs.readFileSync(canonicalPath, 'utf8'))

  assert.equal(result.migrated, true)
  assert.equal(result.added, 1)
  assert.equal(raw.defaultModel, 'canonical/model')
  assert.equal(raw.profiles.length, 2)
  assert.equal(raw.profiles[0].baseUrl, 'https://canonical.test/v1')
  assert.equal(raw.profiles[1].model, 'legacy/model')
  const backupName = fs.readdirSync(path.dirname(canonicalPath)).find(name => name.startsWith('nvidia.json.bak.'))
  assert.equal(Boolean(backupName), true)
  const backup = JSON.parse(fs.readFileSync(path.join(path.dirname(canonicalPath), backupName), 'utf8'))
  assert.equal(backup.profiles[0].apiKey, undefined)
  assert.equal(backup.profiles[0].secretMigratedTo, 'OPC')
})

test('legacy provider migration skips files already migrated to OPC', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'opc-user-data-'))
  const canonicalPath = path.join(root, 'OPC', 'providers', 'nvidia.json')
  const legacyPath = path.join(root, 'opc-desktop', 'providers', 'nvidia.json')
  fs.mkdirSync(path.dirname(canonicalPath), { recursive: true })
  fs.mkdirSync(path.dirname(legacyPath), { recursive: true })
  fs.writeFileSync(canonicalPath, JSON.stringify({
    defaultModel: 'kept/model',
    profiles: [
      { id: 'kept/model', model: 'kept/model', baseUrl: 'https://kept.test/v1', apiKey: 'kept-token' },
    ],
  }))
  fs.writeFileSync(legacyPath, JSON.stringify({
    migratedTo: 'OPC',
    defaultModel: 'deleted/model',
    profiles: [
      { id: 'deleted/model', model: 'deleted/model', baseUrl: 'https://deleted.test/v1', apiKey: 'deleted-token' },
    ],
  }))

  const result = migrateLegacyProviderConfig({ canonicalPath, legacyPaths: [legacyPath] })
  const raw = JSON.parse(fs.readFileSync(canonicalPath, 'utf8'))

  assert.equal(result.migrated, false)
  assert.equal(result.added, 0)
  assert.deepEqual(raw.profiles.map(profile => profile.model), ['kept/model'])
})

test('legacy provider redaction removes copied secrets from old user data', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'opc-user-data-'))
  const legacyPath = path.join(root, 'opc-desktop', 'providers', 'nvidia.json')
  fs.mkdirSync(path.dirname(legacyPath), { recursive: true })
  fs.writeFileSync(legacyPath, JSON.stringify({
    profiles: [
      { id: 'plain', model: 'plain', apiKey: 'plain-token' },
      { id: 'sealed', model: 'sealed', apiKeySecret: 'opc-safe:v1:sealed' },
      { id: 'local', model: 'local', noAuth: true },
    ],
  }))

  const result = redactLegacyProviderSecrets({ legacyPaths: [legacyPath] })
  const raw = JSON.parse(fs.readFileSync(legacyPath, 'utf8'))

  assert.equal(result.redacted, true)
  assert.equal(raw.migratedTo, 'OPC')
  assert.equal(raw.profiles[0].apiKey, undefined)
  assert.equal(raw.profiles[0].secretMigratedTo, 'OPC')
  assert.equal(raw.profiles[1].apiKeySecret, undefined)
  assert.equal(raw.profiles[1].secretMigratedTo, 'OPC')
  assert.equal(raw.profiles[2].noAuth, true)
  const backupName = fs.readdirSync(path.dirname(legacyPath)).find(name => name.startsWith('nvidia.json.bak.'))
  assert.equal(Boolean(backupName), true)
  const backup = JSON.parse(fs.readFileSync(path.join(path.dirname(legacyPath), backupName), 'utf8'))
  assert.equal(backup.profiles[0].apiKey, undefined)
  assert.equal(backup.profiles[1].apiKeySecret, undefined)
})
