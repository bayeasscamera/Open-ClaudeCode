const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { createProviderConfigStore } = require('../electron/providerConfig.cjs')
const { createProviderSecretVault, SECRET_PREFIX } = require('../electron/providerSecretVault.cjs')

test('provider config store surfaces malformed config while keeping defaults', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opc-provider-config-'))
  const configPath = path.join(dir, 'nvidia.json')
  fs.writeFileSync(configPath, '{bad json')

  const store = createProviderConfigStore({ configPath: () => configPath })
  const config = store.load()

  assert.equal(config.defaultModel, 'mistralai/mistral-medium-3.5-128b')
  assert.match(store.loadError(), /Configuration provider illisible/)
})

test('provider config store treats missing config as default without error', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opc-provider-config-'))
  const configPath = path.join(dir, 'missing.json')

  const store = createProviderConfigStore({ configPath: () => configPath })
  const config = store.load()

  assert.equal(config.defaultModel, 'mistralai/mistral-medium-3.5-128b')
  assert.equal(store.loadError(), '')
})

test('provider config store edits profiles without exposing api keys', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opc-provider-config-'))
  const configPath = path.join(dir, 'providers.json')
  const store = createProviderConfigStore({ configPath: () => configPath })

  const config = store.upsertProfile({
    label: 'Local Mini',
    model: 'local/mini',
    providerName: 'Local',
    baseUrl: 'http://localhost:8317/v1',
    apiKey: 'secret-token-123456',
    timeoutMs: 300000,
    checkTimeoutMs: 15000,
    retries: 2,
    maxTokens: 8192,
    capabilities: { tools: false, toolChoice: true, temperature: false },
    makeDefault: true,
  })

  assert.equal(config.defaultModel, 'local/mini')
  assert.equal(config.profiles[0].apiKeySet, true)
  assert.equal(config.profiles[0].checkTimeoutMs, 15000)
  assert.equal(config.profiles[0].capabilities.tools, false)
  assert.equal(config.profiles[0].capabilities.toolChoice, false)
  assert.equal(config.profiles[0].capabilities.temperature, false)
  assert.equal(config.profiles[0].apiKey, undefined)
  assert.match(config.profiles[0].apiKeyPreview, /^secret/)
  assert.equal(JSON.parse(fs.readFileSync(configPath, 'utf8')).profiles[0].apiKey, 'secret-token-123456')

  store.upsertProfile({
    id: 'local/mini',
    label: 'Local Mini Updated',
    model: 'local/mini',
    providerName: 'Local',
    baseUrl: 'http://localhost:8317/v1',
    apiKey: '',
  })

  const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  assert.equal(raw.profiles[0].label, 'Local Mini Updated')
  assert.equal(raw.profiles[0].apiKey, 'secret-token-123456')
  assert.equal(raw.profiles[0].capabilities.tools, false)
})

test('provider config store canonicalizes legacy OpenRouter base URL on edit', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opc-provider-config-'))
  const configPath = path.join(dir, 'providers.json')
  const store = createProviderConfigStore({ configPath: () => configPath })

  const config = store.upsertProfile({
    label: 'cobuddy:free',
    model: 'baidu/cobuddy:free',
    providerName: 'OpenRouter',
    baseUrl: 'https://api.openrouter.ai/api/v1/',
    apiKey: 'secret-token-123456',
    makeDefault: true,
  })

  const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  assert.equal(config.profiles[0].baseUrl, 'https://openrouter.ai/api/v1')
  assert.equal(raw.profiles[0].baseUrl, 'https://openrouter.ai/api/v1')
})

