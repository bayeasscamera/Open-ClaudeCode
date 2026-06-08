const { writeAnthropicStreamTextMessage } = require('./providerBridgeMessages.cjs')
const { createProviderRequestState } = require('./providerRequestState.cjs')
const {
  streamOpenAIAsAnthropic,
  writeOpenAIChoiceAsAnthropicStream,
} = require('./providerStreamAdapter.cjs')

function createProviderBridgeStreams({
  client,
  providerConfig,
  providerStatus,
  waitStatusIntervalMs = 10000,
  reasoningStore = null,
}) {
  function shouldPreserveReasoning(profile) {
    return Boolean(providerConfig.capabilities?.(profile)?.reasoningPassThrough)
  }

  function recordChoiceReasoning(profile, choice) {
    if (shouldPreserveReasoning(profile)) reasoningStore?.recordChoice?.(profile, choice)
  }

  function recordStreamReasoning(profile, trace) {
    if (shouldPreserveReasoning(profile)) reasoningStore?.record?.(profile, trace)
  }

  function streamAnthropicSelectedModel(profile, anthropicBody, res) {
    const requestState = createProviderRequestState({
      profile,
      providerConfig,
      providerStatus,
      waitStatusIntervalMs,
      waitMessage: ({ seconds }) => `${providerConfig.name(profile)} est toujours sélectionné. Attente du premier flux depuis ${seconds}s.`,
    })
    let handedOff = false

    function retryOrFail(error, statusCode = 0) {
      if (requestState.scheduleRetry({
        error,
        statusCode,
        res,
        startAttempt,
        message: ({ attempt, maxRetries }) => `${providerConfig.name(profile)} a interrompu le flux (${providerConfig.errorMessage(error)}). Nouvel essai ${attempt}/${maxRetries} sur le même modèle.`,
      })) return
      requestState.failResponse(res, error, statusCode)
    }

    function startAttempt() {
      if (!requestState.beginAttempt(({ attempt, maxRetries }) => `Envoi vers ${providerConfig.name(profile)} en protocole Anthropic. Aucun basculement automatique. Essai ${attempt}/${maxRetries + 1}.`)) return
      requestState.setActiveRequest(client.request(
        profile,
        anthropicBody,
        upstream => {
          requestState.setActiveUpstream(upstream)
          if (requestState.shouldStop()) {
            upstream.destroy()
            return
          }
          if (upstream.statusCode < 200 || upstream.statusCode >= 300) {
            if (requestState.canRetry(null, upstream.statusCode, res)) {
              upstream.resume()
              retryOrFail(new Error(`HTTP ${upstream.statusCode}`), upstream.statusCode)
              return
            }
            requestState.stopTimers()
            client.sendProviderError(upstream, res)
            return
          }

          handedOff = true
          requestState.handoff(`${providerConfig.name(profile)} a ouvert le flux ${providerConfig.providerName(profile)}. Transmission Anthropic directe au CLI.`)
          if (!res.headersSent) {
            res.writeHead(200, {
              'Content-Type': 'text/event-stream; charset=utf-8',
              'Cache-Control': 'no-cache',
              Connection: 'keep-alive',
            })
          }
          upstream.on('data', chunk => {
            if (!res.writableEnded) res.write(chunk)
          })
          upstream.on('end', () => {
            if (!res.writableEnded) res.end()
          })
          upstream.on('error', error => {
            if (!res.headersSent) retryOrFail(error)
            else if (!res.writableEnded) res.end()
          })
        },
        error => {
          retryOrFail(error)
        },
      ))
    }

    res.once('close', () => {
      if (!handedOff) requestState.close()
    })

    startAttempt()
  }

  function requestAnthropicAsMessage(profile, anthropicBody, res) {
    client.request(
      profile,
      { ...anthropicBody, stream: true },
      upstream => {
        let raw = ''
        upstream.on('data', chunk => {
          raw += String(chunk)
        })
        upstream.on('end', () => {
          if (upstream.statusCode < 200 || upstream.statusCode >= 300) {
            res.writeHead(upstream.statusCode || 502, { 'Content-Type': 'application/json' })
            res.end(raw || JSON.stringify({ error: { message: `${providerConfig.providerName(profile)} request failed.` } }))
            return
          }
          writeAnthropicStreamTextMessage(res, raw, profile.model)
        })
        upstream.on('error', error => {
          const message = providerConfig.failureText(profile, error)
          providerStatus(message, { model: profile.model })
          res.writeHead(502, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: { message } }))
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

  function streamBufferedOpenAIAsAnthropic(profile, openaiBody, res) {
    const requestState = createProviderRequestState({
      profile,
      providerConfig,
      providerStatus,
      waitStatusIntervalMs,
      waitMessage: ({ seconds }) => `${providerConfig.name(profile)} est toujours sélectionné. Attente de la réponse complète depuis ${seconds}s.`,
    })

    function fail(error, statusCode = 0) {
      if (requestState.scheduleRetry({
        error,
        statusCode,
        res,
        startAttempt,
        message: ({ attempt, maxRetries }) => `${providerConfig.name(profile)} a interrompu l'appel (${providerConfig.errorMessage(error)}). Nouvel essai ${attempt}/${maxRetries} sur le même modèle.`,
      })) return
      requestState.failResponse(res, error, statusCode)
    }

    function startAttempt() {
      if (!requestState.beginAttempt(({ attempt, maxRetries }) => `${providerConfig.name(profile)} utilise le mode provider bufferisé (${Math.round(providerConfig.requestTimeout(profile) / 1000)}s max). Aucun changement de modèle. Essai ${attempt}/${maxRetries + 1}.`)) return
      requestState.setActiveRequest(client.request(
        profile,
        { ...openaiBody, stream: false },
        upstream => {
          requestState.setActiveUpstream(upstream)
          if (upstream.statusCode < 200 || upstream.statusCode >= 300) {
            if (requestState.canRetry(null, upstream.statusCode, res)) {
              upstream.resume()
              fail(new Error(`HTTP ${upstream.statusCode}`), upstream.statusCode)
              return
            }
            requestState.stopTimers()
            client.sendProviderError(upstream, res)
            return
          }
          let raw = ''
          upstream.on('data', chunk => {
            raw += String(chunk)
          })
          upstream.on('end', () => {
            if (requestState.shouldStop()) return
            try {
              const parsed = JSON.parse(raw)
              recordChoiceReasoning(profile, parsed.choices?.[0])
              requestState.complete(`${providerConfig.name(profile)} a répondu. Transmission au CLI.`)
              writeOpenAIChoiceAsAnthropicStream(res, parsed.choices?.[0], profile.model)
            } catch (error) {
              requestState.complete()
              if (!res.headersSent) {
                res.writeHead(500, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ error: { message: error.message } }))
              }
            }
          })
          upstream.on('error', error => {
            fail(error)
          })
        },
        error => {
          fail(error)
        },
      ))
    }

    res.once('close', () => requestState.close())

    startAttempt()
  }

  function streamOpenAISelectedModel(profile, openaiBody, res) {
    const requestState = createProviderRequestState({
      profile,
      providerConfig,
      providerStatus,
      waitStatusIntervalMs,
      waitMessage: ({ seconds }) => `${providerConfig.name(profile)} est toujours sélectionné. Attente du premier flux depuis ${seconds}s.`,
    })

    function retryOrFail(error, statusCode = 0) {
      if (requestState.scheduleRetry({
        error,
        statusCode,
        res,
        startAttempt,
        message: ({ attempt, maxRetries }) => `${providerConfig.name(profile)} a interrompu le flux (${providerConfig.errorMessage(error)}). Nouvel essai ${attempt}/${maxRetries} sur le même modèle.`,
      })) return
      requestState.failResponse(res, error, statusCode)
    }

    function startAttempt() {
      if (!requestState.beginAttempt(({ attempt, maxRetries }) => `Envoi vers ${providerConfig.name(profile)}. Aucun basculement automatique. Essai ${attempt}/${maxRetries + 1}.`)) return

      requestState.setActiveRequest(client.request(
        profile,
        openaiBody,
        upstream => {
          requestState.setActiveUpstream(upstream)
          if (requestState.shouldStop()) {
            upstream.destroy()
            return
          }
          if (upstream.statusCode < 200 || upstream.statusCode >= 300) {
            if (requestState.canRetry(null, upstream.statusCode, res)) {
              upstream.resume()
              retryOrFail(new Error(`HTTP ${upstream.statusCode}`), upstream.statusCode)
              return
            }
            requestState.stopTimers()
            client.sendProviderError(upstream, res)
            return
          }

          requestState.handoff(`${providerConfig.name(profile)} a ouvert le flux ${providerConfig.providerName(profile)}. Transmission streaming au CLI.`)
          streamOpenAIAsAnthropic(upstream, res, profile.model, {
            waitStatusIntervalMs,
            onReasoningTrace: trace => recordStreamReasoning(profile, trace),
          })
        },
        error => {
          retryOrFail(error)
        },
      ))
    }

    res.once('close', () => requestState.close())

    startAttempt()
  }

  return {
    requestAnthropicAsMessage,
    streamAnthropicSelectedModel,
    streamBufferedOpenAIAsAnthropic,
    streamOpenAISelectedModel,
  }
}

module.exports = { createProviderBridgeStreams }
