const http = require('node:http')
const https = require('node:https')
const { requestHeaders } = require('./providerTransport.cjs')

const MAX_DISCOVERED_MODELS = 80
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024

function modelListUrl(providerConfig, profile) {
  const rawBase = providerConfig.baseUrl(profile)
  const base = rawBase.endsWith('/') ? rawBase : `${rawBase}/`
  const url = new URL('models', base)
  return url
}

function safeText(value, max = 512) {
  return String(value || '')
    .replace(/\u0000/g, '')
    .slice(0, max)
    .trim()
}

function modelIdFromItem(item) {
  if (typeof item === 'string') return safeText(item, 512)
  if (!item || typeof item !== 'object' || Array.isArray(item)) return ''
  return safeText(item.id || item.name || item.model || item.slug, 512)
}

function extractModels(payload) {
  const source = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.data)
      ? payload.data
      : Array.isArray(payload?.models)
        ? payload.models
        : []
  const seen = new Set()
  const models = []
  for (const item of source) {
    const id = modelIdFromItem(item)
    if (!id || seen.has(id)) continue
    seen.add(id)
    models.push({
      id,
      label: safeText(item?.label || item?.display_name || item?.name || id, 256),
      object: safeText(item?.object || 'model', 80),
      ownedBy: safeText(item?.owned_by || item?.ownedBy || item?.provider || '', 256),
    })
    if (models.length >= MAX_DISCOVERED_MODELS) break
  }
  return models
}

function providerDisplayName(profile = {}) {
  return safeText(profile.providerName || profile.provider || profile.label || 'Provider', 256)
}

function profilePayloadForModel(sourceProfile = {}, discovered = {}) {
  const authProfileId = safeText(sourceProfile.id || sourceProfile.model, 512)
  const capabilities = sourceProfile.capabilities && typeof sourceProfile.capabilities === 'object' && !Array.isArray(sourceProfile.capabilities)
    ? sourceProfile.capabilities
    : undefined
  const payload = {
    id: discovered.id,
    label: discovered.label || discovered.id,
    model: discovered.id,
    providerName: providerDisplayName(sourceProfile),
    baseUrl: sourceProfile.baseUrl,
    upstreamApi: sourceProfile.upstreamApi || 'openai',
    transport: sourceProfile.transport || (sourceProfile.stream === false ? 'buffered' : 'stream'),
    timeoutMs: sourceProfile.timeoutMs || sourceProfile.requestTimeoutMs || 300000,
    checkTimeoutMs: sourceProfile.checkTimeoutMs || sourceProfile.providerCheckTimeoutMs || 60000,
    retries: sourceProfile.retries ?? 0,
    maxTokens: sourceProfile.maxTokens || sourceProfile.max_tokens || 4096,
    noAuth: sourceProfile.auth === false || sourceProfile.noAuth === true,
    systemPrefix: sourceProfile.systemPrefix || '',
    extraBody: sourceProfile.extraBody || {},
  }
  if (capabilities) payload.capabilities = capabilities
  if (!payload.noAuth && authProfileId) payload.authProfileId = authProfileId
  return payload
}

function createProviderModelDiscovery({
  providerConfigStore,
  httpModule = http,
  httpsModule = https,
} = {}) {
  function sourceProfile(payload = {}) {
    providerConfigStore.reload?.()
    const selected = safeText(payload.model || payload.sourceModel, 512)
    const existing = selected ? providerConfigStore.profileForModel(selected) : null
    const profile = {
      ...(existing || {}),
      ...(payload.baseUrl ? { baseUrl: payload.baseUrl } : {}),
      ...(payload.providerName ? { providerName: payload.providerName, provider: payload.providerName } : {}),
      ...(payload.upstreamApi ? { upstreamApi: payload.upstreamApi } : {}),
      ...(payload.transport ? { transport: payload.transport, stream: payload.transport !== 'buffered' } : {}),
      ...(payload.timeoutMs ? { timeoutMs: payload.timeoutMs } : {}),
      ...(payload.checkTimeoutMs ? { checkTimeoutMs: payload.checkTimeoutMs } : {}),
      ...(payload.retries !== undefined ? { retries: payload.retries } : {}),
      ...(payload.maxTokens ? { maxTokens: payload.maxTokens } : {}),
      ...(payload.noAuth ? { auth: false, noAuth: true } : {}),
      ...(payload.apiKey ? { apiKey: payload.apiKey } : {}),
      ...(payload.capabilities && Object.keys(payload.capabilities).length ? { capabilities: payload.capabilities } : {}),
    }
    if (!profile.baseUrl) throw new Error('Base URL provider manquante pour la découverte.')
    if (!profile.apiKey && profile.auth !== false && profile.noAuth !== true) {
      throw new Error('Clé API manquante pour découvrir les modèles de ce provider.')
    }
    return profile
  }

  function requestModels(profile) {
    const url = modelListUrl(providerConfigStore, profile)
    const body = {}
    const payload = ''
    const headers = requestHeaders(profile, body, payload)
    delete headers['Content-Type']
    delete headers['Content-Length']
    headers.Accept = 'application/json'
    const transport = url.protocol === 'http:' ? httpModule : httpsModule
    const timeoutMs = providerConfigStore.providerCheckTimeout?.(profile) || 60000
    return new Promise((resolve, reject) => {
      const req = transport.request(url, { method: 'GET', headers }, res => {
        let raw = ''
        res.on('data', chunk => {
          raw += String(chunk)
          if (Buffer.byteLength(raw) > MAX_RESPONSE_BYTES) {
            req.destroy(new Error('Réponse /models trop volumineuse.'))
          }
        })
        res.on('end', () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            try {
              const parsed = JSON.parse(raw || '{}')
              reject(new Error(parsed?.error?.message || parsed?.error || parsed?.message || `HTTP ${res.statusCode}`))
            } catch {
              reject(new Error(raw || `HTTP ${res.statusCode}`))
            }
            return
          }
          try {
            resolve(JSON.parse(raw || '{}'))
          } catch (error) {
            reject(new Error(`Réponse /models JSON invalide: ${error.message}`))
          }
        })
      })
      req.setTimeout(timeoutMs, () => {
        req.destroy(new Error(`Découverte /models timeout after ${Math.round(timeoutMs / 1000)}s.`))
      })
      req.on('error', reject)
      req.end()
    })
  }

  async function discover(payload = {}) {
    const profile = sourceProfile(payload)
    const parsed = await requestModels(profile)
    const models = extractModels(parsed)
    return {
      ok: true,
      baseUrl: providerConfigStore.baseUrl(profile),
      providerName: providerDisplayName(profile),
      imported: false,
      count: models.length,
      truncated: models.length >= MAX_DISCOVERED_MODELS,
      models,
    }
  }

  async function discoverAndImport(payload = {}) {
    const profile = sourceProfile(payload)
    const parsed = await requestModels(profile)
    const models = extractModels(parsed)
    if (!models.length) throw new Error('Aucun modèle découvert via /models.')
    const profiles = models.map(model => profilePayloadForModel(profile, model))
    const config = providerConfigStore.importConfig({ profiles })
    return {
      ok: true,
      imported: true,
      count: profiles.length,
      truncated: models.length >= MAX_DISCOVERED_MODELS,
      models,
      config,
    }
  }

  return { discover, discoverAndImport, extractModels, modelListUrl }
}

module.exports = {
  MAX_DISCOVERED_MODELS,
  createProviderModelDiscovery,
  extractModels,
  modelListUrl,
}
