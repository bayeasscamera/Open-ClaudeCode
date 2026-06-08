(function () {
  function currentDocument() {
    return typeof document !== 'undefined' ? document : null
  }

  function inferredToolKind(tool) {
    return tool.kind ||
      (tool.name === 'Bash'
        ? 'shell'
        : ['Edit', 'MultiEdit', 'Write', 'NotebookEdit'].includes(tool.name)
          ? 'edit'
          : ['WebSearch', 'WebFetch', 'web_search', 'wen_search', 'web_fetch'].includes(tool.name)
            ? 'web'
            : 'generic')
  }

  function renderToolFields(fields, parent, doc = currentDocument()) {
    const visibleFields = (fields || []).filter(field => field?.value).slice(0, 4)
    if (!visibleFields.length || !doc) return
    const grid = doc.createElement('div')
    grid.className = 'toolFields'
    for (const field of visibleFields) {
      const item = doc.createElement('div')
      item.className = 'toolField'
      const label = doc.createElement('span')
      label.textContent = field.label
      const value = doc.createElement('strong')
      value.textContent = field.value
      item.append(label, value)
      grid.appendChild(item)
    }
    parent.appendChild(grid)
  }

  function renderToolItem(tool, { doc = currentDocument() } = {}) {
    if (!doc) return null
    const item = doc.createElement('div')
    const kind = inferredToolKind(tool)
    const expanded = kind === 'shell' || kind === 'edit' || kind === 'write' || kind === 'web'
    const codeText = tool.code || (kind === 'shell' ? tool.command : '')
    item.className = `toolItem tool-${kind || 'generic'} ${expanded ? 'isExpanded' : ''}`

    const detail = doc.createElement('div')
    detail.className = 'toolDetail'
    const header = doc.createElement('div')
    header.className = 'toolHeader'
    const name = doc.createElement('span')
    name.className = 'toolName'
    name.textContent = tool.title || (kind === 'shell' ? 'Shell' : tool.name)
    const target = doc.createElement('span')
    target.className = 'toolTarget'
    target.textContent = kind === 'shell'
      ? tool.target || tool.command || tool.detail || tool.subtitle || 'Commande shell'
      : tool.target || tool.subtitle || tool.detail || ''
    header.append(name, target)
    detail.appendChild(header)

    if (expanded) {
      const body = doc.createElement('div')
      body.className = 'toolExpandedBody'
      if (codeText) {
        const frame = doc.createElement('div')
        frame.className = 'toolCommandFrame'
        const code = doc.createElement('pre')
        code.className = 'toolCommand'
        code.textContent = codeText
        const copy = doc.createElement('button')
        copy.type = 'button'
        copy.className = 'toolCopy'
        copy.textContent = 'Copier'
        copy.addEventListener('click', event => {
          event.preventDefault()
          event.stopPropagation()
          Promise.resolve(window.opc?.copyText?.(codeText) || navigator.clipboard?.writeText(codeText)).then(() => {
            copy.textContent = 'Copié'
            setTimeout(() => {
              copy.textContent = 'Copier'
            }, 1200)
          }).catch(() => {})
        })
        frame.append(copy, code)
        body.appendChild(frame)
      }
      renderToolFields(tool.fields, body, doc)
      detail.appendChild(body)
    }

    item.appendChild(detail)
    return item
  }

  window.OPCToolView = {
    inferredToolKind,
    renderToolFields,
    renderToolItem,
  }
})()
