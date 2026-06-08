(function () {
  function createRuntimeContextView({ actions = {} } = {}) {
    function renderProjectContext(context, parent) {
      if (!context || (!context.projectName && !context.totalFiles)) return
      const panel = document.createElement('div')
      panel.className = 'runtimeProjectContext'
      panel.innerHTML = [
        '<div class="runtimeProjectHead">',
        '<span>Contexte projet transmis</span>',
        '<strong></strong>',
        '</div>',
        '<div class="runtimeProjectStats"></div>',
        '<div class="runtimeProjectFiles"></div>',
      ].join('')
      panel.querySelector('strong').textContent = context.projectName || 'Projet'

      renderStats(context, panel.querySelector('.runtimeProjectStats'))
      const list = panel.querySelector('.runtimeProjectFiles')
      renderCompetences(context.competenceProfile, list)
      renderRuntime(context.runtime, list)
      renderSessions(context.projectSessions, list)
      renderFiles(context, list)
      parent.appendChild(panel)
    }

    function renderStats(context, parent) {
      for (const [label, value] of [
        ['attachés', context.totalFiles],
        ['indexés', context.indexedFiles],
        ['pertinents', context.relevantFiles?.length || 0],
        ['à lire', context.readNextFiles?.length || 0],
        ['compétences', context.competenceProfile?.skillCount || 0],
        ['sessions', context.projectSessions?.length || 0],
      ]) {
        const item = document.createElement('span')
        item.innerHTML = '<b></b><em></em>'
        item.querySelector('b').textContent = label
        item.querySelector('em').textContent = String(value || 0)
        parent.appendChild(item)
      }
    }

    function renderCompetences(competenceProfile, parent) {
      if (!competenceProfile?.skillCount && !competenceProfile?.practiceProfileCount) return
      const competences = document.createElement('div')
      competences.className = 'runtimeProjectCompetences'
      const title = document.createElement('strong')
      title.textContent = 'Compétences transmises'
      competences.appendChild(title)
      const chips = document.createElement('div')
      chips.className = 'runtimeProjectStats'
      for (const domain of (competenceProfile.domains || []).slice(0, 6)) {
        const chip = document.createElement('span')
        chip.innerHTML = '<b></b><em></em>'
        chip.querySelector('b').textContent = domain.name
        chip.querySelector('em').textContent = String(domain.count || 0)
        chips.appendChild(chip)
      }
      competences.appendChild(chips)
      parent.appendChild(competences)
    }

    function renderRuntime(runtime, parent) {
      if (!runtime?.cwd && !runtime?.model && !runtime?.permissionMode) return
      const block = document.createElement('div')
      block.className = 'runtimeProjectRuntime'
      block.innerHTML = '<strong>Runtime projet</strong><span></span>'
      block.querySelector('span').textContent = [
        runtime.cwd,
        runtime.model,
        runtime.permissionMode,
        runtime.memoryEnabled ? 'mémoire active' : 'mémoire pause',
      ].filter(Boolean).join(' · ')
      parent.appendChild(block)
    }

    function renderSessions(sessions, parent) {
      const list = Array.isArray(sessions) ? sessions.slice(0, 3) : []
      if (!list.length) return
      const block = document.createElement('div')
      block.className = 'runtimeProjectSessions'
      const title = document.createElement('strong')
      title.textContent = 'Sessions projet transmises'
      block.appendChild(title)
      for (const session of list) {
        const item = document.createElement('span')
        item.textContent = session.title || session.lastUser || 'Session'
        block.appendChild(item)
      }
      parent.appendChild(block)
    }

    function renderFiles(context, parent) {
      const files = runtimeProjectFiles(context)
      if (!files.length) {
        const empty = document.createElement('p')
        empty.textContent = 'Aucun fichier projet transmis pour cette session.'
        parent.appendChild(empty)
        return
      }
      for (const file of files) parent.appendChild(runtimeProjectFileRow(file))
    }

    function runtimeProjectFiles(context) {
      const byPath = new Map()
      for (const file of [...(context.readNextFiles || []), ...(context.relevantFiles || []), ...(context.attachedFiles || [])]) {
        if (!file?.path || byPath.has(file.path)) continue
        byPath.set(file.path, file)
        if (byPath.size >= 6) break
      }
      return Array.from(byPath.values())
    }

    function runtimeProjectFileRow(file) {
      const row = document.createElement('div')
      row.className = `runtimeProjectFile role-${file.role || 'attached'}`
      row.innerHTML = [
        '<div><strong></strong><span></span><em></em></div>',
        '<div class="runtimeProjectActions">',
        '<button type="button" class="open">Ouvrir</button>',
        '<button type="button" class="copy">Copier chemin</button>',
        '</div>',
      ].join('')
      row.querySelector('strong').textContent = file.name || 'Fichier'
      row.querySelector('span').textContent = file.path || ''
      row.querySelector('em').textContent = [
        file.role === 'read-next' ? 'priorité forte' : file.role === 'relevant' ? 'pertinent' : 'attaché',
        file.score ? `score ${file.score}` : '',
        file.summary || '',
      ].filter(Boolean).join(' · ')
      row.querySelector('.open').addEventListener('click', () => actions.openPath?.(file.path))
      row.querySelector('.copy').addEventListener('click', () => actions.copyText?.(file.path))
      return row
    }

    return { renderProjectContext }
  }

  window.OPCRuntimeContextView = { createRuntimeContextView }
})()
