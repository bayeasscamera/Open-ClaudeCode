(function () {
  function workspaceTrustDecision({ selectedCwd = '', effectiveCwd = '', permissionMode = 'default' } = {}) {
    return window.OPCWorkspaceTrust?.workspaceTrustDecision?.({ selectedCwd, effectiveCwd, permissionMode }) || {
      root: selectedCwd || '',
      cwd: effectiveCwd || selectedCwd || '',
      trusted: false,
      reason: 'workspace non approuve',
    }
  }

  function permissionDecision({
    permissionMode = 'default',
    actionPrompt = false,
    commandIntent = {},
    prompt = '',
    chat = null,
    conversation,
    selectedCwd = '',
    effectiveCwd = '',
  }) {
    const commandBypass = Boolean(commandIntent?.skipPermissions)
    const fullBypass = permissionMode === 'bypassPermissions' && (actionPrompt || Boolean(commandIntent?.command))
    const policyBypass = Boolean(conversation?.shouldBypassPermissionsForPrompt?.(prompt, chat, permissionMode))
    const requestedBypass = Boolean(commandBypass || fullBypass || policyBypass)
    const workspace = workspaceTrustDecision({ selectedCwd, effectiveCwd, permissionMode })
    const skipPermissions = Boolean(requestedBypass && workspace.trusted)
    const reason = requestedBypass && !workspace.trusted
      ? 'workspace non approuve'
      : skipPermissions
      ? commandBypass
        ? 'commande preautorisee'
        : fullBypass
          ? 'mode tout autoriser sur demande action'
          : 'politique conversation'
      : actionPrompt
        ? 'action limitee aux outils autorises'
        : 'message standard'
    return {
      permissionMode,
      skipPermissions,
      reason,
      requestedBypass,
      actionPrompt: Boolean(actionPrompt),
      command: commandIntent?.command || '',
      trusted: Boolean(commandIntent?.trusted),
      source: commandIntent?.source || '',
      workspaceTrusted: Boolean(workspace.trusted),
      trustedWorkspaceRoot: workspace.root || '',
      effectiveCwd: workspace.cwd || effectiveCwd || '',
      workspaceReason: workspace.reason || '',
    }
  }

  function createRunRequestPlanner({
    state,
    store,
    conversation,
    taskManager,
    projectController,
  } = {}) {
    function plan({ prompt, chat }) {
      const requestTargets = conversation.detectRequestTargets?.(prompt) || { urls: [], localPaths: [], hasExplicitTarget: false }
      const effectiveCwd = conversation.effectiveCwdForPrompt?.(prompt, state.settings.cwd) || state.settings.cwd
      const runtimeSettings = { ...state.settings, cwd: effectiveCwd, thinkEnabled: false }
      const commandIntent = conversation.commandIntentForPrompt?.(prompt, chat, state.settings.permissionMode) || {}
      const approvedCommand = commandIntent.command || conversation.approvedCommandForPrompt(prompt, chat)
      const reusableTask = approvedCommand ? taskManager?.findReusableTask?.(state.longTasks || [], approvedCommand, effectiveCwd) : null
      const project = projectController?.projectForChat?.(chat) || null
      const contextProject = project && requestTargets.localPaths?.length
        ? { ...project, runtime: { ...(project.runtime || {}), cwd: effectiveCwd } }
        : project
      const projectRuntimeContext = conversation.buildProjectRuntimeContext?.(contextProject, prompt, {
        activeChatId: chat.id,
        chats: state.chats,
        settings: runtimeSettings,
      }) || null
      const providerProfile = (state.providerProfiles || []).find(profile => profile?.model === state.settings.model) || null
      const budgetedProjectRuntime = window.OPCAgentContextBudget?.applyProjectRuntimeBudget
        ? window.OPCAgentContextBudget.applyProjectRuntimeBudget(projectRuntimeContext, { profile: providerProfile || {}, model: state.settings.model })
        : { context: projectRuntimeContext, compacted: false }
      const budgetedProjectRuntimeContext = budgetedProjectRuntime.context
      const rescueMode = Boolean(conversation.isRescuePrompt?.(prompt))
      let allowedTools = conversation.actionAllowedToolsForPrompt(prompt, chat, state.settings.permissionMode)
      const actionPrompt = Boolean(conversation.isActionPrompt?.(prompt))
      const permissions = permissionDecision({
        permissionMode: state.settings.permissionMode,
        actionPrompt,
        commandIntent,
        prompt,
        chat,
        conversation,
        selectedCwd: state.settings.cwd,
        effectiveCwd,
      })
      const advancedPermission = window.OPCAdvancedPermissionPolicy?.decide?.({
        command: commandIntent.command || approvedCommand || '',
        prompt,
        permissionMode: state.settings.permissionMode,
        workspaceTrusted: permissions.workspaceTrusted,
        trustedWorkspaceRoot: permissions.trustedWorkspaceRoot,
        effectiveCwd,
        requestedBypass: permissions.requestedBypass,
        strictMode: Boolean(state.settings.advancedPermissionStrictMode),
      }) || null
      if (advancedPermission) {
        permissions.advanced = advancedPermission
        allowedTools = window.OPCAdvancedPermissionPolicy?.filterAllowedTools
          ? window.OPCAdvancedPermissionPolicy.filterAllowedTools(allowedTools, advancedPermission)
          : allowedTools
        if (advancedPermission.forceControlled) {
          permissions.skipPermissions = false
          permissions.reason = advancedPermission.reason
        }
        if (advancedPermission.blocked) {
          permissions.blocked = true
        }
      }
      const agentRuntimeProfile = window.OPCAgentRuntimeProfile?.buildRuntimeProfile?.({
        prompt,
        permissionMode: state.settings.permissionMode,
        actionPrompt,
        commandIntent,
        contextBudget: budgetedProjectRuntime,
        permissions,
        selectedModel: state.settings.model,
        providerProfiles: state.providerProfiles || [],
      }) || null
      const cliPrompt = conversation.buildCliPrompt(chat, prompt, {
        permissionMode: state.settings.permissionMode,
        project: contextProject,
        projectRuntimeContext: budgetedProjectRuntimeContext,
        chats: state.chats,
        settings: runtimeSettings,
        thinkEnabled: false,
        requestTargets,
        commandIntent,
        agentRuntimeProfile,
      })
      return {
        requestTargets,
        effectiveCwd,
        runtimeSettings,
        commandIntent,
        approvedCommand,
        reusableTask,
        project,
        contextProject,
        projectRuntimeContext: budgetedProjectRuntimeContext,
        contextBudget: budgetedProjectRuntime,
        rescueMode,
        cliPrompt,
        allowedTools,
        actionPrompt,
        permissions,
        agentRuntimeProfile,
        trustedWorkspaceRoot: permissions.trustedWorkspaceRoot,
        taskId: store.makeId('task'),
        sessionId: chat.cliSessionId || '',
      }
    }

    return { permissionDecision, plan }
  }

  window.OPCRunRequestPlanner = {
    createRunRequestPlanner,
    permissionDecision,
    workspaceTrustDecision,
  }
})()
