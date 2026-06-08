(function () {
  function list(value) {
    return Array.isArray(value) ? value : []
  }

  function countByModel(rows = []) {
    const counts = new Map()
    for (const row of rows) {
      const model = String(row?.model || '').trim()
      if (!model) continue
      counts.set(model, (counts.get(model) || 0) + 1)
    }
    return Array.from(counts.entries())
      .map(([model, count]) => ({ model, count }))
      .sort((a, b) => b.count - a.count || a.model.localeCompare(b.model))
  }

  function summarize({
    providerFailureHistory = [],
    taskCheckpoints = [],
    agentTaskLedger = [],
    agentWorkers = [],
    runtimeAudit = [],
    companionJobs = [],
  } = {}) {
    const providerFailures = list(providerFailureHistory).length
    const interruptedCheckpoints = list(taskCheckpoints)
      .filter(item => ['interrupted', 'error', 'stopped'].includes(String(item?.status || '')))
      .length
    const verifiedTasks = list(agentTaskLedger)
      .filter(item => ['verified', 'done'].includes(String(item?.status || '')) && (item?.verification || item?.verifiedAt || item?.status === 'verified'))
      .length
    const runningCompanions = list(companionJobs)
      .filter(item => ['running', 'queued'].includes(String(item?.status || '')))
      .length
    const activeWorkers = list(agentWorkers)
      .filter(item => ['queued', 'running', 'needs_verification'].includes(String(item?.status || '')))
      .length
    const blockedWorkers = list(agentWorkers)
      .filter(item => String(item?.status || '') === 'blocked')
      .length
    const fallbackAudits = list(runtimeAudit)
      .filter(item => ['provider-fallback', 'provider-auto-router'].includes(String(item?.kind || '')))
      .length
    const providerHotspots = countByModel(providerFailureHistory)
    const warningCount = providerFailures + interruptedCheckpoints + fallbackAudits + blockedWorkers
    const tone = warningCount > 0 ? 'warning' : 'ok'
    const items = [
      {
        id: 'provider-failures',
        label: 'Échecs provider',
        value: providerFailures,
        tone: providerFailures ? 'warning' : 'ok',
      },
      {
        id: 'interrupted-checkpoints',
        label: 'Checkpoints interrompus',
        value: interruptedCheckpoints,
        tone: interruptedCheckpoints ? 'warning' : 'ok',
      },
      {
        id: 'verified-tasks',
        label: 'Tâches vérifiées',
        value: verifiedTasks,
        tone: verifiedTasks ? 'ok' : 'info',
      },
      {
        id: 'running-companions',
        label: 'Tâches actives',
        value: runningCompanions,
        tone: runningCompanions ? 'info' : 'ok',
      },
      {
        id: 'agent-workers',
        label: 'Workers agentiques',
        value: activeWorkers,
        tone: blockedWorkers ? 'warning' : activeWorkers ? 'info' : 'ok',
      },
      {
        id: 'blocked-workers',
        label: 'Workers bloqués',
        value: blockedWorkers,
        tone: blockedWorkers ? 'warning' : 'ok',
      },
    ]

    return {
      version: 1,
      tone,
      providerFailures,
      interruptedCheckpoints,
      verifiedTasks,
      runningCompanions,
      activeWorkers,
      blockedWorkers,
      fallbackAudits,
      providerHotspots,
      topProviderHotspot: providerHotspots[0] || null,
      items,
    }
  }

  window.OPCRuntimeQualityDashboard = {
    summarize,
  }
})()
