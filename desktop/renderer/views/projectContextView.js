(function () {
  function createProjectContextView({
    els,
    actions = {},
    projectController,
    store,
    nowLabel,
    projectFileLabel,
  } = {}) {
    let projectContextNode = null
    let projectContextSignature = ''
    let emptyProjectNode = null
    let emptyProjectSignature = ''

    function reset() {
      projectContextNode = null
      projectContextSignature = ''
      emptyProjectNode = null
      emptyProjectSignature = ''
    }

    function projectSignature(project, competenceProfile) {
      return JSON.stringify({
        id: project.id,
        name: project.name,
        description: project.description,
        memory: project.memory,
        instructions: project.instructions,
        runtime: project.runtime,
        files: (project.files || []).map(file => [file.id, file.name, file.path, file.size]),
        fileIndex: (project.files || []).map(file => [
          file.summary,
          file.preview,
          file.searchIndex?.length,
          file.indexedAt,
          file.readNext,
          file.error,
          file.lineCount,
          file.wordCount,
          file.headings,
          file.keywords,
        ]),
        competenceProfile: window.OPCCompetenceProfile?.profileSignature?.(competenceProfile) || '',
        count: projectController?.chatCount?.(project.id) || 0,
      })
    }

    function renderProjectContext(chat) {
      const project = projectController?.projectForChat?.(chat)
      if (!project) {
        projectContextNode?.remove?.()
        projectContextNode = null
        projectContextSignature = ''
        return
      }

      const isEditing = projectContextNode?.contains?.(document.activeElement)
      const competenceProfile = window.OPCCompetenceProfile?.buildProjectCompetenceProfile?.(project) || null
      const signature = projectSignature(project, competenceProfile)
      if (projectContextNode && isEditing) return
      if (projectContextNode && projectContextSignature === signature) {
        if (els.messages.firstElementChild !== projectContextNode) els.messages.insertBefore(projectContextNode, els.messages.firstChild)
        return
      }

      projectContextSignature = signature
      const panel = document.createElement('section')
      panel.className = 'projectContextPanel'
      panel.dataset.projectId = project.id

      const count = projectController?.chatCount?.(project.id) || 0
      const header = projectHeader(project, count)
      const localContext = projectLocalContextStrip(project, count, competenceProfile)
      const grid = document.createElement('div')
      grid.className = 'projectContextGrid'
      grid.append(
        projectTextPanel({
          title: 'Mémoire',
          subtitle: 'Contexte personnel injecté dans les prochaines réponses du projet.',
          value: project.memory,
          placeholder: 'Ajoute ici les faits durables, préférences et décisions propres à ce projet.',
          onInput: value => actions.updateProjectField?.(project.id, 'memory', value),
        }),
        projectTextPanel({
          title: 'Instructions',
          subtitle: 'Règles système propres à ce projet.',
          value: project.instructions,
          placeholder: 'Ajoute ici les règles de comportement, contraintes techniques ou objectifs du projet.',
          onInput: value => actions.updateProjectField?.(project.id, 'instructions', value),
        }),
        projectRuntimePanel(project),
        projectCompetencePanel(project, competenceProfile),
        projectFilesPanel(project),
      )

      panel.append(header, localContext, grid)
      projectContextNode?.replaceWith(panel)
      projectContextNode = panel
      if (els.messages.firstElementChild !== panel) els.messages.insertBefore(panel, els.messages.firstChild)
    }

    function projectHeader(project, count) {
      const header = document.createElement('div')
      header.className = 'projectHero'
      header.innerHTML = [
        '<div>',
        '<span>Projet actif</span>',
        '<h2></h2>',
        '<p></p>',
        '</div>',
        '<div class="projectStats"><strong></strong><em></em></div>',
        '<div class="projectToolbar"></div>',
      ].join('')
      header.querySelector('h2').textContent = project.name
      header.querySelector('p').textContent = project.description || 'Espace de travail avec mémoire et instructions dédiées.'
      header.querySelector('.projectStats strong').textContent = String(count)
      header.querySelector('.projectStats em').textContent = `session${count > 1 ? 's' : ''}`

      const toolbar = header.querySelector('.projectToolbar')
      toolbar.append(
        actionButton('Modifier', () => actions.editProject?.(project.id)),
        actionButton('Importer', () => actions.importProject?.()),
        actionButton('Exporter', () => actions.exportProject?.(project.id)),
        actionButton('Supprimer', () => actions.deleteProject?.(project.id), 'danger'),
      )
      return header
    }

    function projectLocalContextStrip(project, count, competenceProfile) {
      const files = Array.isArray(project.files) ? project.files : []
      const indexed = files.filter(file => file.indexedAt || file.summary || file.searchIndex).length
      const readNext = files.filter(file => file.readNext).length
      const memoryChars = String(project.memory || '').trim().length
      const instructionsChars = String(project.instructions || '').trim().length
      const runtime = project.runtime || {}
      const overrides = [
        runtime.cwd,
        runtime.model,
        runtime.permissionMode,
        runtime.memoryEnabled === null || runtime.memoryEnabled === undefined ? '' : 'memory',
      ].filter(Boolean).length
      const strip = document.createElement('div')
      strip.className = 'projectLocalContextStrip'
      for (const [label, value, detail, tone] of [
        ['Mémoire', memoryChars ? 'active' : 'vide', memoryChars ? `${memoryChars} car.` : 'non injectée', memoryChars ? 'ok' : 'muted'],
        ['Instructions', instructionsChars ? 'actives' : 'vides', instructionsChars ? `${instructionsChars} car.` : 'globales', instructionsChars ? 'ok' : 'muted'],
        ['Fichiers', `${indexed}/${files.length}`, readNext ? `${readNext} à lire` : 'index local', indexed ? 'ok' : 'muted'],
        ['Compétences', competenceProfile?.skillCount || 0, `${competenceProfile?.domains?.length || 0} domaines`, competenceProfile?.skillCount ? 'ok' : 'muted'],
        ['Sessions', count, 'liées au projet', count ? 'ok' : 'muted'],
        ['Runtime', overrides || 'global', overrides ? 'isolé' : 'hérité', overrides ? 'ok' : 'muted'],
      ]) {
        const item = document.createElement('div')
        item.className = `projectContextTile ${tone}`
        item.innerHTML = '<span></span><strong></strong><em></em>'
        item.querySelector('span').textContent = label
        item.querySelector('strong').textContent = String(value)
        item.querySelector('em').textContent = detail
        strip.appendChild(item)
      }
      return strip
    }

    function actionButton(label, handler, tone = '') {
      const button = document.createElement('button')
      button.className = `projectActionButton ${tone}`.trim()
      button.type = 'button'
      button.textContent = label
      button.addEventListener('click', handler)
      return button
    }

    function renderEmptyProjectConversation(chat) {
      const project = !chat ? projectController?.activeProject?.() : null
      if (!project) {
        emptyProjectNode?.remove?.()
        emptyProjectNode = null
        emptyProjectSignature = ''
        return
      }

      const signature = JSON.stringify({ id: project.id, name: project.name })
      if (!emptyProjectNode || emptyProjectSignature !== signature) {
        emptyProjectSignature = signature
        const panel = document.createElement('section')
        panel.className = 'projectEmptyState'
        panel.innerHTML = [
          '<div>',
          '<strong>Aucune session dans ce projet</strong>',
          '<span>Écris un message pour créer automatiquement la première session, ou démarre-la maintenant.</span>',
          '</div>',
          '<button type="button">Nouvelle session</button>',
        ].join('')
        panel.querySelector('button').addEventListener('click', () => {
          store.createChat({ projectId: project.id })
          actions.render?.()
        })
        emptyProjectNode?.replaceWith(panel)
        emptyProjectNode = panel
      }

      const anchor = projectContextNode ? projectContextNode.nextSibling : els.messages.firstChild
      if (emptyProjectNode.parentNode !== els.messages) {
        els.messages.insertBefore(emptyProjectNode, anchor)
      } else if (projectContextNode && projectContextNode.nextSibling !== emptyProjectNode) {
        els.messages.insertBefore(emptyProjectNode, projectContextNode.nextSibling)
      }
    }

    function projectTextPanel({ title, subtitle, value, placeholder, onInput }) {
      const section = document.createElement('section')
      section.className = 'projectSectionCard'
      section.innerHTML = '<div class="projectSectionHead"><div><strong></strong><span></span></div></div>'
      section.querySelector('strong').textContent = title
      section.querySelector('span').textContent = subtitle
      const textarea = document.createElement('textarea')
      textarea.value = value || ''
      textarea.placeholder = placeholder
      textarea.rows = 5
      textarea.addEventListener('input', () => onInput(textarea.value))
      section.appendChild(textarea)
      return section
    }

    function projectRuntimePanel(project) {
      const runtime = project.runtime || {}
      const section = document.createElement('section')
      section.className = 'projectSectionCard projectRuntimeCard'
      section.innerHTML = [
        '<div class="projectSectionHead projectFilesHead">',
        '<div><strong>Runtime</strong><span>Réglages isolés automatiquement appliqués à ce projet.</span></div>',
        '<div class="projectFileToolbar">',
        '<button type="button" class="apply">Appliquer</button>',
        '<button type="button" class="save">Mémoriser réglages actuels</button>',
        '</div>',
        '</div>',
        '<div class="projectRuntimeGrid"></div>',
      ].join('')
      section.querySelector('.apply').addEventListener('click', () => actions.applyProjectRuntime?.(project.id))
      section.querySelector('.save').addEventListener('click', () => actions.saveProjectRuntime?.(project.id))
      const grid = section.querySelector('.projectRuntimeGrid')
      for (const [label, value] of [
        ['Dossier', runtime.cwd || 'Réglage global'],
        ['Modèle', runtime.model || 'Réglage global'],
        ['Permissions', runtime.permissionMode || 'Réglage global'],
        ['Mémoire', runtime.memoryEnabled === null || runtime.memoryEnabled === undefined ? 'Réglage global' : runtime.memoryEnabled ? 'Active' : 'Pause'],
      ]) {
        const item = document.createElement('div')
        item.innerHTML = '<span></span><strong></strong>'
        item.querySelector('span').textContent = label
        item.querySelector('strong').textContent = value
        grid.appendChild(item)
      }
      return section
    }

    function projectCompetencePanel(project, competenceProfile) {
      const section = document.createElement('section')
      section.className = 'projectSectionCard projectCompetenceCard'
      section.innerHTML = [
        '<div class="projectSectionHead projectFilesHead">',
        '<div><strong>Compétences</strong><span>Skills, profils et workflows détectés dans les fichiers du projet.</span></div>',
        '<div class="projectFileToolbar">',
        '<button type="button" class="refresh">Actualiser</button>',
        '</div>',
        '</div>',
        '<div class="projectCompetenceStats"></div>',
        '<div class="projectCompetenceDomains"></div>',
        '<div class="projectCompetenceList"></div>',
      ].join('')
      section.querySelector('.refresh').addEventListener('click', () => actions.indexProjectFiles?.(project.id))

      const profile = competenceProfile || null
      const builtInSkills = window.OPCBuiltInSkills?.list?.() || []
      const stats = section.querySelector('.projectCompetenceStats')
      for (const [label, value] of [
        ['skills', profile?.skillCount || 0],
        ['profils', profile?.practiceProfileCount || 0],
        ['domaines', profile?.domains?.length || 0],
        ['intégrées', builtInSkills.length],
      ]) {
        const item = document.createElement('span')
        item.innerHTML = '<b></b><em></em>'
        item.querySelector('b').textContent = String(value)
        item.querySelector('em').textContent = label
        stats.appendChild(item)
      }

      const domains = section.querySelector('.projectCompetenceDomains')
      for (const domain of (profile?.domains || []).slice(0, 10)) {
        const chip = document.createElement('span')
        chip.textContent = `${domain.name} · ${domain.count}`
        domains.appendChild(chip)
      }

      const list = section.querySelector('.projectCompetenceList')
      for (const skill of builtInSkills) list.appendChild(builtInSkillRow(skill))
      const competences = window.OPCCompetenceProfile?.relevantCompetences?.(profile, '', 10) || []
      if (!competences.length) {
        return section
      }
      for (const competence of competences) {
        list.appendChild(projectCompetenceRow(project, competence))
      }
      return section
    }

    function builtInSkillRow(skill) {
      const row = document.createElement('div')
      row.className = 'projectCompetenceItem builtIn'
      row.innerHTML = '<div><strong></strong><span></span><em></em></div>'
      row.querySelector('strong').textContent = skill.title
      row.querySelector('span').textContent = skill.description
      row.querySelector('em').textContent = 'Compétence intégrée OPC'
      return row
    }

    function projectCompetenceRow(project, competence) {
      const row = document.createElement('div')
      row.className = 'projectCompetenceItem'
      row.innerHTML = [
        '<div><strong></strong><span></span><em></em></div>',
        '<div class="projectFileActions">',
        '<button type="button" class="readNext">Lire prochain prompt</button>',
        '<button type="button" class="open">Ouvrir</button>',
        '<button type="button" class="copyPath">Copier chemin</button>',
        '</div>',
      ].join('')
      row.querySelector('strong').textContent = `${competence.domain}/${competence.name}`
      row.querySelector('span').textContent = competence.description || competence.summary || 'Compétence détectée.'
      row.querySelector('em').textContent = competence.path
      const sourceFile = (project.files || []).find(file => file.path === competence.path)
      row.querySelector('.readNext').disabled = !sourceFile
      row.querySelector('.readNext').addEventListener('click', () => {
        if (sourceFile) actions.setProjectFileReadNext?.(project.id, sourceFile.id, true)
      })
      row.querySelector('.open').addEventListener('click', () => actions.openPath?.(competence.path))
      row.querySelector('.copyPath').addEventListener('click', () => actions.copyText?.(competence.path))
      return row
    }

    function projectFilesPanel(project) {
      const section = document.createElement('section')
      section.className = 'projectSectionCard projectFilesCard'
      section.innerHTML = [
        '<div class="projectSectionHead projectFilesHead">',
        '<div><strong>Fichiers</strong><span>Références visibles et injectées dans le contexte du projet.</span></div>',
        '<div class="projectFileToolbar">',
        '<input class="projectFileSearch" type="search" placeholder="Rechercher dans les fichiers indexés" />',
        '<button type="button" class="indexAll">Tout indexer</button>',
        '<button type="button" class="addFile">Ajouter</button>',
        '<button type="button" class="addFolder">Ajouter dossier</button>',
        '</div>',
        '</div>',
        '<div class="projectFileCount"></div>',
        '<div class="projectFileList"></div>',
      ].join('')
      section.querySelector('.addFile').addEventListener('click', () => actions.addProjectFiles?.(project.id))
      section.querySelector('.addFolder').addEventListener('click', () => actions.addProjectFolder?.(project.id))
      section.querySelector('.indexAll').addEventListener('click', () => actions.indexProjectFiles?.(project.id))
      const search = section.querySelector('.projectFileSearch')
      search.value = projectController?.projectFileSearchQuery?.(project.id) || ''
      const list = section.querySelector('.projectFileList')
      const count = section.querySelector('.projectFileCount')
      const files = Array.isArray(project.files) ? project.files : []

      function renderRows() {
        list.replaceChildren()
        const query = search.value.trim()
        const entries = window.OPCProjectFileIndex?.searchProjectFiles
          ? window.OPCProjectFileIndex.searchProjectFiles(files, query)
          : files.map(file => ({ file, score: 0, snippets: [] }))
        count.textContent = query
          ? `${entries.length}/${files.length} fichier${files.length > 1 ? 's' : ''} trouvé${entries.length > 1 ? 's' : ''}`
          : `${files.length} fichier${files.length > 1 ? 's' : ''}`
        if (!files.length || !entries.length) {
          const empty = document.createElement('div')
          empty.className = 'projectFileEmpty'
          empty.textContent = files.length ? 'Aucun fichier ne correspond à cette recherche.' : 'Aucun fichier attaché à ce projet.'
          list.appendChild(empty)
          return
        }
        for (const entry of entries) {
          list.appendChild(projectFileRow(project, entry))
        }
      }
      search.addEventListener('input', () => {
        actions.setProjectFileSearchQuery?.(project.id, search.value)
        renderRows()
      })
      renderRows()
      return section
    }

    function projectFileRow(project, entry) {
      const file = entry.file
      const item = document.createElement('div')
      item.className = 'projectFileItem'
      item.innerHTML = [
        '<div class="projectFileMain"><strong></strong><span></span><em></em></div>',
        '<div class="projectFileActions">',
        '<button type="button" class="readNext">Lire prochain prompt</button>',
        '<button type="button" class="index">Indexer</button>',
        '<button type="button" class="open">Ouvrir</button>',
        '<button type="button" class="copyPath">Copier chemin</button>',
        '<button type="button" class="remove">Retirer</button>',
        '</div>',
        '<details class="projectFilePreview"><summary>Aperçu indexé</summary><p class="projectFileSummary"></p><div class="projectFileMetaChips"></div><div class="projectFileMatches"></div><pre></pre></details>',
      ].join('')
      item.querySelector('strong').textContent = projectFileLabel(file)
      item.querySelector('span').textContent = file.path
      item.querySelector('em').textContent = file.indexedAt
        ? `${file.wordCount || 0} mots · ${file.lineCount || 0} lignes · indexé ${nowLabel(file.indexedAt)}${file.error ? ` · ${file.error}` : ''}${entry.score ? ` · score ${entry.score}` : ''}`
        : file.error || 'Non indexé'
      const readNext = item.querySelector('.readNext')
      readNext.classList.toggle('active', Boolean(file.readNext))
      readNext.textContent = file.readNext ? 'Sera lu au prochain prompt' : 'Lire prochain prompt'
      readNext.addEventListener('click', () => actions.setProjectFileReadNext?.(project.id, file.id, !file.readNext))
      item.querySelector('.index').addEventListener('click', () => actions.indexProjectFile?.(project.id, file))
      item.querySelector('.open').addEventListener('click', () => actions.openPath?.(file.path))
      item.querySelector('.copyPath').addEventListener('click', () => actions.copyText?.(file.path))
      item.querySelector('.remove').addEventListener('click', () => actions.removeProjectFile?.(project.id, file.id))
      item.querySelector('.projectFileSummary').textContent = file.summary || 'Aucun résumé indexé.'

      const chips = item.querySelector('.projectFileMetaChips')
      for (const chipText of [...(file.headings || []).slice(0, 4), ...(file.keywords || []).slice(0, 8)]) {
        const chip = document.createElement('span')
        chip.textContent = chipText
        chips.appendChild(chip)
      }
      const matches = item.querySelector('.projectFileMatches')
      for (const snippetText of entry.snippets || []) {
        const snippet = document.createElement('mark')
        snippet.textContent = snippetText
        matches.appendChild(snippet)
      }
      item.querySelector('.projectFilePreview pre').textContent = file.preview || ''
      return item
    }

    return {
      renderEmptyProjectConversation,
      renderProjectContext,
      reset,
    }
  }

  window.OPCProjectContextView = { createProjectContextView }
})()
