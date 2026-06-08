(function () {
  function createRenderScheduler({
    win = window,
    now = () => Date.now(),
    requestFrame = null,
    setTimer = setTimeout,
    minIntervalMs = 48,
    selectionHoldMs = 1400,
    selectionHoldPaddingMs = 40,
    maxSelectionDelayMs = 1200,
  } = {}) {
    let queued = false
    let lastRenderAt = 0
    const frame = requestFrame
      || win.requestAnimationFrame?.bind(win)
      || (typeof requestAnimationFrame === 'function' ? requestAnimationFrame : callback => setTimer(callback, 16))

    function activeSelectionDelay() {
      if (win.__opcIsReportSelectionActive?.()) {
        win.__opcReportSelectionHoldUntil = Math.max(
          win.__opcReportSelectionHoldUntil || 0,
          now() + selectionHoldMs,
        )
      }
      return Math.max(0, (win.__opcReportSelectionHoldUntil || 0) - now())
    }

    function schedule(callback, { force = false } = {}) {
      if (queued) return false
      const holdMs = force ? 0 : activeSelectionDelay()
      if (holdMs > 0) {
        queued = true
        setTimer(() => {
          queued = false
          schedule(callback)
        }, Math.min(holdMs + selectionHoldPaddingMs, maxSelectionDelayMs))
        return true
      }

      const delay = force ? 0 : Math.max(0, minIntervalMs - (now() - lastRenderAt))
      queued = true
      const run = () => {
        frame(() => {
          queued = false
          lastRenderAt = now()
          callback()
        })
      }
      if (delay > 0) setTimer(run, delay)
      else run()
      return true
    }

    function markRendered() {
      lastRenderAt = now()
    }

    return {
      activeSelectionDelay,
      isQueued: () => queued,
      markRendered,
      schedule,
    }
  }

  window.OPCRenderScheduler = { createRenderScheduler }
})()
