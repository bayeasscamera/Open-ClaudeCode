const SECRET_PREFIX = 'opc-safe:v1:'

function createProviderSecretVault({ safeStorage = null, allowPlaintext = true } = {}) {
  function canEncrypt() {
    try {
      return Boolean(
        safeStorage &&
        typeof safeStorage.isEncryptionAvailable === 'function' &&
        safeStorage.isEncryptionAvailable() &&
        typeof safeStorage.encryptString === 'function' &&
        typeof safeStorage.decryptString === 'function'
      )
    } catch {
      return false
    }
  }

  function seal(secret) {
    const value = String(secret || '').trim()
    if (!value) return {}
    if (!canEncrypt()) {
      if (allowPlaintext) return { apiKey: value }
      throw new Error('Stockage secret indisponible: safeStorage est requis pour enregistrer une clé API.')
    }
    const encrypted = safeStorage.encryptString(value)
    return { apiKeySecret: `${SECRET_PREFIX}${Buffer.from(encrypted).toString('base64')}` }
  }

  function open(sealed) {
    const value = typeof sealed === 'string' ? sealed : sealed?.apiKeySecret
    if (!value || !String(value).startsWith(SECRET_PREFIX) || !canEncrypt()) return ''
    try {
      const raw = String(value).slice(SECRET_PREFIX.length)
      return safeStorage.decryptString(Buffer.from(raw, 'base64'))
    } catch {
      return ''
    }
  }

  return {
    canEncrypt,
    open,
    plaintextAllowed: () => Boolean(allowPlaintext),
    seal,
    storageMode: () => canEncrypt() ? 'safeStorage' : allowPlaintext ? 'plain' : 'unavailable',
  }
}

module.exports = { createProviderSecretVault, SECRET_PREFIX }
