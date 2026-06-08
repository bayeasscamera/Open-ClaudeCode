const https = require('node:https')
const http = require('node:http')
const {
  providerRequestUrl,
  requestHeaders,
  sendProviderError,
} = require('./providerTransport.cjs')

function createNvidiaClient({ providerConfig, httpsModule = https, httpModule = http }) {
  function request(profile, body, onResponse, onError) {
    const url = providerRequestUrl(providerConfig, profile)
    const payload = JSON.stringify(body)
    const timeoutMs = providerConfig.requestTimeout(profile)
    const headers = requestHeaders(profile, body, payload)
    const transport = url.protocol === 'http:' ? httpModule : httpsModule
    const req = transport.request(
      url,
      {
        method: 'POST',
        headers,
      },
      onResponse,
    )
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`${providerConfig.providerName(profile)} provider timeout after ${Math.round(timeoutMs / 1000)}s.`))
    })
    req.on('error', onError)
    req.write(payload)
    req.end()
    return req
  }

  return {
    request,
    sendProviderError,
  }
}

module.exports = { createNvidiaClient }
