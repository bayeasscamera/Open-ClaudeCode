(function () {
  function normalizeWorkspacePath(value) {
    let text = String(value || '')
      .replace(/\u0000/g, '')
      .trim()
    while (/^["'`]/.test(text) || /["'`]$/.test(text)) {
      const next = text.replace(/^["'`]+|["'`]+$/g, '').trim()
      if (next === text) break
      text = next
    }
    return text.replace(/\/+$/g, '') || '/'
  }

  function isRootPath(value) {
    return normalizeWorkspacePath(value) === '/'
  }

  function isInsideWorkspace(targetPath, workspaceRoot) {
    const target = normalizeWorkspacePath(targetPath)
    const root = normalizeWorkspacePath(workspaceRoot)
    if (!target || !root || isRootPath(root)) return false
    return target === root || target.startsWith(`${root}/`)
  }

  function workspaceTrustDecision({ selectedCwd = '', effectiveCwd = '', permissionMode = 'default' } = {}) {
    const root = normalizeWorkspacePath(selectedCwd)
    const cwd = normalizeWorkspacePath(effectiveCwd || selectedCwd)
    const trusted = permissionMode !== 'plan' && isInsideWorkspace(cwd, root)
    return {
      root,
      cwd,
      trusted,
      reason: trusted ? 'workspace actif approuve' : 'workspace non approuve',
    }
  }

  window.OPCWorkspaceTrust = {
    isInsideWorkspace,
    normalizeWorkspacePath,
    workspaceTrustDecision,
  }
})()
