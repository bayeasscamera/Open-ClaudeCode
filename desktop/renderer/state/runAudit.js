(function () {
  function commandDecisionAudit({
    permissionMode = 'default',
    taskId = '',
    assistantId = '',
    commandIntent = {},
    approvedCommand = '',
    allowedTools = [],
    skipPermissions = false,
    permissionDecision = null,
  } = {}) {
    const command = approvedCommand || commandIntent.command || ''
    const hasCommand = Boolean(command)
    const trusted = Boolean(commandIntent.trusted)
    const workspaceBlocked = Boolean(permissionDecision?.requestedBypass && permissionDecision?.workspaceTrusted === false)
    const advanced = permissionDecision?.advanced || null
    const advancedControlled = Boolean(advanced?.forceControlled)
    const status = advancedControlled ? 'warning' : skipPermissions ? 'ok' : hasCommand || workspaceBlocked ? 'warning' : 'info'
    const label = advancedControlled
      ? advanced.label || 'Permission avancée contrôlée'
      : skipPermissions
      ? 'Tout autoriser demande'
      : workspaceBlocked
        ? 'Workspace non approuve'
      : trusted
        ? 'Commande approuvee'
        : hasCommand
          ? 'Commande limitee aux outils autorises'
          : allowedTools.length
            ? 'Outils limites'
            : 'Message standard'
    const detail = advancedControlled
      ? [advanced.reason, advanced.detail].filter(Boolean).join(' · ')
      : permissionDecision?.reason || commandIntent.reason || [
      hasCommand ? `commande ${command}` : '',
      allowedTools.length ? `${allowedTools.length} outil(s)` : '',
      skipPermissions ? 'skipPermissions actif' : '',
    ].filter(Boolean).join(' · ')
    return {
      taskId,
      assistantId,
      command,
      source: commandIntent.source || '',
      permissionMode,
      skipPermissions,
      trusted,
      status,
      label,
      detail,
    }
  }

  window.OPCRunAudit = {
    commandDecisionAudit,
  }
})()
