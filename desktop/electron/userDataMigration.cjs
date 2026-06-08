const fs = require('node:fs')
const { writePrivateJsonFile } = require('./persistence/privateJsonFile.cjs')

function readJson(filePath) {
  try {
    if (!fs.existsSync(filePath)) return { ok: true, exists: false, value: {} }
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    return {
      ok: true,
      exists: true,
      value: parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {},
    }
  } catch (error) {
    return { ok: false, exists: true, value: {}, error: error.message || String(error) }
  }
}

function atomicWriteJson(filePath, value) {
  writePrivateJsonFile(filePath, value, { atomic: true })
}

function sanitizedProviderConfig(value = {}) {
  const profiles = Array.isArray(value.profiles) ? value.profiles : []
  return {
    ...value,
    profiles: profiles.map(profile => {
      if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return profile
      if (!profile.apiKey && !profile.apiKeySecret) return profile
      const next = { ...profile, secretMigratedTo: 'OPC' }
      delete next.apiKey
      delete next.apiKeySecret
      return next
    }),
  }
}

function normalizedId(value) {
  return String(value || '').trim().toLowerCase()
}

function sameProfile(left = {}, right = {}) {
  const leftId = normalizedId(left.id)
  const leftModel = normalizedId(left.model)
  const rightId = normalizedId(right.id)
  const rightModel = normalizedId(right.model)
  return Boolean(
    (leftId && rightId && leftId === rightId) ||
    (leftModel && rightModel && leftModel === rightModel) ||
    (leftId && rightModel && leftId === rightModel) ||
    (leftModel && rightId && leftModel === rightId)
  )
}

function alreadyMigrated(value = {}) {
  return String(value?.migratedTo || '').trim().toUpperCase() === 'OPC'
}

function markLegacyProviderConfigMigrated(filePath, value = {}) {
  atomicWriteJson(filePath, sanitizedProviderConfig({
    ...value,
    migratedTo: 'OPC',
    migratedAt: value.migratedAt || new Date().toISOString(),
  }))
}

function mergeProviderConfig(canonicalRaw = {}, legacyRaw = {}) {
  const canonicalProfiles = Array.isArray(canonicalRaw.profiles) ? canonicalRaw.profiles : []
  const legacyProfiles = Array.isArray(legacyRaw.profiles) ? legacyRaw.profiles : []
  const profiles = canonicalProfiles.slice()
  let added = 0

  for (const profile of legacyProfiles) {
    if (!profile || typeof profile !== 'object' || Array.isArray(profile)) continue
    if (profiles.some(existing => sameProfile(existing, profile))) continue
    profiles.push(profile)
    added += 1
  }

  return {
    config: {
      ...legacyRaw,
      ...canonicalRaw,
      baseUrl: canonicalRaw.baseUrl || legacyRaw.baseUrl,
      defaultModel: canonicalRaw.defaultModel || legacyRaw.defaultModel,
      profiles,
    },
    added,
  }
}

function migrateLegacyProviderConfig({ canonicalPath, legacyPaths = [] } = {}) {
  if (!canonicalPath || !Array.isArray(legacyPaths) || !legacyPaths.length) {
    return { migrated: false, added: 0 }
  }

  const canonical = readJson(canonicalPath)
  if (!canonical.ok) {
    return {
      migrated: false,
      added: 0,
      error: `Configuration provider canonique illisible: ${canonical.error}`,
    }
  }

  let next = canonical.value
  let added = 0
  const usedLegacyPaths = []
  for (const legacyPath of legacyPaths) {
    const legacy = readJson(legacyPath)
    if (!legacy.ok) continue
    if (alreadyMigrated(legacy.value)) continue
    const legacyProfiles = Array.isArray(legacy.value.profiles) ? legacy.value.profiles : []
    if (!legacy.exists || !legacyProfiles.length) continue
    const merged = mergeProviderConfig(next, legacy.value)
    if (merged.added > 0 || !canonical.exists) usedLegacyPaths.push(legacyPath)
    next = merged.config
    added += merged.added
  }

  const canonicalProfiles = Array.isArray(canonical.value.profiles) ? canonical.value.profiles.length : 0
  const nextProfiles = Array.isArray(next.profiles) ? next.profiles.length : 0
  const shouldWrite = usedLegacyPaths.length > 0 && (!canonical.exists || added > 0 || nextProfiles !== canonicalProfiles)
  if (!shouldWrite) return { migrated: false, added: 0 }

  let backupPath = ''
  if (canonical.exists) {
    backupPath = `${canonicalPath}.bak.${Date.now()}`
    atomicWriteJson(backupPath, sanitizedProviderConfig(canonical.value))
  }
  atomicWriteJson(canonicalPath, next)
  for (const legacyPath of usedLegacyPaths) {
    const legacy = readJson(legacyPath)
    if (!legacy.ok || !legacy.exists) continue
    markLegacyProviderConfigMigrated(legacyPath, legacy.value)
  }
  return {
    migrated: true,
    added,
    backupPath,
    canonicalPath,
    legacyPaths: usedLegacyPaths,
    profiles: nextProfiles,
  }
}

function redactLegacyProviderSecrets({ legacyPaths = [] } = {}) {
  if (!Array.isArray(legacyPaths) || !legacyPaths.length) return { redacted: false, files: [] }
  const files = []

  for (const legacyPath of legacyPaths) {
    const legacy = readJson(legacyPath)
    if (!legacy.ok || !legacy.exists) continue
    const profiles = Array.isArray(legacy.value.profiles) ? legacy.value.profiles : []
    let changed = false
    const redactedProfiles = profiles.map(profile => {
      if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return profile
      if (!profile.apiKey && !profile.apiKeySecret) return profile
      changed = true
      const next = { ...profile, secretMigratedTo: 'OPC' }
      delete next.apiKey
      delete next.apiKeySecret
      return next
    })
    if (!changed) continue
    const backupPath = `${legacyPath}.bak.${Date.now()}`
    atomicWriteJson(backupPath, sanitizedProviderConfig(legacy.value))
    atomicWriteJson(legacyPath, {
      ...legacy.value,
      profiles: redactedProfiles,
      migratedTo: 'OPC',
      migratedAt: new Date().toISOString(),
    })
    files.push({ path: legacyPath, backupPath, profiles: redactedProfiles.length })
  }

  return { redacted: files.length > 0, files }
}

module.exports = {
  mergeProviderConfig,
  migrateLegacyProviderConfig,
  redactLegacyProviderSecrets,
  readJson,
  sanitizedProviderConfig,
}