test('provider config store repairs known provider issues on load', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opc-provider-config-'))
  const configPath = path.join(dir, 'providers.json')
  fs.writeFileSync(configPath, JSON.stringify({
    baseUrl: 'https://api.openrouter.ai/api/v1/',
    defaultModel: 'baidu/cobuddy:free',
    profiles: [
      {
        id: 'cobuddy',
        label: 'cobuddy:free',
        model: 'baidu/cobuddy:free',
        providerName: 'OpenRouter',
        baseUrl: 'https://api.openrouter.ai/api/v1/',
        apiKey: 'secret-token-123456',
        capabilities: { tools: true, thinking: true },
        extraBody: {
          thinking: { type: 'enabled' },
          chat_template_kwargs: { enable_thinking: true, other: 'kept' },
          safe: true,
        },
      },
    ],
  }))
  const store = createProviderConfigStore({ configPath: () => configPath })

  const repair = store.repairKnownProviderIssues()
  const config = store.load()
  const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'))

  assert.equal(repair.repaired, true)
  assert.equal(repair.count >= 4, true)
  assert.equal(repair.changes.some(change => change.scope === 'global' && change.field === 'baseUrl'), true)
  assert.equal(repair.changes.some(change => change.model === 'baidu/cobuddy:free' && change.field === 'capabilities.thinking'), true)
  assert.equal(config.baseUrl, 'https://openrouter.ai/api/v1')
  assert.equal(config.profiles[0].baseUrl, 'https://openrouter.ai/api/v1')
  assert.equal(raw.baseUrl, 'https://openrouter.ai/api/v1')
  assert.equal(raw.profiles[0].baseUrl, 'https://openrouter.ai/api/v1')
  assert.equal(raw.profiles[0].capabilities.thinking, false)
  assert.equal(raw.profiles[0].extraBody.thinking, undefined)
  assert.equal(raw.profiles[0].extraBody.chat_template_kwargs.enable_thinking, undefined)
  assert.equal(raw.profiles[0].extraBody.chat_template_kwargs.other, 'kept')
})

test('provider config store repairs Freemodel Claude Code endpoint', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opc-provider-config-'))
  const configPath = path.join(dir, 'providers.json')
  fs.writeFileSync(configPath, JSON.stringify({
    profiles: [
      {
        id: 'claude-sonnet-4-6',
        label: 'claude-sonnet-4-6',
        model: 'claude-sonnet-4-6',
        providerName: 'freemodel',
        baseUrl: 'https://cc.freemodel.dev/v1',
        upstreamApi: 'anthropic',
      },
    ],
  }))
  const store = createProviderConfigStore({ configPath: () => configPath })

  const repair = store.repairKnownProviderIssues()
  const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'))

  assert.equal(repair.repaired, true)
  assert.equal(repair.changes.some(change => change.model === 'claude-sonnet-4-6' && change.message === 'Endpoint Freemodel Claude Code corrigé.'), true)
  assert.equal(raw.profiles[0].baseUrl, 'https://cc.freemodel.dev')
})

test('provider config store seals api keys when a secret vault is available', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opc-provider-config-'))
  const configPath = path.join(dir, 'providers.json')
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: value => Buffer.from(`sealed:${value}`),
    decryptString: value => Buffer.from(value).toString('utf8').replace(/^sealed:/, ''),
  }
  const store = createProviderConfigStore({
    configPath: () => configPath,
    secretVault: createProviderSecretVault({ safeStorage }),
  })

  store.upsertProfile({
    label: 'Secure',
    model: 'secure/model',
    providerName: 'Secure Provider',
    baseUrl: 'https://secure.test/v1',
    apiKey: 'secret-token-123456',
    makeDefault: true,
  })

  const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  assert.equal(raw.profiles[0].apiKey, undefined)
  assert.equal(raw.profiles[0].apiKeySecret.startsWith(SECRET_PREFIX), true)
  assert.equal(store.profileForModel('secure/model').apiKey, 'secret-token-123456')
  assert.equal(store.editableConfig().profiles[0].apiKeySet, true)
  assert.match(store.editableConfig().profiles[0].apiKeyPreview, /^secret/)

  store.upsertProfile({
    id: 'secure/model',
    model: 'secure/model',
    providerName: 'Secure Provider',
    baseUrl: 'https://secure.test/v1',
    clearApiKey: true,
  })
  const cleared = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  assert.equal(cleared.profiles[0].apiKey, undefined)
  assert.equal(cleared.profiles[0].apiKeySecret, undefined)
})

