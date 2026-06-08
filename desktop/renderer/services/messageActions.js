(function () {
  function currentDocument() {
    return typeof document !== 'undefined' ? document : null
  }

  function copyableMessageText(message, fallbackContent = '') {
    return String(message.content || fallbackContent || '').trim()
  }

  function createMessageActions({
    state,
    chatController,
    actions,
    doc = currentDocument(),
  } = {}) {
    function copyMessage(message, button, fallbackContent = '') {
      const text = copyableMessageText(message, fallbackContent)
      if (!text) return
      const initialLabel = button.textContent
      Promise.resolve(actions.copyText?.(text)).then(copied => {
        if (!copied) return
        button.textContent = '✓'
        button.disabled = true
        setTimeout(() => {
          button.textContent = initialLabel
          button.disabled = false
        }, 1200)
      })
    }

    function actionSpecs(message, fallbackContent = '') {
      const model = message.diagnostics?.model || message.model || state?.settings?.model
      return [
        copyableMessageText(message, fallbackContent) ? { key: 'copy', label: 'Copier', icon: '⧉', run: copyMessage } : null,
        message.role === 'user' && copyableMessageText(message, fallbackContent)
          ? { key: 'edit', label: 'Modifier', icon: '✎', run: () => actions.editUserPrompt?.(message, fallbackContent) }
          : null,
        message.role === 'assistant' && message.status === 'running'
          ? { key: 'stop', label: 'Stop', icon: '■', run: () => actions.stopActiveTask?.() }
          : null,
        message.role === 'assistant' && copyableMessageText(message, fallbackContent).split(/\s+/).filter(Boolean).length >= 80
          ? { key: 'speed-reader', label: 'Lecture rapide', icon: '▷', run: () => actions.openSpeedReader?.(copyableMessageText(message, fallbackContent)) }
          : null,
        message.role === 'assistant' && chatController.previousUserPrompt?.(message)
          ? { key: 'retry', label: 'Relancer', icon: '↻', run: () => actions.retryAssistant?.(message) }
          : null,
        message.role === 'assistant'
          ? { key: 'check-model', label: 'Tester modèle', icon: '◌', run: () => actions.runProviderCheck?.(model) }
          : null,
        message.role === 'assistant'
          ? { key: 'open-folder', label: 'Ouvrir dossier', icon: '⌂', run: () => actions.openMessageFolder?.(message) }
          : null,
      ].filter(Boolean)
    }

    function signature(message, fallbackContent = '') {
      return actionSpecs(message, fallbackContent).map(item => item.key)
    }

    function render(message, article, fallbackContent = '') {
      const ownerDocument = doc || currentDocument()
      if (!ownerDocument) return
      const items = actionSpecs(message, fallbackContent)
      if (!items.length) return
      const wrapper = ownerDocument.createElement('div')
      wrapper.className = 'messageActions'
      for (const item of items) {
        const button = ownerDocument.createElement('button')
        button.type = 'button'
        button.className = 'messageAction'
        button.textContent = item.icon || item.label
        button.title = item.label
        button.setAttribute('aria-label', item.label)
        button.dataset.action = item.key
        button.addEventListener('click', () => item.run(message, button, fallbackContent))
        wrapper.appendChild(button)
      }
      article.appendChild(wrapper)
    }

    return {
      copyableMessageText,
      render,
      signature,
    }
  }

  window.OPCMessageActions = {
    copyableMessageText,
    createMessageActions,
  }
})()
