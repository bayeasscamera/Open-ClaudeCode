const http = require('node:http')
const { createNvidiaClient } = require('./nvidiaClient.cjs')
const { createRateLimiter, sendRateLimited } = require('./rateLimiter.cjs')
const { createAuthToken, isAuthorized, readJsonBody, sendJson } = require('./providerBridgeHttp.cjs')
const {
  buildAnthropicRequest,
  buildGitLabCodeSuggestionsRequest,
  buildOpenAIRequest,
  gitLabCodeSuggestionsText,
  writeAnthropicTextMessage,
} = require('./providerBridgeMessages.cjs')
const { createProviderBridgeStreams } = require('./providerBridgeStreams.cjs')
const { createProviderReasoningStore } = require('./providerReasoningStore.cjs')
const {
  openaiMessageToAnthropic,
} = require('./providerProtocol.cjs')
const { writeOpenAIChoiceAsAnthropicStream } = require('./providerStreamAdapter.cjs')

function createProviderBridge({ providerConfig, log, sendStatus, waitStatusIntervalMs = 10000, nvidiaClient = null }) {
  let bridge = null
  let startingBridge = null
  const client = nvidiaClient || createNvidiaClient({ providerConfig })
  const rateLimiter = createRateLimiter()
  const reasoningStore = createProviderReasoningStore()
  const bodyLimitBytes = 8 * 1024 * 1024

  function providerStatus(message, details = {}) {
    log(message)
    sendStatus({ type: 'provider_status', message, ...details })
  }

  const streams = createProviderBridgeStreams({
    client,
    providerConfig,
    providerStatus,
    reasoningStore,
    waitStatusIntervalMs,
  })

  function requestGitLabCodeSuggestions(profile, body, res) {
    const gitlabBody = buildGitLabCodeSuggestionsRequest(body, profile, providerConfig)
    client.request(
      profile,
      gitlabBody,
      upstream => {
        if (upstream.statusCode < 200 || upstream.statusCode >= 300) {
          client.sendProviderError(upstream, res)
          return
        }
        let raw = ''
        upstream.on('data', chunk => {
          raw += String(chunk)
        })
        upstream.on('end', () => {
          try {
            const parsed = JSON.parse(raw || '{}')
            const text = gitLabCodeSuggestionsText(parsed)
            providerStatus(`${providerConfig.name(profile)} a répondu via GitLab Code Suggestions.`, { model: profile.model })
            if (body.stream) {
              writeOpenAIChoiceAsAnthropicStream(res, { message: { content: text }, finish_reason: 'stop' }, profile.model)
              return
            }
            writeAnthropicTextMessage(res, text, profile.model)
          } catch (error) {
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: { message: error.message } }))
          }
        })
      },
      error => {
        const message = providerConfig.failureText(profile, error)
        providerStatus(message, { model: profile.model })
        res.writeHead(502, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: { message } }))
      },
    )
  }

  function handleMessagesRequest(_req, res, body) {
    providerConfig.reload?.()
    const profile = providerConfig.profileForModel(body.model)
    if (!profile?.apiKey && profile?.auth !== false && profile?.noAuth !== true) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: { message: `${providerConfig.providerName(profile)} provider is not configured.` } }))
      return
    }
    if (providerConfig.upstreamApi(profile) === 'anthropic') {
      const anthropicBody = buildAnthropicRequest(body, profile, providerConfig)
      if (body.stream) {
        streams.streamAnthropicSelectedModel(profile, anthropicBody, res)
        return
      }
      streams.requestAnthropicAsMessage(profile, anthropicBody, res)
      return
    }
    if (providerConfig.upstreamApi(profile) === 'gitlab-code-suggestions') {
      requestGitLabCodeSuggestions(profile, body, res)
      return
    }
    const openaiBody = buildOpenAIRequest(body, profile, providerConfig, { reasoningStore })
    if (body.stream) {
      if (providerConfig.shouldUseBufferedUpstream(profile)) {
        streams.streamBufferedOpenAIAsAnthropic(profile, openaiBody, res)
        return
      }
      streams.streamOpenAISelectedModel(profile, openaiBody, res)
      return
    }
    client.request(
      profile,
      openaiBody,
      upstream => {
        if (upstream.statusCode < 200 || upstream.statusCode >= 300) {
          client.sendProviderError(upstream, res)
          return
        }
        let raw = ''
        upstream.on('data', chunk => {
          raw += String(chunk)
        })
        upstream.on('end', () => {
          if (upstream.statusCode < 200 || upstream.statusCode >= 300) {
            res.writeHead(upstream.statusCode || 500, { 'Content-Type': 'application/json' })
            res.end(raw || JSON.stringify({ error: { message: `${providerConfig.providerName(profile)} request failed.` } }))
            return
          }
          try {
            const parsed = JSON.parse(raw)
            if (providerConfig.capabilities?.(profile)?.reasoningPassThrough) {
              reasoningStore.recordChoice(profile, parsed.choices?.[0])
            }
            const payload = openaiMessageToAnthropic(parsed.choices?.[0], profile.model)
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify(payload))
          } catch (error) {
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: { message: error.message } }))
          }
        })
      },
      error => {
        const message = providerConfig.failureText(profile, error)
        providerStatus(message, { model: profile.model })
        res.writeHead(502, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: { message } }))
      },
    )
  }

  async function start() {
    if (bridge) return bridge
    if (startingBridge) return startingBridge
    providerConfig.load()
    const authToken = createAuthToken()

    startingBridge = new Promise(resolve => {
      const server = http.createServer(async (req, res) => {
        if (!isAuthorized(req, authToken)) {
          sendJson(res, 401, { error: { message: 'Unauthorized provider bridge request.' } })
          return
        }
        if (!rateLimiter.allow()) {
          sendRateLimited(res)
          return
        }
        if (req.method === 'GET' && (req.url === '/models' || req.url === '/v1/models')) {
          sendJson(res, 200, { object: 'list', data: providerConfig.profiles().map(profile => ({ id: profile.model, object: 'model' })) })
          return
        }
        if (req.method !== 'POST' || !['/messages', '/v1/messages'].includes(new URL(req.url, 'http://localhost').pathname)) {
          sendJson(res, 404, { error: { message: 'Not found' } })
          return
        }
        try {
          handleMessagesRequest(req, res, await readJsonBody(req, { limitBytes: bodyLimitBytes }))
        } catch (error) {
          sendJson(res, error.statusCode || 400, { error: { message: error.message } })
        }
      })
      server.listen(0, '127.0.0.1', () => {
        const port = server.address().port
        log(`Provider bridge listening on 127.0.0.1:${port}`)
        resolve({ server, port, authToken })
      })
    })
    try {
      bridge = await startingBridge
      return bridge
    } finally {
      startingBridge = null
    }
  }

  function close() {
    if (bridge?.server) bridge.server.close()
    bridge = null
  }

  function current() {
    return bridge
  }

  return { start, close, current }
}

module.exports = { createProviderBridge }
