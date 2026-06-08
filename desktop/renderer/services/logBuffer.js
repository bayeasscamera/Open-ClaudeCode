(function () {
  const SECRET_PATTERNS = [
    /\bnvapi-[A-Za-z0-9_-]{12,}\b/g,
    /\bsk-[A-Za-z0-9_-]{12,}\b/g,
    /\bcfut_[A-Za-z0-9_-]{12,}\b/g,
    /\b(?:Bearer|Token)\s+[A-Za-z0-9._~+/=-]{12,}\b/gi,
    /\b(api[_-]?key|access[_-]?token|secret|password)\b\s*[:=]\s*["']?[^"'\s,;]+/gi,
  ]

  function redactSecrets(value) {
    let text = String(value || '')
    for (const pattern of SECRET_PATTERNS) {
      text = text.replace(pattern, match => {
        const separator = match.match(/\s*[:=]\s*/)
        if (separator && /api[_-]?key|access[_-]?token|secret|password/i.test(match)) {
          const [key] = match.split(separator[0])
          return `${key}${separator[0]}[REDACTED]`
        }
        const prefix = /^Bearer\s+/i.test(match) ? 'Bearer ' : /^Token\s+/i.test(match) ? 'Token ' : ''
        return `${prefix}[REDACTED]`
      })
    }
    return text
  }

  function createLogBuffer({
    element,
    win = window,
    requestFrame = null,
    setTimer = setTimeout,
    maxLines = 900,
    maxLineChars = 4000,
  } = {}) {
    let lines = []
    let renderQueued = false
    const frame = requestFrame
      || win.requestAnimationFrame?.bind(win)
      || (typeof requestAnimationFrame === 'function' ? requestAnimationFrame : callback => setTimer(callback, 16))

    function render() {
      renderQueued = false
      if (!element) return
      element.textContent = lines.join('\n')
      element.scrollTop = element.scrollHeight
    }

    function scheduleRender() {
      if (renderQueued) return
      renderQueued = true
      frame(render)
    }

    function append(line) {
      const text = redactSecrets(line)
      lines.push(text.length > maxLineChars ? `${text.slice(0, Math.max(0, maxLineChars - 3))}...` : text)
      if (lines.length > maxLines) lines = lines.slice(-maxLines)
      scheduleRender()
    }

    function clear() {
      lines = []
      renderQueued = false
      if (!element) return
      element.textContent = ''
      element.scrollTop = 0
    }

    return {
      append,
      clear,
      flush: render,
      lines: () => lines.slice(),
    }
  }

  window.OPCLogBuffer = { createLogBuffer, redactSecrets }
})()
