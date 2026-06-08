(function () {
  function clear(node) {
    if (node) node.innerHTML = ''
  }

  function compact(value, max = 92) {
    const text = String(value || '').replace(/\s+/g, ' ').trim()
    if (text.length <= max) return text
    return `${text.slice(0, Math.floor((max - 3) / 2))}...${text.slice(-Math.floor((max - 3) / 2))}`
  }

  function statusLabel(check) {
    if (window.OPCProviderHealth?.statusLabel) return window.OPCProviderHealth.statusLabel(check)
    if (!check) return 'non testé'
    if (check.status === 'checking') return 'test...'
    if (check.ok) return check.warning ? `OK · ${Math.round(check.latencyMs || 0)}ms` : `${Math.round(check.latencyMs || 0)}ms`
    if (check.issue?.label) return check.issue.label
    return check.statusCode ? `erreur ${check.statusCode}` : 'erreur'
  }

  function providerKey(profile) {
    return profile.model || profile.id || profile.label
  }

  function providerTitle(profile) {
    return profile.label || profile.id || profile.model || 'Modèle'
  }

  function renderProviders(container, profiles, checksByModel, selectedModel) {
    clear(container)
    const header = document.createElement('div')
    header.className = 'inspectorTitle'
    header.innerHTML = '<span>Providers</span><strong></strong>'
    header.querySelector('strong').textContent = `${profiles.length} modèle${profiles.length > 1 ? 's' : ''}`
    container.appendChild(header)

    if (!profiles.length) {
      const empty = document.createElement('p')
      empty.className = 'inspectorEmpty'
      empty.textContent = 'Aucun provider détecté.'
      container.appendChild(empty)
      return
    }

    const summary = window.OPCProviderHealth?.auditSummary?.(profiles, checksByModel)
    if (summary) {
      const audit = document.createElement('div')
      audit.className = 'providerAuditSummary'
      const important = [
        ['ok', summary.ready],
        ['rate_limited', summary.buckets.rate_limited],
        ['timeout', summary.buckets.timeout],
        ['unsupported', summary.buckets.unsupported],
        ['needs_config', summary.buckets.needs_config],
      ].filter(([, count]) => count > 0 || summary.tested > 0)
      for (const [category, count] of important) {
        const pill = document.createElement('span')
        pill.className = `providerAuditPill ${category}`
        pill.textContent = `${window.OPCProviderHealth.categoryLabel(category)} ${count}`
        audit.appendChild(pill)
      }
      if (!important.length) {
        const pill = document.createElement('span')
        pill.className = 'providerAuditPill pending'
        pill.textContent = 'aucun test'
        audit.appendChild(pill)
      }
      container.appendChild(audit)
    }

    const list = document.createElement('div')
    list.className = 'providerStatusList'
    for (const profile of profiles) {
      const key = providerKey(profile)
      const check = checksByModel?.[key]
      const row = document.createElement('div')
      const checkClass = window.OPCProviderHealth?.statusClass ? window.OPCProviderHealth.statusClass(check) : check?.status === 'checking' ? 'checking' : check?.ok ? 'ok' : check ? 'error' : ''
      row.className = `providerStatus ${selectedModel === key ? 'selected' : ''} ${checkClass}`
      row.innerHTML = '<div><strong></strong><span></span></div><em></em>'
      row.querySelector('strong').textContent = providerTitle(profile)
      row.querySelector('span').textContent = compact([
        profile.providerName || profile.provider,
        profile.transport,
        profile.timeoutMs ? `${Math.round(profile.timeoutMs / 1000)}s` : '',
        profile.retries !== undefined ? `${profile.retries} retry` : '',
        profile.model,
      ].filter(Boolean).join(' · '), 118)
      row.querySelector('em').textContent = statusLabel(check)
      const title = window.OPCProviderHealth?.title ? window.OPCProviderHealth.title(check) : [check?.error, check?.issue?.detail, check?.warning].filter(Boolean).join('\n')
      row.title = [profile.baseUrl, title].filter(Boolean).join('\n')
      list.appendChild(row)
    }
    container.appendChild(list)
  }

  function taskLine(label, value) {
    const line = document.createElement('div')
    line.className = 'taskLine'
    line.innerHTML = '<span></span><strong></strong>'
    line.querySelector('span').textContent = label
    line.querySelector('strong').textContent = compact(value || '-', 110)
    if (value) line.title = String(value)
    return line
  }

  function renderServicePills(services = []) {
    if (!services.length) return null
    const wrap = document.createElement('div')
    wrap.className = 'servicePills'
    for (const service of services) {
      const pill = document.createElement('span')
      pill.className = `servicePill ${service.ready ? 'ready' : 'down'}`
      const label = [service.name, service.port ? `:${service.port}` : '', service.ready ? 'pret' : service.error || 'off']
        .filter(Boolean)
        .join(' ')
      pill.textContent = compact(label, 48)
      pill.title = [service.url, service.statusCode ? `HTTP ${service.statusCode}` : '', service.error].filter(Boolean).join(' · ')
      wrap.appendChild(pill)
    }
    return wrap
  }

  function renderLongTasks(container, longTasks, actions = {}) {
    const visible = (longTasks || []).slice(0, 8)
    if (!visible.length) return
    const title = document.createElement('div')
    title.className = 'inspectorSubTitle'
    title.textContent = 'Tâches longues'
    container.appendChild(title)
    const list = document.createElement('div')
    list.className = 'longTaskList'
    for (const task of visible) {
      const row = document.createElement('div')
      row.className = `longTask ${task.status || 'unknown'}`
      const details = document.createElement('div')
      details.className = 'longTaskDetails'
      const meta = document.createElement('div')
      meta.className = 'longTaskMeta'
      meta.innerHTML = '<strong></strong><span></span><em></em>'
      meta.querySelector('strong').textContent = compact(task.command || 'Commande longue', 68)
      meta.querySelector('span').textContent =
        [task.pid ? `PID ${task.pid}` : '', task.url || '', task.logPath || '', task.serviceSummary || ''].filter(Boolean).join(' · ') || compact(task.cwd || '-', 82)
      meta.querySelector('em').textContent = task.status || 'unknown'
      details.appendChild(meta)
      const pills = renderServicePills(task.services || [])
      if (pills) details.appendChild(pills)
      row.appendChild(details)
      const buttons = document.createElement('div')
      buttons.className = 'taskActions'
      if (task.url) {
        const openUrl = document.createElement('button')
        openUrl.type = 'button'
        openUrl.className = 'miniButton'
        openUrl.textContent = 'URL'
        openUrl.addEventListener('click', () => actions.open?.(task.url))
        buttons.appendChild(openUrl)
      }
      if (task.logPath) {
        const openLog = document.createElement('button')
        openLog.type = 'button'
        openLog.className = 'miniButton'
        openLog.textContent = 'Log'
        openLog.addEventListener('click', () => actions.open?.(task.logPath))
        buttons.appendChild(openLog)
      }
      if (task.pid) {
        const stop = document.createElement('button')
        stop.type = 'button'
        stop.className = 'miniButton danger'
        stop.textContent = 'Stop'
        stop.addEventListener('click', () => actions.stop?.(task.id))
        buttons.appendChild(stop)
      }
      if (buttons.children.length) row.appendChild(buttons)
      list.appendChild(row)
    }
    container.appendChild(list)
  }

  function renderRuntimeStatus(container, runtime) {
    if (!runtime || runtime.status === 'idle') return
    const box = document.createElement('div')
    box.className = `taskBox runtime-${runtime.status || 'unknown'}`
    box.appendChild(taskLine('Superviseur', runtime.phaseLabel || runtime.status || runtime.phase || 'unknown'))
    if (runtime.statusText) box.appendChild(taskLine('Activité', runtime.statusText))
    if (runtime.pid) box.appendChild(taskLine('PID actif', runtime.pid))
    if (runtime.children?.length) box.appendChild(taskLine('Enfants', runtime.children.join(', ')))
    if (runtime.currentTool?.detail) box.appendChild(taskLine('Outil', runtime.currentTool.detail))
    if (runtime.eventCount) box.appendChild(taskLine('Flux', `${runtime.eventCount} événement(s)`))
    if (runtime.idleMs >= 30000) box.appendChild(taskLine('Silence', `${Math.round(runtime.idleMs / 1000)}s`))
    if (runtime.reason) box.appendChild(taskLine('Raison', runtime.reason))
    container.appendChild(box)
    if (runtime.recentEvents?.length) {
      const title = document.createElement('div')
      title.className = 'inspectorSubTitle'
      title.textContent = 'Chronologie runtime'
      container.appendChild(title)
      const list = document.createElement('div')
      list.className = 'inspectorTools'
      for (const event of runtime.recentEvents.slice(-6)) {
        const item = document.createElement('span')
        item.textContent = compact([event.label, event.detail].filter(Boolean).join(' · '), 72)
        item.title = [event.type, event.detail].filter(Boolean).join(' · ')
        list.appendChild(item)
      }
      container.appendChild(list)
    }
  }

  function timeLabel(value) {
    const date = new Date(value || 0)
    if (Number.isNaN(date.getTime())) return ''
    return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  }

  function auditMeta(entry) {
    return [
      entry.permissionMode ? `mode ${entry.permissionMode}` : '',
      entry.skipPermissions ? 'skipPermissions' : '',
      entry.trusted ? 'trusted' : '',
      entry.source ? `source ${entry.source}` : '',
      timeLabel(entry.at),
    ].filter(Boolean).join(' · ')
  }

  function latestRuntimeDecisionAudit(audit = []) {
    return (audit || []).slice().reverse().find(entry =>
      entry.kind === 'auto-continue' ||
      entry.kind === 'preflight' ||
      entry.kind === 'run-end'
    ) || null
  }

  function runtimeDecisionSummary({ assistant = null, runtimeAudit = [] } = {}) {
    const diagnostics = assistant?.diagnostics || {}
    const decision = diagnostics.completionGuard || null
    const step = diagnostics.agentStep || (decision?.phase ? decision : null)
    const runtime = diagnostics.agentRuntime || {}
    const advancedPermission = assistant?.permissionDecision?.advanced || null
    const audit = latestRuntimeDecisionAudit(runtimeAudit)
    const items = []

    if (advancedPermission) {
      const risk = String(advancedPermission.risk || 'low')
      items.push({
        label: 'Permission avancée',
        value: risk === 'critical' ? 'risque critique'
          : risk === 'high' ? 'risque haut'
          : risk === 'medium' ? 'risque moyen'
          : 'risque faible',
        detail: [
          advancedPermission.reason,
          advancedPermission.detail,
          Array.isArray(advancedPermission.categories) && advancedPermission.categories.length ? advancedPermission.categories.join(', ') : '',
        ].filter(Boolean).join(' · '),
        tone: risk === 'critical' ? 'error' : risk === 'high' ? 'warning' : 'info',
      })
    }

    if (decision) {
      items.push({
        label: 'Décision agentique',
        value: decision.label || decision.reason || (decision.shouldContinue ? 'Relance requise' : 'Fin acceptée'),
        detail: decision.detail || '',
        tone: decision.shouldContinue ? 'warning' : 'ok',
      })
    }

    if (step?.phase) {
      items.push({
        label: 'Phase OPC',
        value: [step.phase, step.nextPhase ? `→ ${step.nextPhase}` : ''].filter(Boolean).join(' '),
        detail: step.reason || step.status || '',
        tone: step.shouldContinue ? 'warning' : 'ok',
      })
    }

    if (runtime.taskCategory || runtime.selectedModel || runtime.suggestedModel) {
      items.push({
        label: 'Runtime',
        value: [
          runtime.taskCategory || '',
          runtime.selectedModel ? `modèle ${runtime.selectedModel}` : '',
          runtime.suggestedModel ? `suggestion ${runtime.suggestedModel}` : '',
        ].filter(Boolean).join(' · '),
        detail: runtime.providerRouteReason || '',
        tone: runtime.providerRouteOk === false ? 'warning' : 'info',
      })
    }

    const guarantees = [
      runtime.requiresTools ? 'outils requis' : '',
      runtime.requiresVerification ? 'vérification requise' : '',
      runtime.contextCompacted ? `contexte compacté niveau ${runtime.contextLevel || 0}` : '',
      runtime.minInputTokens ? `min ${runtime.minInputTokens} tokens` : '',
    ].filter(Boolean)
    if (guarantees.length) {
      items.push({
        label: 'Garanties',
        value: guarantees.join(' · '),
        detail: runtime.contextEstimatedTokens ? `${runtime.contextEstimatedTokens} tokens estimés` : '',
        tone: runtime.requiresVerification || runtime.requiresTools ? 'warning' : 'info',
      })
    }

    if (audit) {
      items.push({
        label: 'Audit',
        value: audit.label || audit.kind || 'Audit runtime',
        detail: [audit.detail, audit.command, auditMeta(audit)].filter(Boolean).join(' · '),
        tone: audit.status || 'info',
      })
    }

    return items
  }

  function renderRuntimeDecision(container, assistant, runtimeAudit = []) {
    const items = runtimeDecisionSummary({ assistant, runtimeAudit })
    if (!items.length) return
    const title = document.createElement('div')
    title.className = 'inspectorSubTitle'
    title.textContent = 'Décision agentique'
    container.appendChild(title)
    const list = document.createElement('div')
    list.className = 'agentDecisionList'
    for (const item of items) {
      const row = document.createElement('div')
      row.className = `agentDecisionItem ${item.tone || 'info'}`
      row.innerHTML = '<span></span><strong></strong><em></em>'
      row.querySelector('span').textContent = item.label
      row.querySelector('strong').textContent = compact(item.value || '-', 118)
      row.querySelector('em').textContent = compact(item.detail || '', 132)
      row.title = [item.label, item.value, item.detail].filter(Boolean).join('\n')
      list.appendChild(row)
    }
    container.appendChild(list)
  }

  function renderRuntimeAudit(container, audit = []) {
    const visible = (audit || []).slice(-8).reverse()
    if (!visible.length) return
    const title = document.createElement('div')
    title.className = 'inspectorSubTitle'
    title.textContent = 'Audit runtime'
    container.appendChild(title)
    const list = document.createElement('div')
    list.className = 'runtimeAuditList'
    for (const entry of visible) {
      const row = document.createElement('div')
      row.className = `runtimeAuditItem ${entry.status || 'info'}`
      row.innerHTML = '<strong></strong><span></span><em></em>'
      row.querySelector('strong').textContent = compact(entry.label || entry.kind || 'Événement', 84)
      row.querySelector('span').textContent = compact(entry.command || entry.detail || '-', 104)
      row.querySelector('em').textContent = compact(auditMeta(entry), 118)
      row.title = [entry.kind, entry.command, entry.detail, auditMeta(entry)].filter(Boolean).join('\n')
      list.appendChild(row)
    }
    container.appendChild(list)
  }

  function renderRuntimeQuality(container, quality = null) {
    if (!quality || !Array.isArray(quality.items) || !quality.items.length) return
    const title = document.createElement('div')
    title.className = 'inspectorSubTitle'
    title.textContent = 'Qualité runtime'
    container.appendChild(title)
    const list = document.createElement('div')
    list.className = 'runtimeAuditList runtimeQualityList'
    for (const item of quality.items) {
      const row = document.createElement('div')
      row.className = `runtimeAuditItem ${item.tone || quality.tone || 'info'}`
      row.innerHTML = '<strong></strong><span></span><em></em>'
      row.querySelector('strong').textContent = compact(item.label || item.id || 'Qualité', 84)
      row.querySelector('span').textContent = String(item.value ?? 0)
      row.querySelector('em').textContent = compact(item.detail || '', 118)
      list.appendChild(row)
    }
    if (quality.topProviderHotspot) {
      const row = document.createElement('div')
      row.className = 'runtimeAuditItem warning'
      row.innerHTML = '<strong></strong><span></span><em></em>'
      row.querySelector('strong').textContent = 'Hotspot provider'
      row.querySelector('span').textContent = compact(quality.topProviderHotspot.model, 104)
      row.querySelector('em').textContent = `${quality.topProviderHotspot.count} échec(s)`
      list.appendChild(row)
    }
    container.appendChild(list)
  }

  function renderProviderRuntimeDiagnostics(container, diagnostics = null) {
    if (!diagnostics || !Array.isArray(diagnostics.items) || !diagnostics.items.length) return
    const title = document.createElement('div')
    title.className = 'inspectorSubTitle'
    title.textContent = 'Diagnostic provider'
    container.appendChild(title)
    const list = document.createElement('div')
    list.className = 'runtimeAuditList providerRuntimeDiagnostics'
    for (const item of diagnostics.items.slice(0, 5)) {
      const row = document.createElement('div')
      row.className = `runtimeAuditItem ${item.tone || diagnostics.status || 'info'}`
      row.innerHTML = '<strong></strong><span></span><em></em>'
      row.querySelector('strong').textContent = compact(item.label || item.code || 'Provider', 84)
      row.querySelector('span').textContent = compact(diagnostics.model || '-', 104)
      row.querySelector('em').textContent = compact(item.detail || '', 132)
      row.title = [item.code, item.label, item.detail].filter(Boolean).join('\n')
      list.appendChild(row)
    }
    container.appendChild(list)
  }

  function jobMeta(job) {
    return [
      job.model || '',
      job.pid ? `PID ${job.pid}` : '',
      job.eventCount ? `${job.eventCount} flux` : '',
      timeLabel(job.updatedAt),
    ].filter(Boolean).join(' · ')
  }

  function renderCompanionJobs(container, companionJobs = [], actions = {}) {
    const visible = (companionJobs || []).slice(0, 6)
    if (!visible.length) return
    const title = document.createElement('div')
    title.className = 'inspectorSubTitle'
    title.textContent = 'Tâches OPC'
    container.appendChild(title)
    const list = document.createElement('div')
    list.className = 'runtimeAuditList companionJobList'
    for (const job of visible) {
      const row = document.createElement('div')
      row.className = `runtimeAuditItem companionJob ${job.status || 'unknown'}`
      row.innerHTML = '<strong></strong><span></span><em></em>'
      row.querySelector('strong').textContent = compact(job.title || job.command || 'Tâche OPC', 84)
      row.querySelector('span').textContent = compact(job.summary || job.command || job.cwd || '-', 104)
      row.querySelector('em').textContent = compact([job.status || 'unknown', jobMeta(job)].filter(Boolean).join(' · '), 118)
      row.title = [job.title, job.status, job.command, job.cwd, job.result, job.error].filter(Boolean).join('\n')
      if (job.status === 'running' && actions.stopActive) {
        row.addEventListener('dblclick', () => actions.stopActive?.())
      }
      list.appendChild(row)
    }
    container.appendChild(list)
  }

  function ledgerMeta(entry) {
    const lastEvent = entry.events?.at(-1)
    return [
      entry.status || 'unknown',
      lastEvent?.kind ? `dernier ${lastEvent.kind}` : '',
      timeLabel(entry.updatedAt),
    ].filter(Boolean).join(' · ')
  }

  function renderAgentTaskLedger(container, agentTaskLedger = []) {
    const visible = (agentTaskLedger || []).slice(0, 6)
    if (!visible.length) return
    const title = document.createElement('div')
    title.className = 'inspectorSubTitle'
    title.textContent = 'Ledger agent'
    container.appendChild(title)
    const list = document.createElement('div')
    list.className = 'runtimeAuditList agentTaskLedgerList'
    for (const entry of visible) {
      const row = document.createElement('div')
      row.className = `runtimeAuditItem agentTask ${entry.status || 'unknown'}`
      row.innerHTML = '<strong></strong><span></span><em></em>'
      row.querySelector('strong').textContent = compact(entry.title || entry.command || 'Tâche agent', 84)
      row.querySelector('span').textContent = compact(entry.command || entry.result || entry.error || entry.cwd || '-', 104)
      row.querySelector('em').textContent = compact(ledgerMeta(entry), 118)
      row.title = [entry.title, entry.status, entry.command, entry.cwd, entry.result, entry.error].filter(Boolean).join('\n')
      list.appendChild(row)
      if (entry.stepPlan?.steps?.length) {
        const stepRow = document.createElement('div')
        stepRow.className = `runtimeAuditItem agentTask ${entry.stepPlan.blocked ? 'needs_verification' : 'running'}`
        stepRow.innerHTML = '<strong></strong><span></span><em></em>'
        const current = window.OPCAgentTaskStepEngine?.nextReadyStep?.(entry.stepPlan)
        stepRow.querySelector('strong').textContent = 'Étapes'
        stepRow.querySelector('span').textContent = compact(window.OPCAgentTaskStepEngine?.summary?.(entry.stepPlan) || '', 104)
        stepRow.querySelector('em').textContent = current ? `prochaine ${current.id}` : entry.stepPlan.blocked ? 'bloqué' : 'terminé'
        list.appendChild(stepRow)
      }
    }
    container.appendChild(list)
  }

  function workerMeta(worker) {
    return [
      worker.status || 'unknown',
      worker.phase ? `phase ${worker.phase}` : '',
      worker.currentStepId ? `étape ${worker.currentStepId}` : '',
      timeLabel(worker.updatedAt),
    ].filter(Boolean).join(' · ')
  }

  function renderAgentWorkers(container, agentWorkers = [], actions = {}) {
    const visible = (agentWorkers || []).slice(0, 6)
    if (!visible.length) return
    const title = document.createElement('div')
    title.className = 'inspectorSubTitle'
    title.textContent = 'Workers agentiques'
    container.appendChild(title)
    const list = document.createElement('div')
    list.className = 'runtimeAuditList agentWorkerList'
    for (const worker of visible) {
      const row = document.createElement('div')
      row.className = `runtimeAuditItem agentWorker ${worker.status || 'unknown'}`
      row.innerHTML = '<strong></strong><span></span><em></em><div class="taskActions"></div>'
      row.querySelector('strong').textContent = compact(worker.title || worker.prompt || 'Worker OPC', 84)
      row.querySelector('span').textContent = compact(worker.blockedReason || worker.verification || worker.result || worker.error || worker.cwd || '-', 104)
      row.querySelector('em').textContent = compact(workerMeta(worker), 118)
      row.title = [worker.id, worker.status, worker.phase, worker.prompt, worker.blockedReason, worker.verification, worker.error].filter(Boolean).join('\n')
      const buttons = row.querySelector('.taskActions')
      const availableActions = window.OPCAgentWorkerRuntime?.actionsForWorker?.(worker) || []
      for (const action of availableActions) {
        const button = document.createElement('button')
        button.type = 'button'
        button.className = `miniButton ${action.tone === 'danger' ? 'danger' : ''}`.trim()
        button.dataset.agentWorkerAction = action.id
        button.textContent = action.label
        if (action.id === 'resume') button.addEventListener('click', () => actions.resumeAgentWorker?.(worker.id))
        if (action.id === 'verify') button.addEventListener('click', () => actions.verifyAgentWorker?.(worker.id))
        if (action.id === 'interrupt') button.addEventListener('click', () => actions.interruptAgentWorker?.(worker.id))
        buttons.appendChild(button)
      }
      if (!buttons.children.length) buttons.remove()
      list.appendChild(row)
    }
    container.appendChild(list)
  }

  function renderTask(container, assistant, chat, queueLength, longTasks = [], actions = {}, runtime = null, runtimeAudit = [], companionJobs = [], agentTaskLedger = [], runtimeQuality = null, providerRuntimeDiagnostics = null, agentWorkers = []) {
    clear(container)
    const header = document.createElement('div')
    header.className = 'inspectorTitle'
    header.innerHTML = '<span>Exécution</span><strong></strong>'
    header.querySelector('strong').textContent = queueLength ? `${queueLength} en file` : 'direct'
    container.appendChild(header)

    if (!assistant || (assistant.status !== 'running' && assistant.status !== 'queued')) {
      renderRuntimeStatus(container, runtime)
      renderCompanionJobs(container, companionJobs, actions)
      renderAgentWorkers(container, agentWorkers, actions)
      renderAgentTaskLedger(container, agentTaskLedger)
      renderRuntimeQuality(container, runtimeQuality)
      renderProviderRuntimeDiagnostics(container, providerRuntimeDiagnostics)
      renderRuntimeAudit(container, runtimeAudit)
      const empty = document.createElement('p')
      empty.className = 'inspectorEmpty'
      empty.textContent = queueLength ? `${queueLength} tâche(s) en attente.` : 'Aucune tâche CLI active.'
      container.appendChild(empty)
      renderLongTasks(container, longTasks, actions)
      return
    }

    const diagnostics = assistant.diagnostics || {}
    const elapsed = diagnostics.startedAt ? `${Math.round((Date.now() - diagnostics.startedAt) / 1000)}s` : ''
    const quiet = diagnostics.lastActivityAt && assistant.status === 'running' ? Math.round((Date.now() - diagnostics.lastActivityAt) / 1000) : 0
    const firstFlux = diagnostics.firstTextAt && diagnostics.startedAt ? `${((diagnostics.firstTextAt - diagnostics.startedAt) / 1000).toFixed(1)}s` : ''
    const command = Array.isArray(diagnostics.command) ? diagnostics.command.join(' ') : diagnostics.command
    const box = document.createElement('div')
    box.className = `taskBox ${assistant.status}`
    box.appendChild(taskLine('Statut', assistant.status === 'queued' ? 'En file d’attente' : 'En cours'))
    box.appendChild(taskLine('Chat', chat?.title || 'Session'))
    box.appendChild(taskLine('Task', diagnostics.taskId || assistant.id))
    box.appendChild(taskLine('Modèle', diagnostics.model || assistant.model))
    box.appendChild(taskLine('Dossier', diagnostics.cwd || assistant.cwd))
    if (command) box.appendChild(taskLine('Commande', command))
    if (elapsed) box.appendChild(taskLine('Durée', elapsed))
    if (quiet >= 30) box.appendChild(taskLine('Silence', `${quiet}s sans nouvel événement CLI`))
    if (firstFlux) box.appendChild(taskLine('Premier flux', firstFlux))
    if (diagnostics.providerMessage) box.appendChild(taskLine('Provider', diagnostics.providerMessage))
    if (assistant.focus) box.appendChild(taskLine('Actuel', assistant.focus))
    container.appendChild(box)

    renderRuntimeDecision(container, assistant, runtimeAudit)

    if (assistant.tools?.length) {
      const title = document.createElement('div')
      title.className = 'inspectorSubTitle'
      title.textContent = 'Outils récents'
      container.appendChild(title)
      const tools = document.createElement('div')
      tools.className = 'inspectorTools'
      for (const tool of assistant.tools.slice(-6)) {
        const item = document.createElement('span')
        item.textContent = `${tool.name}${tool.target ? ` · ${compact(tool.target, 46)}` : ''}`
        item.title = tool.detail || tool.target || tool.name
        tools.appendChild(item)
      }
      container.appendChild(tools)
    }
    renderCompanionJobs(container, companionJobs, actions)
    renderAgentWorkers(container, agentWorkers, actions)
    renderAgentTaskLedger(container, agentTaskLedger)
    renderRuntimeQuality(container, runtimeQuality)
    renderProviderRuntimeDiagnostics(container, providerRuntimeDiagnostics)
    renderRuntimeAudit(container, runtimeAudit)
    renderLongTasks(container, longTasks, actions)
  }

  window.OPCInspector = { renderProviders, renderTask, runtimeDecisionSummary }
})()
