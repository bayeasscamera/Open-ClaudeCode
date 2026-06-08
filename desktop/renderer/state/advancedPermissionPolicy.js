(function () {
  function clean(value, max = 400) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max)
  }

  function normalized(value = '') {
    return clean(value, 2000)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
  }

  function pathLooksOutsideWorkspace(text = '', root = '') {
    const workspaceRoot = clean(root, 500)
    const absolutePaths = String(text || '').match(/(?:^|\s)(\/[^\s"'`;&|]+)/g) || []
    if (!absolutePaths.length || !workspaceRoot) return false
    return absolutePaths
      .map(path => path.trim())
      .some(path => !path.startsWith(`${workspaceRoot}/`) && path !== workspaceRoot)
  }

  function categoriesFor({ command = '', prompt = '', effectiveCwd = '', trustedWorkspaceRoot = '', workspaceTrusted = false } = {}) {
    const text = normalized(`${command}\n${prompt}`)
    const categories = new Set()
    if (!text) return []
    if (/\b(cat|ls|find|grep|rg|sed -n|head|tail|pwd)\b/.test(text)) categories.add('read')
    if (/\b(edit|write|patch|tee|sed -i|perl -pi|touch|mkdir|mv|cp)\b/.test(text)) categories.add('write_workspace')
    if (/\b(bash|sh|zsh|npm|pnpm|yarn|bun|python|node|cargo|swift|xcodebuild)\b/.test(text) || command) categories.add('shell')
    if (/\b(curl|wget|aria2c|git clone|git pull|git fetch|npm install|pnpm install|yarn install|pip install|brew install)\b/.test(text)) categories.add('network')
    if (/\b(npm install|npm ci|pnpm install|yarn install|pip install|brew install|pnpm add|npm add|yarn add)\b/.test(text)) categories.add('install')
    if (/\b(rm\s+-(?:r|f|rf|fr)|rm\s+.*\/|delete|supprime|supprimer|trash)\b/.test(text)) categories.add('delete')
    if (/\b(git push|git reset --hard|git clean|chmod -r|chown -r|sudo|dd\s+if=|mkfs|launchctl|killall)\b/.test(text)) categories.add('destructive_shell')
    if (!workspaceTrusted || pathLooksOutsideWorkspace(`${command} ${prompt} ${effectiveCwd}`, trustedWorkspaceRoot)) categories.add('outside_workspace')
    return Array.from(categories)
  }

  function riskFor(categories = []) {
    const set = new Set(categories)
    if (set.has('delete') || set.has('destructive_shell')) return 'critical'
    if (set.has('outside_workspace') && (set.has('write_workspace') || set.has('shell'))) return 'critical'
    if (set.has('install') || set.has('network')) return 'high'
    if (set.has('write_workspace') || set.has('shell')) return 'medium'
    return 'low'
  }

  function decide({
    command = '',
    prompt = '',
    permissionMode = 'default',
    workspaceTrusted = false,
    trustedWorkspaceRoot = '',
    effectiveCwd = '',
    requestedBypass = false,
    strictMode = false,
  } = {}) {
    const categories = categoriesFor({ command, prompt, effectiveCwd, trustedWorkspaceRoot, workspaceTrusted })
    const risk = riskFor(categories)
    const forceControlled = risk === 'critical' || risk === 'high'
    const blocked = Boolean(strictMode && risk === 'critical')
    const canBypass = Boolean(requestedBypass && workspaceTrusted && !forceControlled)
    const reason = blocked
      ? 'permission avancee: action critique bloquee'
      : forceControlled
      ? risk === 'critical'
        ? 'permission avancee: action critique controlee'
        : 'permission avancee: action haute sensibilite controlee'
      : canBypass
        ? 'permission avancee: bypass autorise'
        : 'permission avancee: outils controles'
    return {
      version: 1,
      mode: permissionMode,
      categories,
      risk,
      strictMode: Boolean(strictMode),
      blocked,
      canBypass,
      forceControlled,
      requiresConfirmation: forceControlled || !workspaceTrusted,
      label: blocked ? 'Action critique bloquée'
        : risk === 'critical' ? 'Action critique contrôlée'
        : risk === 'high' ? 'Action sensible contrôlée'
        : risk === 'medium' ? 'Action contrôlée'
        : 'Action faible risque',
      reason,
      detail: [
        categories.length ? `catégories ${categories.join(', ')}` : '',
        trustedWorkspaceRoot ? `workspace ${trustedWorkspaceRoot}` : '',
      ].filter(Boolean).join(' · '),
    }
  }

  function filterAllowedTools(allowedTools = [], decision = {}) {
    if (!Array.isArray(allowedTools)) return []
    if (decision?.blocked) {
      const readOnlyTools = new Set(['Read', 'Glob', 'Grep', 'LS'])
      return allowedTools.filter(tool => readOnlyTools.has(String(tool || '').split('(')[0]))
    }
    if (!decision?.forceControlled) return allowedTools.slice()
    return allowedTools.filter(tool => !/^Bash\(.+\)$/i.test(String(tool || '')))
  }

  window.OPCAdvancedPermissionPolicy = {
    categoriesFor,
    decide,
    filterAllowedTools,
    riskFor,
  }
})()