test('provider config store migrates existing plain api keys to safe storage on load', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opc-provider-config-'))
  const configPath = path.join(dir, 'providers.json')
  fs.writeFileSync(configPath, JSON.stringify({
    defaultModel: 'secure/model',
    profiles: [
      {
        id: 'secure/model',
        label: 'Secure',
        model: 'secure/model',
        providerName: 'Secure Provider',
        baseUrl: 'https://secure.test/v1',
        apiKey: 'plain-token-123456',
      },
      {
        id: 'local/model',
        label: 'Local',
        model: 'local/model',
        providerName: 'Local',
        baseUrl: 'http://localhost:8317/v1',
        noAuth: true,
        apiKey: 'remove-me',
      },
    ],
  }))
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: value => Buffer.from(`sealed:${value}`),
    decryptString: value => Buffer.from(value).toString('utf8').replace(/^sealed:/, ''),
  }
  const store = createProviderConfigStore({
    configPath: () => configPath,
    secretVault: createProviderSecretVault({ safeStorage }),
  })

  const config = store.load()
  const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'))

  assert.equal(config.defaultModel, 'secure/model')
  assert.equal(raw.profiles[0].apiKey, undefined)
  assert.equal(raw.profiles[0].apiKeySecret.startsWith(SECRET_PREFIX), true)
  assert.equal(raw.profiles[1].apiKey, undefined)
  assert.equal(raw.profiles[1].apiKeySecret, undefined)
  assert.equal(store.profileForModel('secure/model').apiKey, 'plain-token-123456')
  const backupName = fs.readdirSync(dir).find(name => name.startsWith('providers.json.bak.'))
  assert.equal(Boolean(backupName), true)
  const backup = JSON.parse(fs.readFileSync(path.join(dir, backupName), 'utf8'))
  assert.equal(backup.profiles[0].apiKey, undefined)
  assert.equal(backup.profiles[0].apiKeySecret, undefined)
  assert.equal(backup.profiles[0].secretMigratedTo, 'OPC')
})

test('provider config store fails closed for plaintext api keys when safe storage is required', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opc-provider-config-'))
  const configPath = path.join(dir, 'providers.json')
  fs.writeFileSync(configPath, JSON.stringify({
    defaultModel: 'plain/model',
    profiles: [{
      id: 'plain/model',
      model: 'plain/model',
      providerName: 'Plain Provider',
      baseUrl: 'https://plain.test/v1',
      apiKey: 'plain-token-123456',
    }],
  }))
  const store = createProviderConfigStore({
    configPath: () => configPath,
    secretVault: createProviderSecretVault({ allowPlaintext: false }),
  })

  const config = store.load()

  assert.equal(config.defaultModel, 'mistralai/mistral-medium-3.5-128b')
  assert.match(store.loadError(), /clé API en clair|safeStorage/)
  assert.throws(() => store.upsertProfile({
    label: 'New',
    model: 'new/model',
    providerName: 'New Provider',
    baseUrl: 'https://new.test/v1',
    apiKey: 'new-token-123456',
  }), /safeStorage est requis/)
})

test('provider config store redacts old plaintext backups during migration checks', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opc-provider-config-'))
  const configPath = path.join(dir, 'providers.json')
  const backupPath = `${configPath}.bak.old`
  fs.writeFileSync(configPath, JSON.stringify({ profiles: [{ id: 'safe', model: 'safe/model' }] }))
  fs.writeFileSync(backupPath, JSON.stringify({
    profiles: [{ id: 'plain', model: 'plain/model', apiKey: 'plain-token-123456' }],
  }))

  const store = createProviderConfigStore({ configPath: () => configPath })
  const migration = store.migratePlainApiKeys()
  const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'))

  assert.equal(migration.backupRedaction.redacted, true)
  assert.equal(backup.profiles[0].apiKey, undefined)
  assert.equal(backup.profiles[0].secretMigratedTo, 'OPC')
})

