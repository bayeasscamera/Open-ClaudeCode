const crypto = require('node:crypto')

function createAuthToken() {
  return crypto.randomBytes(32).toString('hex')
}

function isAuthorized(req, authToken) {
  return String(req.headers.authorization || '') === `Bearer ${authToken}`
}

function sendJson(res, statusCode, payload) {
  if (res.headersSent) return
  res.writeHead(statusCode, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(payload))
}

function readJsonBody(req, { limitBytes }) {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', chunk => {
      raw += String(chunk)
      if (Buffer.byteLength(raw) > limitBytes) {
        const error = new Error('Provider bridge request body is too large.')
        error.statusCode = 413
        reject(error)
        req.destroy()
      }
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(raw || '{}'))
      } catch (error) {
        error.statusCode = 400
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

module.exports = {
  createAuthToken,
  isAuthorized,
  readJsonBody,
  sendJson,
}
