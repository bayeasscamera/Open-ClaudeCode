(function () {
  function createProjectController({
    state,
    store,
    prompt = window.prompt,
    confirm = window.confirm,
    defaultRuntime = () => ({}),
    openProjectEditor = null,
    onChange = () => {},
  } = {}) {
    function activeProject() {
      return store.activeProject?.() || null
    }

    function projectById(projectId) {
      return store.projectById?.(projectId) || null
    }

    function projectForChat(chat) {
      return chat?.projectId ? projectById(chat.projectId) : activeProject()
    }

    function createProject() {
      if (openProjectEditor) {
        openProjectEditor({
          mode: 'create',
          project: null,
          onSave: values => {
            store.createProject({ ...values, runtime: defaultRuntime() })
            onChange()
          },
        })
        return null
      }
      const name = prompt('Nom du projet')
      if (!String(name || '').trim()) return null
      const description = prompt('Description courte du projet') || ''
      const project = store.createProject({ name, description, runtime: defaultRuntime() })
      onChange()
      return project
    }

    function selectProject(projectId = '') {
      store.setActiveProject(projectId)
      onChange()
      return activeProject()
    }

    function assignActiveChat(projectId = '') {
      const chat = store.activeChat()
      if (!chat) {
        store.setActiveProject(projectId)
        onChange()
        return true
      }
      const assigned = store.assignChatToProject(chat.id, projectId)
      if (assigned) onChange()
      return assigned
    }

    function moveChatToProject(chatId, projectId = '') {
      const moved = store.assignChatToProject(chatId, projectId, { focus: false })
      if (moved) onChange()
      return moved
    }

    function addProjectFiles(projectId, files = []) {
      const project = store.addProjectFiles?.(projectId, files)
      if (project) onChange()
      return project
    }

    function removeProjectFile(projectId, fileId) {
      const project = store.removeProjectFile?.(projectId, fileId)
      if (project) onChange()
      return project
    }

    function updateProjectFile(projectId, fileId, patch = {}) {
      const project = store.updateProjectFile?.(projectId, fileId, patch)
      if (project) onChange()
      return project
    }

    function setProjectFileReadNext(projectId, fileId, readNext) {
      const project = store.setProjectFileReadNext?.(projectId, fileId, readNext)
      if (project) onChange()
      return project
    }

    function clearProjectFileReadNext(projectId) {
      const project = store.clearProjectFileReadNext?.(projectId)
      if (project) onChange()
      return project
    }

    function setProjectFileSearchQuery(projectId, query = '') {
      return store.setProjectFileSearchQuery?.(projectId, query) || ''
    }

    function projectFileSearchQuery(projectId) {
      return store.projectFileSearchQuery?.(projectId) || ''
    }

    function toggleChatSelection(chatId, selected) {
      const ids = store.toggleChatSelection?.(chatId, selected) || []
      onChange()
      return ids
    }

    function clearChatSelection() {
      const ids = store.clearChatSelection?.() || []
      onChange()
      return ids
    }

    function moveSelectedChatsToProject(projectId = '') {
      const moved = store.moveSelectedChatsToProject?.(projectId) || 0
      if (moved) onChange()
      return moved
    }

    function exportProjectBundle(projectId) {
      return store.exportProjectBundle?.(projectId) || null
    }

    function importProjectBundle(bundle) {
      const project = store.importProjectBundle?.(bundle)
      if (project) onChange()
      return project
    }

    function editProject(projectId) {
      const project = projectById(projectId)
      if (!project) return null
      if (openProjectEditor) {
        openProjectEditor({
          mode: 'edit',
          project,
          onSave: values => {
            store.updateProject(project.id, values)
            onChange()
          },
        })
        return project
      }
      const name = prompt('Nom du projet', project.name)
      if (!String(name || '').trim()) return null
      const description = prompt('Description courte du projet', project.description || '') || ''
      const updated = store.updateProject(project.id, { name, description })
      onChange()
      return updated
    }

    function deleteProject(projectId) {
      const project = projectById(projectId)
      if (!project) return false
      if (!confirm(`Supprimer le projet "${project.name}" ? Les conversations resteront dans Sessions.`)) return false
      const deleted = store.deleteProject(project.id)
      if (deleted) onChange()
      return deleted
    }

    function updateProjectField(projectId, field, value) {
      if (!['instructions', 'memory', 'description', 'name'].includes(field)) return null
      return store.updateProject(projectId, { [field]: value })
    }

    function updateProjectRuntime(projectId, patch = {}) {
      const project = store.updateProjectRuntime?.(projectId, patch)
      if (project) onChange()
      return project
    }

    function chatCount(projectId) {
      return state.chats.filter(chat => chat.projectId === projectId).length
    }

    return {
      activeProject,
      addProjectFiles,
      assignActiveChat,
      chatCount,
      clearChatSelection,
      clearProjectFileReadNext,
      createProject,
      deleteProject,
      editProject,
      exportProjectBundle,
      importProjectBundle,
      moveChatToProject,
      moveSelectedChatsToProject,
      projectById,
      projectFileSearchQuery,
      projectForChat,
      removeProjectFile,
      selectProject,
      setProjectFileReadNext,
      setProjectFileSearchQuery,
      toggleChatSelection,
      updateProjectFile,
      updateProjectField,
      updateProjectRuntime,
    }
  }

  window.OPCProjectController = { createProjectController }
})()
