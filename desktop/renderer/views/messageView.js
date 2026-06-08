(function () {
  function createMessageView({
    markdown,
    messageActions,
    runtimeContextView,
    runController,
    providerController,
    assistantLabel,
  } = {}) {
    function renderArticle(message, article) {
      const fallbackContent = fallbackContentFor(message)
      const signature = messageSignature(message, fallbackContent)
      article.className = `message ${message.role} status-${message.status || 'done'}`
      article.dataset.messageId = message.id
      if (article.dataset.signature === signature) return
      article.dataset.signature = signature
      article.replaceChildren()

      const bubble = document.createElement('div')
      bubble.className = 'bubble markdownBody'
      bubble.tabIndex = 0
      markdown.renderMessageContent(bubble, message.content || fallbackContent)

      if (message.role === 'assistant') {
        const meta = document.createElement('div')
        meta.className = 'meta'
        meta.innerHTML = '<span class="metaDot"></span><strong></strong>'
        meta.querySelector('strong').textContent = assistantLabel(message)
        article.appendChild(meta)
        renderActivity(message, article)
        renderTimeline(message, article)
      }

      article.appendChild(bubble)
      messageActions.render(message, article, fallbackContent)
    }

    function renderActivity(message, article) {
      if (!message.tools?.length && !message.focus && !message.projectRuntimeContext) return
      const isActive = message.status === 'running' || message.status === 'queued'
      const isError = message.status === 'error'
      const isCompact = !isActive && !isError
      const activityPanel = document.createElement('div')
      activityPanel.className = `activityPanel${isCompact ? ' activityPanelCompact' : ''}`
      const current = document.createElement('div')
      current.className = 'activityCurrent'
      current.innerHTML = '<span class="activityState"></span><strong></strong>'
      current.querySelector('.activityState').textContent = isActive ? 'En cours' : isError ? 'Erreur' : 'Terminé'
      current.querySelector('strong').textContent = message.focus || 'Analyse du contexte'
      activityPanel.appendChild(current)
      if (isCompact) {
        article.appendChild(activityPanel)
        return
      }
      renderSessionProgress(message, activityPanel)
      renderDiagnostics(message, activityPanel)
      runtimeContextView.renderProjectContext(message.projectRuntimeContext, activityPanel)
      renderExecutionSteps(message, activityPanel)

      if (message.tools?.length) {
        const list = document.createElement('div')
        list.className = 'toolList'
        for (const tool of message.tools.slice(-8)) {
          const item = window.OPCToolView.renderToolItem(tool)
          if (item) list.appendChild(item)
        }
        activityPanel.appendChild(list)
      }
      article.appendChild(activityPanel)
    }

    function renderDiagnostics(message, parent) {
      const items = runController.diagnosticItems(message, providerController.modelLabel)
      if (!items.length) return
      const diagnostics = document.createElement('div')
      diagnostics.className = 'diagnostics'
      for (const [label, value] of items) {
        const item = document.createElement('span')
        item.className = 'diagnosticItem'
        item.innerHTML = '<b></b><span></span>'
        item.querySelector('b').textContent = label
        item.querySelector('span').textContent = value
        diagnostics.appendChild(item)
      }
      parent.appendChild(diagnostics)
    }

    function renderSessionProgress(message, parent) {
      const progress = runController.sessionProgress?.(message)
      if (!progress) return
      const value = Math.max(0, Math.min(100, Number(progress.value) || 0))
      const wrapper = document.createElement('div')
      wrapper.className = `sessionProgress tone-${progress.tone || 'running'}`

      const meta = document.createElement('div')
      meta.className = 'sessionProgressMeta'
      const label = document.createElement('span')
      label.textContent = progress.label || 'Session en cours'
      const percent = document.createElement('strong')
      percent.textContent = `${Math.round(value)}%`
      meta.append(label, percent)

      const track = document.createElement('div')
      track.className = 'sessionProgressTrack'
      const fill = document.createElement('span')
      fill.style.width = `${value}%`
      track.appendChild(fill)

      const detail = document.createElement('div')
      detail.className = 'sessionProgressDetail'
      detail.textContent = progress.detail || ''

      wrapper.append(meta, track, detail)
      parent.appendChild(wrapper)
    }

    function renderExecutionSteps(message, parent) {
      const steps = (message.runtimeSteps || [])
        .filter(step => step?.type !== 'stream')
        .slice(-6)
      if (!steps.length) return
      const list = document.createElement('div')
      list.className = 'executionSteps'
      for (const step of steps) {
        const item = document.createElement('div')
        item.className = `executionStep step-${step.type || 'event'}`
        item.innerHTML = '<span></span><strong></strong><em></em>'
        item.querySelector('span').textContent = step.label || step.type || 'Activité'
        item.querySelector('strong').textContent = step.detail || step.label || ''
        item.querySelector('em').textContent = step.at ? new Date(step.at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : ''
        list.appendChild(item)
      }
      parent.appendChild(list)
    }

    function renderTimeline(message, article) {
      if (!message.events?.length) return
      const timeline = document.createElement('div')
      timeline.className = 'timeline'
      for (const event of message.events.slice(-6)) {
        const chip = document.createElement('span')
        chip.className = 'chip'
        chip.textContent = event
        timeline.appendChild(chip)
      }
      article.appendChild(timeline)
    }

    function fallbackContentFor(message) {
      if (message.status === 'queued') return 'En file d’attente...'
      if (message.status === 'running') return message.tools?.length ? 'Analyse en cours...' : '...'
      return ''
    }

    function messageSignature(message, fallbackContent = '') {
      return JSON.stringify({
        role: message.role,
        status: message.status || 'done',
        content: message.content || fallbackContent,
        focus: message.focus || '',
        events: message.events || [],
        progress: runController.sessionProgress?.(message),
        tools: (message.tools || []).map(tool => [
          tool.id,
          tool.name,
          tool.kind,
          tool.title,
          tool.target,
          tool.detail,
          tool.command,
          tool.code,
          tool.fields,
        ]),
        runtimeSteps: (message.runtimeSteps || []).map(step => [step.type, step.label, step.detail, step.at]),
        projectRuntimeContext: message.projectRuntimeContext || null,
        diagnostics: runController.diagnosticItems(message, providerController.modelLabel),
        actions: messageActions.signature(message, fallbackContent),
      })
    }

    return { renderArticle }
  }

  window.OPCMessageView = { createMessageView }
})()
