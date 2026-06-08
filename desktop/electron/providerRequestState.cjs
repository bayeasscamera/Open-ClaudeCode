function createProviderRequestState({
  profile,
  providerConfig,
  providerStatus,
  waitStatusIntervalMs = 10000,
  waitMessage,
}) {
  const state = {
    startedAt: Date.now(),
    maxRetries: providerConfig.retryCount(profile),
    attempt: 0,
    phase: 'idle',
    closed: false,
    finished: false,
  }
  let activeReq = null
  let activeUpstream = null
  let retryTimer = null
  let waitTimer = null

  function elapsedMs() {
    return Date.now() - state.startedAt
  }

  function status(message, details = {}) {
    providerStatus(message, {
      model: profile.model,
      elapsedMs: elapsedMs(),
      attempt: state.attempt,
      maxRetries: state.maxRetries,
      ...details,
    })
  }

  function startWaitTimer() {
    if (!waitStatusIntervalMs || waitTimer) return
    waitTimer = setInterval(() => {
      if (state.closed || state.finished) return
      const seconds = Math.round(elapsedMs() / 1000)
      status(waitMessage({ seconds, elapsedMs: elapsedMs(), attempt: state.attempt, maxRetries: state.maxRetries }))
    }, waitStatusIntervalMs)
  }

  function cleanupTimers() {
    if (waitTimer) clearInterval(waitTimer)
    if (retryTimer) clearTimeout(retryTimer)
    waitTimer = null
    retryTimer = null
  }

  function cancelActiveRequest() {
    if (activeReq) activeReq.destroy()
    if (activeUpstream) activeUpstream.destroy()
  }

  function shouldStop() {
    return state.closed || state.finished
  }

  function beginAttempt(message) {
    if (shouldStop()) return false
    state.attempt += 1
    state.phase = 'requesting'
    activeReq = null
    activeUpstream = null
    status(message({ attempt: state.attempt, maxRetries: state.maxRetries, elapsedMs: elapsedMs() }))
    return true
  }

  function setActiveRequest(req) {
    activeReq = req
    return req
  }

  function setActiveUpstream(upstream) {
    activeUpstream = upstream
    return upstream
  }

  function canRetry(error, statusCode, res) {
    return (
      !shouldStop() &&
      !res.headersSent &&
      providerConfig.isRetryableFailure(error, statusCode) &&
      state.attempt <= state.maxRetries
    )
  }

  function scheduleRetry({ error, statusCode = 0, res, startAttempt, message }) {
    if (!canRetry(error, statusCode, res)) return false
    const delay = providerConfig.retryDelay(state.attempt)
    state.phase = 'retry_wait'
    status(message({ error, statusCode, attempt: state.attempt, maxRetries: state.maxRetries, delay }), {
      retryDelayMs: delay,
      statusCode,
    })
    retryTimer = setTimeout(startAttempt, delay)
    return true
  }

  function failResponse(res, error, statusCode = 0) {
    if (shouldStop()) return false
    cleanupTimers()
    state.phase = 'error'
    state.finished = true
    if (!res.headersSent) {
      const message = providerConfig.failureText(profile, error, statusCode)
      status(message, { statusCode })
      res.writeHead(statusCode || 502, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: { message } }))
    }
    return true
  }

  function complete(message = '', details = {}) {
    if (state.finished) return false
    cleanupTimers()
    state.phase = 'complete'
    state.finished = true
    if (message) status(message, details)
    return true
  }

  function handoff(message = '', details = {}) {
    if (state.finished) return false
    cleanupTimers()
    state.phase = 'handoff'
    state.finished = true
    if (message) status(message, details)
    return true
  }

  function close() {
    if (state.finished) return
    state.closed = true
    state.phase = 'closed'
    cleanupTimers()
    cancelActiveRequest()
  }

  startWaitTimer()

  return {
    beginAttempt,
    canRetry,
    close,
    complete,
    elapsedMs,
    failResponse,
    handoff,
    scheduleRetry,
    setActiveRequest,
    setActiveUpstream,
    shouldStop,
    snapshot: () => ({ ...state, elapsedMs: elapsedMs() }),
    stopTimers: cleanupTimers,
  }
}

module.exports = { createProviderRequestState }
