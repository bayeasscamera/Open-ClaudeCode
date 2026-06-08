function installProviderBridgeCspInterceptor({
  electronSession,
  providerBridge,
  installed = false,
  log = () => {},
} = {}) {
  if (installed) return { installed: true, changed: false }
  if (!providerBridge?.port) return { installed: false, changed: false, reason: 'bridge-port-missing' }

  const webRequest = electronSession?.defaultSession?.webRequest || electronSession?.webRequest
  if (!webRequest || typeof webRequest.onHeadersReceived !== 'function') {
    log('CSP interceptor skipped: Electron webRequest unavailable.')
    return { installed: false, changed: false, reason: 'web-request-unavailable' }
  }

  webRequest.onHeadersReceived((details, callback) => {
    const headers = details.responseHeaders || {}
    const cspKey = Object.keys(headers).find(key => key.toLowerCase() === 'content-security-policy')
    const csp = cspKey ? headers[cspKey] : null
    if (csp && Array.isArray(csp)) {
      headers[cspKey] = csp.map(header => header.replace('127.0.0.1:*', `127.0.0.1:${providerBridge.port}`))
    }
    callback({ responseHeaders: headers })
  })
  log(`CSP interceptor installed for provider bridge port ${providerBridge.port}`)
  return { installed: true, changed: true }
}

module.exports = { installProviderBridgeCspInterceptor }