test('provider config store deletes profiles and moves default model', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opc-provider-config-'))
  const configPath = path.join(dir, 'providers.json')
  fs.writeFileSync(configPath, JSON.stringify({
    defaultModel: 'one',
    profiles: [
      { id: 'one', model: 'one', baseUrl: 'https://one.test/v1', apiKey: 'a' },
      { id: 'two', model: 'two', baseUrl: 'https://two.test/v1', apiKey: 'b' },
    ],
  }))
  const store = createProviderConfigStore({ configPath: () => configPath })

  const config = store.deleteProfile('one')

  assert.equal(config.defaultModel, 'two')
  assert.deepEqual(config.profiles.map(profile => profile.model), ['two'])
})

test('provider config store keeps an explicitly empty provider list empty', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opc-provider-config-'))
  const configPath = path.join(dir, 'providers.json')
  fs.writeFileSync(configPath, JSON.stringify({
    defaultModel: 'deleted/model',
    profiles: [
      { id: 'deleted', model: 'deleted/model', baseUrl: 'https://deleted.test/v1', apiKey: 'token' },
    ],
  }))
  const store = createProviderConfigStore({ configPath: () => configPath })

  const deleted = store.deleteProfile('deleted/model')
  const reloaded = store.reload()
  const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'))

  assert.deepEqual(raw.profiles, [])
  assert.deepEqual(deleted.profiles.map(profile => profile.model), [])
  assert.deepEqual(reloaded.profiles.map(profile => profile.model), [])
})

test('provider config store exports sanitized config and imports profiles', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opc-provider-config-'))
  const configPath = path.join(dir, 'providers.json')
  const store = createProviderConfigStore({ configPath: () => configPath })

  store.upsertProfile({
    label: 'Private',
    model: 'private/model',
    providerName: 'Private Provider',
    baseUrl: 'https://private.test/v1',
    apiKey: 'private-secret-token',
    makeDefault: true,
  })

  const exported = store.exportConfig()
  assert.equal(exported.defaultModel, 'private/model')
  assert.equal(exported.profiles[0].apiKey, undefined)
  assert.equal(exported.profiles[0].apiKeySet, true)

  const imported = store.importConfig({
    defaultModel: 'local/model',
    profiles: [{
      label: 'Local',
      model: 'local/model',
      providerName: 'Local',
      baseUrl: 'http://localhost:8317/v1',
      noAuth: true,
      timeoutMs: 120000,
    }],
  })

  assert.equal(imported.defaultModel, 'local/model')
  assert.equal(imported.profiles.some(profile => profile.model === 'private/model'), true)
  assert.equal(imported.profiles.some(profile => profile.model === 'local/model' && profile.noAuth), true)
  const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  assert.equal(raw.profiles.find(profile => profile.model === 'private/model').apiKey, 'private-secret-token')
  assert.equal(raw.profiles.find(profile => profile.model === 'local/model').auth, false)
  assert.equal(raw.profiles.find(profile => profile.model === 'local/model').timeoutMs, 120000)
})

test('provider config store imports profiles that inherit auth without duplicating secrets', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opc-provider-config-'))
  const configPath = path.join(dir, 'providers.json')
  const store = createProviderConfigStore({ configPath: () => configPath })

  store.upsertProfile({
    id: 'seed/model',
    label: 'Seed',
    model: 'seed/model',
    providerName: 'Seed Provider',
    baseUrl: 'https://seed.test/v1',
    apiKey: 'seed-secret-token',
  })

  const imported = store.importConfig({
    profiles: [{
      id: 'child/model',
      label: 'Child',
      model: 'child/model',
      providerName: 'Seed Provider',
      baseUrl: 'https://seed.test/v1',
      authProfileId: 'seed/model',
    }],
  })
  const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  const childRaw = raw.profiles.find(profile => profile.model === 'child/model')
  const childEditable = imported.profiles.find(profile => profile.model === 'child/model')

  assert.equal(childRaw.authProfileId, 'seed/model')
  assert.equal(childRaw.apiKey, undefined)
  assert.equal(childRaw.apiKeySecret, undefined)
  assert.equal(store.profileForModel('child/model').apiKey, 'seed-secret-token')
  assert.equal(store.profileForModel('child/model').apiKeyInheritedFrom, 'seed/model')
  assert.equal(childEditable.apiKeySet, true)
  assert.match(childEditable.apiKeyPreview, /^seed/)
})

