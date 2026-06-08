(function () {
  function createSidebarView({
    els,
    state,
    store,
    projectController,
    chatController,
    actions = {},
    nowLabel,
    searchQuery,
    includesQuery,
    render = () => {},
  } = {}) {
    function renderProjects() {
      if (!els.projectList) return
      els.projectList.innerHTML = ''
      const projects = (state.projects || []).filter(project => includesQuery(project.name, project.description, project.memory, project.instructions))
      els.projectList.hidden = !projects.length
      for (const project of projects) els.projectList.appendChild(projectItem(project))
    }

    function allChatsButton() {
      const button = document.createElement('button')
      button.className = `projectItem ${state.activeProjectId ? '' : 'active'}`
      button.type = 'button'
      button.innerHTML = '<span class="projectIcon">⌂</span><span class="projectBody"><strong>Tous les chats</strong><em></em></span>'
      button.querySelector('em').textContent = `${state.chats.length} session${state.chats.length > 1 ? 's' : ''}`
      button.addEventListener('click', () => actions.selectProject?.(''))
      return button
    }

    function projectItem(project) {
      const count = projectController?.chatCount?.(project.id) || 0
      const item = document.createElement('div')
      item.className = `projectItemWrap ${project.id === state.activeProjectId ? 'active' : ''}`

      const button = document.createElement('button')
      button.className = 'projectItem'
      button.type = 'button'
      button.innerHTML = '<span class="projectIcon">▱</span><span class="projectBody"><strong></strong><em></em></span>'
      button.querySelector('strong').textContent = project.name
      button.querySelector('em').textContent = project.description || `${count} session${count > 1 ? 's' : ''}`
      button.addEventListener('click', () => actions.selectProject?.(project.id))

      const menu = document.createElement('button')
      menu.className = 'projectMenu'
      menu.type = 'button'
      menu.title = 'Modifier le projet'
      menu.textContent = '⋯'
      menu.addEventListener('click', event => {
        event.stopPropagation()
        actions.editProject?.(project.id)
      })

      item.append(button, menu)
      return item
    }

    function renderChats() {
      if (els.pinnedChatList) els.pinnedChatList.innerHTML = ''
      els.chatList.innerHTML = ''
      renderChatBulkActions(els.chatList)
      const chats = filteredChats()
      const pinnedChats = chats.filter(chat => chat.pinnedAt)
      const recentChats = chats.filter(chat => !chat.pinnedAt)

      if (els.pinnedHeader) els.pinnedHeader.hidden = !pinnedChats.length
      if (els.pinnedChatList) {
        els.pinnedChatList.hidden = !pinnedChats.length
        for (const chat of pinnedChats) els.pinnedChatList.appendChild(chatItem(chat))
      }

      if (!recentChats.length) {
        const empty = document.createElement('div')
        empty.className = 'chatEmpty'
        empty.textContent = searchQuery() ? 'Aucun résultat.' : 'Aucune session récente.'
        els.chatList.appendChild(empty)
        return
      }
      for (const chat of recentChats) els.chatList.appendChild(chatItem(chat))
    }

    function filteredChats() {
      const visibleChats = store.visibleChats ? store.visibleChats() : state.chats
      return visibleChats
        .filter(chat => {
          const project = chat.projectId ? projectController?.projectById?.(chat.projectId) : null
          const lastMessage = (chat.messages || []).slice(-1)[0]?.content || ''
          return includesQuery(chat.title, project?.name, project?.description, lastMessage)
        })
        .slice()
        .sort((a, b) => {
          const aTime = Date.parse(a.pinnedAt || a.createdAt || 0) || 0
          const bTime = Date.parse(b.pinnedAt || b.createdAt || 0) || 0
          return bTime - aTime
        })
    }

    function renderChatBulkActions(parent) {
      const selectedIds = store.selectedChatIds?.() || []
      if (!selectedIds.length) return
      const bar = document.createElement('div')
      bar.className = 'chatBulkBar'
      bar.innerHTML = '<strong></strong><select></select><button type="button" class="move">Déplacer</button><button type="button" class="clear">Annuler</button>'
      bar.querySelector('strong').textContent = `${selectedIds.length} sélectionnée${selectedIds.length > 1 ? 's' : ''}`
      const select = bar.querySelector('select')
      select.innerHTML = '<option value="">Aucun projet</option>'
      for (const project of state.projects || []) {
        const option = document.createElement('option')
        option.value = project.id
        option.textContent = project.name
        select.appendChild(option)
      }
      select.value = state.activeProjectId || ''
      bar.querySelector('.move').addEventListener('click', () => actions.moveSelectedChatsToProject?.(select.value))
      bar.querySelector('.clear').addEventListener('click', () => actions.clearChatSelection?.())
      parent.appendChild(bar)
    }

    function chatItem(chat) {
      const wrap = document.createElement('div')
      const selected = store.selectedChatIds?.().includes(chat.id)
      wrap.className = [
        'chatItemWrap',
        chat.id === state.activeChatId ? 'active' : '',
        chat.pinnedAt ? 'pinned' : '',
        selected ? 'selected' : '',
      ].filter(Boolean).join(' ')
      wrap.append(chatButton(chat), chatMenu(chat))
      return wrap
    }

    function chatSelector(chat) {
      const selectChat = document.createElement('input')
      selectChat.className = 'chatSelect'
      selectChat.type = 'checkbox'
      selectChat.title = 'Sélectionner cette session'
      selectChat.checked = Boolean(store.selectedChatIds?.().includes(chat.id))
      selectChat.disabled = state.running
      selectChat.addEventListener('click', event => event.stopPropagation())
      selectChat.addEventListener('change', event => {
        event.stopPropagation()
        actions.toggleChatSelection?.(chat.id, selectChat.checked)
      })
      return selectChat
    }

    function chatButton(chat) {
      const button = document.createElement('button')
      button.className = `chatItem ${chat.id === state.activeChatId ? 'active' : ''}`
      button.innerHTML = '<strong class="chatTitle"></strong><span class="chatMeta"></span><span class="chatProjectBadge"></span>'
      button.querySelector('.chatTitle').textContent = chat.title
      button.querySelector('.chatMeta').textContent = nowLabel(chat.createdAt)
      const projectBadge = button.querySelector('.chatProjectBadge')
      const project = chat.projectId ? projectController?.projectById?.(chat.projectId) : null
      projectBadge.textContent = !state.activeProjectId && project ? project.name : ''
      projectBadge.hidden = !projectBadge.textContent
      button.addEventListener('click', () => {
        if (!store.setActiveChat(chat.id)) return
        render()
      })
      return button
    }

    function chatMenu(chat) {
      const wrap = document.createElement('div')
      wrap.className = 'chatMenuWrap'

      const trigger = document.createElement('button')
      trigger.className = 'chatMenuTrigger'
      trigger.type = 'button'
      trigger.title = 'Actions de session'
      trigger.setAttribute('aria-haspopup', 'menu')
      trigger.textContent = '⋮'
      trigger.disabled = state.running
      trigger.addEventListener('click', event => event.stopPropagation())

      const menu = document.createElement('div')
      menu.className = 'chatActionMenu'
      menu.setAttribute('role', 'menu')
      menu.setAttribute('aria-label', `Actions pour ${chat.title}`)

      menu.append(
        menuButton({
          icon: '⌁',
          label: chat.pinnedAt ? 'Désépingler' : 'Épingler',
          onClick: () => {
            actions.toggleChatPinned?.(chat.id, !chat.pinnedAt)
            render()
          },
        }),
        menuButton({
          icon: '✎',
          label: 'Renommer',
          onClick: () => renameChat(chat),
        }),
        menuButton({
          icon: '▱',
          label: chat.projectId ? 'Déplacer projet' : 'Ajouter au projet',
          disabled: !(state.projects || []).length,
          title: (state.projects || []).length ? 'Déplacer cette session vers un projet' : 'Crée un projet avant d’ajouter cette session.',
          onClick: () => moveChatToProject(chat),
        }),
        menuDivider(),
        menuButton({
          icon: '⌫',
          label: 'Supprimer',
          tone: 'danger',
          onClick: () => chatController.deleteChat(chat.id),
        })
      )

      wrap.append(trigger, menu)
      return wrap
    }

    function menuButton({ icon, label, tone = '', title = '', disabled = false, onClick = () => {} }) {
      const button = document.createElement('button')
      button.className = ['chatActionMenuItem', tone].filter(Boolean).join(' ')
      button.type = 'button'
      button.setAttribute('role', 'menuitem')
      button.disabled = Boolean(disabled || state.running)
      if (title) button.title = title
      button.innerHTML = '<span class="chatActionIcon" aria-hidden="true"></span><span class="chatActionLabel"></span>'
      button.querySelector('.chatActionIcon').textContent = icon
      button.querySelector('.chatActionLabel').textContent = label
      button.addEventListener('click', event => {
        event.stopPropagation()
        if (button.disabled) return
        onClick()
      })
      return button
    }

    function menuDivider() {
      const line = document.createElement('div')
      line.className = 'chatActionMenuDivider'
      return line
    }

    function renameChat(chat) {
      const ask = window.prompt
      if (typeof ask !== 'function') return
      const nextTitle = ask('Renommer cette session', chat.title)
      if (nextTitle === null) return
      actions.renameChat?.(chat.id, nextTitle)
      render()
    }

    function moveChatToProject(chat) {
      const projects = state.projects || []
      if (!projects.length) return
      const activeProject = state.activeProjectId ? projectController?.projectById?.(state.activeProjectId) : null
      if (activeProject && chat.projectId !== activeProject.id) {
        actions.moveChatToProject?.(chat.id, activeProject.id)
        render()
        return
      }
      const ask = window.prompt
      if (typeof ask !== 'function') return
      const currentIndex = Math.max(0, projects.findIndex(project => project.id === chat.projectId) + 1)
      const projectList = projects.map((project, index) => `${index + 1}. ${project.name}`).join('\n')
      const answer = ask(`Choisir le projet pour cette session:\n${projectList}\n0. Aucun projet`, String(currentIndex))
      if (answer === null) return
      const index = Number.parseInt(answer, 10)
      if (!Number.isFinite(index) || index < 0 || index > projects.length) return
      actions.moveChatToProject?.(chat.id, index === 0 ? '' : projects[index - 1].id)
      render()
    }

    function chatProjectMove(chat) {
      const move = document.createElement('select')
      move.className = 'chatProjectMove'
      move.title = 'Déplacer cette session'
      move.innerHTML = '<option value="">Aucun projet</option>'
      for (const project of state.projects || []) {
        const option = document.createElement('option')
        option.value = project.id
        option.textContent = project.name
        move.appendChild(option)
      }
      move.value = chat.projectId || ''
      move.disabled = state.running
      move.addEventListener('click', event => event.stopPropagation())
      move.addEventListener('change', event => {
        event.stopPropagation()
        actions.moveChatToProject?.(chat.id, move.value)
      })
      return move
    }

    function chatDelete(chat) {
      const remove = document.createElement('button')
      remove.className = 'chatDelete'
      remove.type = 'button'
      remove.title = 'Supprimer cette session'
      remove.textContent = '×'
      remove.disabled = state.running
      remove.addEventListener('click', event => {
        event.stopPropagation()
        chatController.deleteChat(chat.id)
      })
      return remove
    }

    return {
      renderChats,
      renderProjects,
    }
  }

  window.OPCSidebarView = { createSidebarView }
})()
