(function () {
  const TOOL_DEFS = {
    Read: { category: 'file-read', mutates: false },
    Grep: { category: 'search', mutates: false },
    Glob: { category: 'search', mutates: false },
    WebSearch: { category: 'web', mutates: false },
    WebFetch: { category: 'web', mutates: false },
    Bash: { category: 'shell', mutates: true },
    Write: { category: 'file-write', mutates: true },
    Edit: { category: 'file-write', mutates: true },
    MultiEdit: { category: 'file-write', mutates: true },
    NotebookEdit: { category: 'file-write', mutates: true },
    Task: { category: 'subtask', mutates: true },
  }

  const VERIFY_COMMAND_RE = /\b(?:(?:npm|pnpm|yarn|bun)\s+(?:--prefix\s+\S+\s+)?(?:run\s+)?(?:test|check|typecheck|lint|build|verify|verify:ci)|(?:node\s+--test|pytest|cargo\s+(?:test|check)|go\s+test|swift\s+test|xcodebuild\s+test|tsc\b|eslint\b|vitest\b|playwright\s+test))\b/i
  const MUTATING_SHELL_RE = /\b(?:rm|mv|cp|mkdir|touch|tee|sed\s+-i|perl\s+-pi|python\d?\s+.*(?:write|open\(|Path\()|npm\s+install|pnpm\s+add|yarn\s+add|git\s+(?:commit|merge|rebase|push|pull))\b/i

  function compactText(value, max = 1000) {
    return String(value || '')
      .replace(/\u0000/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, max)
  }

  function canonicalName(name = '') {
    const raw = compactText(name, 80)
    if (raw === 'web_search' || raw === 'wen_search') return 'WebSearch'
    if (raw === 'web_fetch') return 'WebFetch'
    return raw
  }

  function describeTool(name = '', input = {}) {
    const toolName = canonicalName(name)
    const def = TOOL_DEFS[toolName] || { category: 'generic', mutates: false }
    const command = compactText(input.command || input.code || input.detail || input.target || input.value || '', 1000)
    const verifies = toolName === 'Bash' && VERIFY_COMMAND_RE.test(command)
    const mutates = Boolean(def.mutates && !(toolName === 'Bash' && verifies)) || (toolName === 'Bash' && MUTATING_SHELL_RE.test(command))
    return {
      name: toolName || 'outil',
      category: def.category,
      mutates,
      verifies,
      requiresVerification: Boolean(mutates && !verifies),
      command,
    }
  }

  function describeRecordedTool(tool = {}) {
    return describeTool(tool.name || tool.tool || '', {
      command: tool.command || tool.code,
      detail: tool.detail,
      target: tool.target,
      value: tool.value,
    })
  }

  window.OPCAgentToolRegistry = {
    describeRecordedTool,
    describeTool,
  }
})()