test('provider config store keeps GitLab suggestions out of agent defaults', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opc-provider-config-'))
  const configPath = path.join(dir, 'providers.json')
  const store = createProviderConfigStore({ configPath: () => configPath })

  assert.throws(() => store.upsertProfile({
    label: 'GitLab Code Suggestions',
    model: 'gitlab/code-suggestions',
    providerName: 'GitLab',
    baseUrl: 'https://gitlab.com/api/v4/code_suggestions/completions',
    upstreamApi: 'gitlab-code-suggestions',
    apiKey: 'token',
    capabilities: { agent: true, tools: true, thinking: true, refine: true },
    makeDefault: true,
  }), /outil de suggestion/)

  const config = store.importConfig({
    defaultModel: 'gitlab/code-suggestions',
    profiles: [
      {
        label: 'GitLab Code Suggestions',
        model: 'gitlab/code-suggestions',
        providerName: 'GitLab',
        baseUrl: 'https://gitlab.com/api/v4/code_suggestions/completions',
        upstreamApi: 'gitlab-code-suggestions',
        apiKey: 'token',
        capabilities: { agent: true, tools: true, thinking: true, refine: true },
      },
      {
        label: 'Agent',
        model: 'agent/model',
        providerName: 'Agent',
        baseUrl: 'https://agent.test/v1',
        apiKey: 'agent-token',
      },
    ],
  })

  assert.equal(config.defaultModel, 'agent/model')
  assert.equal(config.profiles.find(profile => profile.model === 'gitlab/code-suggestions').agentRunnable, false)
  assert.equal(config.profiles.find(profile => profile.model === 'gitlab/code-suggestions').capabilities.agent, false)
  assert.equal(config.profiles.find(profile => profile.model === 'gitlab/code-suggestions').capabilities.thinking, false)
  assert.throws(() => store.setDefaultModel('gitlab/code-suggestions'), /outil de suggestion/)
})

test('provider config store preserves user providers while normalizing supported runtime providers', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opc-provider-config-'))
  const configPath = path.join(dir, 'providers.json')
  fs.writeFileSync(configPath, JSON.stringify({
    defaultModel: 'baidu/cobuddy:free',
    profiles: [
      {
        label: 'NVIDIA Mistral',
        model: 'mistralai/mistral-medium-3.5-128b',
        providerName: 'NVIDIA',
        baseUrl: 'https://integrate.api.nvidia.com/v1',
        apiKey: 'nvapi-token',
      },
      {
        label: 'OpenRouter Cobuddy',
        model: 'baidu/cobuddy:free',
        providerName: 'OpenRouter',
        baseUrl: 'https://openrouter.ai/api/v1',
        apiKey: 'openrouter-token',
      },
      {
        label: 'Generic NVIDIA',
        model: 'qwen/qwen3.5-122b-a10b',
        providerName: 'Provider',
        baseUrl: 'https://integrate.api.nvidia.com/v1',
        apiKey: 'nvapi-token',
      },
      {
        label: 'Ollama Local',
        model: 'llama3.1:8b',
        providerName: 'Ollama',
        baseUrl: 'http://localhost:11434/v1',
        noAuth: true,
      },
    ],
  }))
  const store = createProviderConfigStore({ configPath: () => configPath })

  const result = store.pruneToSupportedProviders()
  const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  const config = store.load()

  assert.equal(result.pruned, true)
  assert.equal(result.removed, 0)
  assert.deepEqual(Array.from(new Set(config.profiles.map(profile => profile.providerName))).sort(), ['NVIDIA', 'Ollama', 'OpenRouter'])
  assert.equal(config.profiles.some(profile => profile.model === 'baidu/cobuddy:free'), true)
  assert.equal(config.profiles.find(profile => profile.model === 'qwen/qwen3.5-122b-a10b').providerName, 'NVIDIA')
  assert.equal(raw.profiles.some(profile => profile.providerName === 'OpenRouter'), true)
  assert.equal(config.defaultModel, 'baidu/cobuddy:free')
})

