(function () {
  function clean(value, max = 1000) {
    return String(value || '')
      .replace(/\u0000/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, max)
  }

  function evidenceKind(description = {}) {
    if (description.verifies) return 'verification'
    if (description.mutates) return 'write'
    if (description.category === 'file-read') return 'read'
    if (description.category === 'search') return 'search'
    if (description.category === 'web') return 'web'
    if (description.category === 'subtask') return 'subtask'
    if (description.category === 'shell') return 'shell'
    return 'tool'
  }

  function targetFromTool(tool = {}, description = {}) {
    return clean(
      tool.target ||
      tool.file_path ||
      tool.path ||
      tool.command ||
      tool.code ||
      description.command ||
      tool.detail ||
      tool.name,
      1000,
    )
  }

  function fromTool(tool = {}) {
    const registry = window.OPCAgentToolRegistry
    const description = registry?.describeRecordedTool
      ? registry.describeRecordedTool(tool)
      : {
          name: clean(tool.name || tool.tool || 'outil', 80),
          category: 'generic',
          mutates: false,
          verifies: false,
          requiresVerification: false,
          command: clean(tool.command || tool.code || tool.detail || tool.target, 1000),
        }
    const target = targetFromTool(tool, description)
    const detail = clean(tool.detail || tool.output || tool.result || description.command || target, 1200)
    return {
      id: clean(tool.id || `${description.name || 'tool'}:${target || detail}`, 220),
      tool: description.name || clean(tool.name || tool.tool || 'outil', 80),
      kind: evidenceKind(description),
      category: description.category || 'generic',
      target,
      command: clean(description.command || tool.command || tool.code, 1000),
      detail,
      mutates: Boolean(description.mutates),
      verifies: Boolean(description.verifies),
      requiresVerification: Boolean(description.requiresVerification),
      failed: /\b(?:fail|failed|error|erreur|échec|echec)\b/i.test(tool.status || tool.error || detail),
      at: Number.isFinite(Number(tool.at)) ? Number(tool.at) : Date.now(),
    }
  }

  function fromRuntimeEvent(event = {}) {
    return fromTool({
      name: event.tool || event.name || event.currentTool?.name,
      target: event.target || event.command || event.currentTool?.target,
      command: event.command || event.currentTool?.command,
      detail: event.detail || event.message || event.currentTool?.detail,
      status: event.status,
      error: event.error,
      at: event.at,
    })
  }

  function summarize(evidences = []) {
    const rows = (Array.isArray(evidences) ? evidences : [])
      .map(item => item && item.kind ? item : fromTool(item))
      .filter(Boolean)
    const reads = rows.filter(item => item.kind === 'read' || item.kind === 'search').length
    const writes = rows.filter(item => item.kind === 'write').length
    const verifications = rows.filter(item => item.kind === 'verification').length
    const failures = rows.filter(item => item.failed).length
    const requiresVerification = rows.some(item => item.requiresVerification) && verifications === 0
    const proof = rows
      .filter(item => item.kind === 'verification' || item.kind === 'write' || item.failed)
      .map(item => item.command || item.target || item.detail || item.tool)
      .filter(Boolean)
      .slice(-4)
      .join(' · ')
    return {
      total: rows.length,
      reads,
      writes,
      verifications,
      failures,
      requiresVerification,
      proof: clean(proof, 600),
      last: rows.at(-1) || null,
    }
  }

  window.OPCAgentToolEvidence = {
    fromRuntimeEvent,
    fromTool,
    summarize,
  }
})()
