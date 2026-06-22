/**
 * confirmationBanner.js
 *
 * Renderer-side helper for the OPC loop's human-in-the-loop gate.
 *
 * Subscribes to `opc:human-gate-prompt` (broadcast by humanGateIpc.cjs in
 * the main process) and renders a generic confirmation banner. On click,
 * the decision is sent back via `window.opc.humanGateAsk(...)` which
 * resolves the pending promise in main.
 *
 * Independent from `sessionBanner.js` so the two flows (resume proposal
 * vs. loop gate) cannot interfere. Each manages its own banner element.
 *
 * Usage (in the renderer entry point):
 *   window.createConfirmationBanner({
 *     bannerElement: document.getElementById('humanGateBanner'),
 *     invoke: window.opc.humanGateAsk,
 *   })
 */

window.createConfirmationBanner = function ({ bannerElement, invoke }) {
  if (!bannerElement) return { show() {}, hide() {} }
  if (typeof invoke !== 'function') {
    // Without invoke, we cannot send the decision back. Hide immediately.
    // eslint-disable-next-line no-console
    console.warn('confirmationBanner: invoke is not a function — gate disabled')
    return { show() {}, hide() {} }
  }

  let current = null // { id, question, context, options, timeoutMs }
  let deadlineTimer = null

  function clearStyles() {
    bannerElement.classList.add('hidden')
    bannerElement.style.display = 'none'
    bannerElement.style.margin = '0'
    bannerElement.style.padding = '0'
    bannerElement.innerHTML = ''
  }

  function render() {
    if (!current) {
      clearStyles()
      return
    }
    bannerElement.classList.remove('hidden')
    bannerElement.style.background = 'rgba(33, 150, 243, 0.15)'
    bannerElement.style.borderLeft = '4px solid #2196f3'
    bannerElement.style.padding = '12px 16px'
    bannerElement.style.margin = '10px 16px'
    bannerElement.style.borderRadius = '4px'
    bannerElement.style.display = 'flex'
    bannerElement.style.justifyContent = 'space-between'
    bannerElement.style.alignItems = 'center'
    bannerElement.style.fontSize = '13px'
    bannerElement.style.color = '#ccc'

    const ctx = current.context ? `<div style="opacity: 0.75; margin-top: 4px; font-family: monospace;">${escapeHtml(current.context)}</div>` : ''
    const options = Array.isArray(current.options) && current.options.length > 0
      ? current.options
      : ['Approve', 'Reject']

    const buttons = options
      .map((label, i) => {
        const isApprove = /approve|yes|oui/i.test(label)
        return `<button data-decision="${isApprove ? 'approved' : 'rejected'}" style="background: ${isApprove ? '#2196f3' : 'transparent'}; border: none; color: ${isApprove ? '#000' : '#ccc'}; padding: 4px 12px; cursor: pointer; border-radius: 4px; font-weight: bold;">${escapeHtml(label)}</button>`
      })
      .join('')

    bannerElement.innerHTML = `
      <div style="flex: 1; margin-right: 16px;">
        <strong>Loop demande confirmation :</strong> ${escapeHtml(current.question)}
        ${ctx}
      </div>
      <div style="display: flex; gap: 8px;">${buttons}</div>
    `

    bannerElement.querySelectorAll('button[data-decision]').forEach(btn => {
      btn.addEventListener('click', () => {
        const decision = btn.getAttribute('data-decision')
        respond(decision)
      })
    })
  }

  async function respond(decision) {
    if (!current) return
    const id = current.id
    current = null
    if (deadlineTimer) {
      clearTimeout(deadlineTimer)
      deadlineTimer = null
    }
    render()
    try {
      // The handler resolves with 'approved' | 'rejected' | 'timeout'.
      // We deliberately ignore the resolution: the main side already has the
      // answer it needs and the caller will time out anyway if the channel
      // is broken. Awaiting here would let us surface a UI error, but it
      // would also delay the next prompt.
      await invoke(id, decision)
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('confirmationBanner: invoke failed', err)
    }
  }

  function show(prompt) {
    if (!prompt || !prompt.id) return
    current = {
      id: String(prompt.id),
      question: String(prompt.question || ''),
      context: prompt.context ? String(prompt.context) : '',
      options: Array.isArray(prompt.options) ? prompt.options.slice(0, 4) : ['Approve', 'Reject'],
      timeoutMs: Number(prompt.timeoutMs) || 60000,
    }
    if (deadlineTimer) clearTimeout(deadlineTimer)
    deadlineTimer = setTimeout(() => {
      if (current) respond('timeout')
    }, current.timeoutMs)
    render()
  }

  function hide() {
    current = null
    if (deadlineTimer) {
      clearTimeout(deadlineTimer)
      deadlineTimer = null
    }
    render()
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }

  return { show, hide }
}