test('provider config store prune does not restore deleted default profiles', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opc-provider-config-'))
  const configPath = path.join(dir, 'providers.json')
  fs.writeFileSync(configPath, JSON.stringify({
    defaultModel: 'custom/nvidia',
    profiles: [
      {
        label: 'Custom NVIDIA',
        model: 'custom/nvidia',
        providerName: 'NVIDIA',
        baseUrl: 'https://integrate.api.nvidia.com/v1',
        apiKey: 'nvapi-token',
      },
    ],
  }))
  const store = createProviderConfigStore({ configPath: () => configPath })

  const result = store.pruneToSupportedProviders()
  const config = store.load()

  assert.equal(result.added, 0)
  assert.deepEqual(config.profiles.map(profile => profile.model), ['custom/nvidia'])
})

test('provider config store quarantines and restores provider profiles without deleting them', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opc-provider-config-'))
  const configPath = path.join(dir, 'providers.json')
  fs.writeFileSync(configPath, JSON.stringify({
    defaultModel: 'bad/model',
    profiles: [
      { id: 'bad', label: 'Bad', model: 'bad/model', providerName: 'Bad Provider', baseUrl: 'https://bad.test/v1', apiKey: 'bad-token' },
      { id: 'good', label: 'Good', model: 'good/model', providerName: 'Good Provider', baseUrl: 'https://good.test/v1', apiKey: 'good-token' },
    ],
  }))
  const store = createProviderConfigStore({ configPath: () => configPath })

  const paused = store.quarantineProfiles(['bad/model'], 'timeout répété')
  const bad = paused.config.profiles.find(profile => profile.model === 'bad/model')

  assert.equal(paused.changed, 1)
  assert.equal(paused.config.defaultModel, 'good/model')
  assert.equal(bad.disabled, true)
  assert.equal(bad.agentRunnable, false)
  assert.match(bad.disabledReason, /timeout/)

  const restored = store.restoreProfiles(['bad/model'])
  const restoredBad = restored.config.profiles.find(profile => profile.model === 'bad/model')

  assert.equal(restored.changed, 1)
  assert.equal(restoredBad.disabled, false)
  assert.equal(restoredBad.agentRunnable, true)
})

test('provider config store writes a provider change journal without secrets', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opc-provider-config-'))
  const configPath = path.join(dir, 'providers.json')
  const store = createProviderConfigStore({ configPath: () => configPath })

  store.upsertProfile({
    id: 'journal/model',
    label: 'Journal Model',
    model: 'journal/model',
    providerName: 'Journal Provider',
    baseUrl: 'https://journal.test/v1',
    apiKey: 'secret-token-123456',
  })
  store.quarantineProfiles(['journal/model'], 'test pause')
  store.restoreProfiles(['journal/model'])
  store.deleteProfile('journal/model')

  const events = store.providerEvents()
  assert.deepEqual(events.map(event => event.action), ['added', 'paused', 'restored', 'deleted'])
  assert.equal(events[0].model, 'journal/model')
  assert.equal(events[0].keyState, 'configured')
  assert.equal(events[1].reason, 'test pause')
  assert.equal(JSON.stringify(events).includes('secret-token-123456'), false)
  assert.equal(fs.existsSync(path.join(dir, 'provider-events.jsonl')), true)
})

test('provider config store exposes a bounded provider journal in editable config', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opc-provider-config-'))
  const configPath = path.join(dir, 'providers.json')
  const store = createProviderConfigStore({ configPath: () => configPath })

  for (let index = 0; index < 6; index += 1) {
    store.upsertProfile({
      id: `journal-${index}`,
      label: `Journal ${index}`,
      model: `journal/model-${index}`,
      providerName: 'Journal Provider',
      baseUrl: 'https://journal.test/v1',
      apiKey: `secret-token-${index}-123456`,
    })
  }

  const events = store.providerEvents({ limit: 3 })
  const config = store.editableConfig()

  assert.deepEqual(events.map(event => event.model), [
    'journal/model-3',
    'journal/model-4',
    'journal/model-5',
  ])
  assert.equal(config.providerEvents.length, 6)
  assert.equal(JSON.stringify(config.providerEvents).includes('secret-token'), false)
})
