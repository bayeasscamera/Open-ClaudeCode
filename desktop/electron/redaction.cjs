const SECRET_PATTERNS = [
  /\bnvapi-[A-Za-z0-9_-]{12,}\b/g,
  /\bglpat-[A-Za-z0-9._-]{12,}\b/g,
  /\bglft-[A-Za-z0-9._-]{12,}\b/g,
  /\bsk-[A-Za-z0-9_-]{12,}\b/g,
  /\bcfut_[A-Za-z0-9_-]{12,}\b/g,
  /\b(?:Bearer|Token)\s+[A-Za-z0-9._~+/=-]{12,}\b/gi,
  /\b[A-Z0-9_]*(?:api[_-]?key|access[_-]?token|secret|password)\b\s*[:=]\s*["']?[^"'\s,;]+/gi,
  /\b(api[_-]?key|access[_-]?token|secret|password)\b\s*[:=]\s*["']?[^"'\s,;]+/gi,
]

const SECRET_KEY_RE = /(^|_)(apiKey|api_key|accessToken|access_token|token|secret|password|authorization|bearer)$/i

function redactSecrets(value) {
  let text = String(value || '')
  for (const pattern of SECRET_PATTERNS) {
    text = text.replace(pattern, match => {
      const separator = match.match(/\s*[:=]\s*/)
      if (separator && match.toLowerCase().match(/api[_-]?key|access[_-]?token|secret|password/)) {
        const [key] = match.split(separator[0])
        return `${key}${separator[0]}[REDACTED]`
      }
      const prefix = match.startsWith('Bearer ') ? 'Bearer ' : match.startsWith('Token ') ? 'Token ' : ''
      return `${prefix}[REDACTED]`
    })
  }
  return text
}

function redactDeep(value, { maxDepth = 12, maxArrayItems = 250, truncatedValue = '[Truncated]' } = {}, depth = 0) {
  if (depth > maxDepth) return truncatedValue
  if (typeof value === 'string') return redactSecrets(value)
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.slice(0, maxArrayItems).map(item => redactDeep(item, { maxDepth, maxArrayItems, truncatedValue }, depth + 1))
  const output = {}
  for (const [key, entry] of Object.entries(value)) {
    output[key] = SECRET_KEY_RE.test(key) && entry
      ? '[REDACTED]'
      : redactDeep(entry, { maxDepth, maxArrayItems, truncatedValue }, depth + 1)
  }
  return output
}

module.exports = { SECRET_KEY_RE, redactDeep, redactSecrets }
