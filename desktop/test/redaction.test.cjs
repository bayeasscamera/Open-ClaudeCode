const assert = require('node:assert/strict')
const test = require('node:test')
const { redactDeep, redactSecrets } = require('../electron/redaction.cjs')

test('redaction removes secrets from free text', () => {
  const redacted = redactSecrets('api_key: nvapi-secretSECRET1234567890\nAuthorization: Bearer sk-secretSECRET1234567890')

  assert.doesNotMatch(redacted, /nvapi-secret/)
  assert.doesNotMatch(redacted, /sk-secret/)
  assert.match(redacted, /\[REDACTED\]/)
})

test('deep redaction removes nested secret fields and bounds arrays', () => {
  const redacted = redactDeep({
    apiKey: 'sk-secretSECRET1234567890',
    nested: {
      authorization: 'Bearer secret-token-1234567890',
      text: 'password: super-secret',
    },
    rows: Array.from({ length: 300 }, (_, index) => ({ index })),
  })

  assert.equal(redacted.apiKey, '[REDACTED]')
  assert.equal(redacted.nested.authorization, '[REDACTED]')
  assert.match(redacted.nested.text, /\[REDACTED\]/)
  assert.equal(redacted.rows.length, 250)
})
