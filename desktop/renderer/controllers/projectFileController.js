(function () {
  function createProjectFileController({
    projectController,
    opc = window.opc,
    indexer = window.OPCProjectFileIndex,
  } = {}) {
    function summarizeProjectFile(content) {
      return indexer?.buildProjectFileIndex
        ? indexer.buildProjectFileIndex(content)
        : {
            preview: String(content || '').slice(0, 4000),
            summary: String(content || '').replace(/\s+/g, ' ').trim().slice(0, 900),
            indexedAt: new Date().toISOString(),
          }
    }

    async function indexProjectFile(projectId, file) {
      if (!projectId || !file?.id || !file?.path || !opc.readProjectFile) return null
      const result = await opc.readProjectFile({ path: file.path })
      if (!result?.ok) {
        const project = projectController.updateProjectFile(projectId, file.id, {
          error: result?.error || 'Lecture impossible.',
          indexedAt: new Date().toISOString(),
        })
        return project
      }
      const metadata = indexer?.buildProjectFileIndex
        ? indexer.buildProjectFileIndex(result.content, result)
        : summarizeProjectFile(result.content)
      const project = projectController.updateProjectFile(projectId, file.id, {
        ...metadata,
        size: result.size,
        name: result.name,
        error: result.truncated ? 'Aperçu tronqué.' : '',
      })
      return project
    }

    async function indexProjectFiles(projectId, files = null) {
      const project = projectController.projectById?.(projectId)
      const targets = Array.isArray(files) ? files : project?.files || []
      if (!projectId || !targets.length) return null
      for (const file of targets) {
        await indexProjectFile(projectId, file)
      }
      const updated = projectController.projectById?.(projectId) || null
      return updated
    }

    async function addProjectFiles(projectId) {
      if (!projectId || !opc.selectProjectFiles) return null
      const result = await opc.selectProjectFiles()
      return addSelectedFiles(projectId, result)
    }

    async function addProjectFolder(projectId) {
      if (!projectId || !opc.selectProjectFolder) return null
      const result = await opc.selectProjectFolder()
      return addSelectedFiles(projectId, result)
    }

    async function addSelectedFiles(projectId, result) {
      if (!result?.ok || !Array.isArray(result.files) || !result.files.length) return null
      const project = projectController.addProjectFiles(projectId, result.files)
      const added = project?.files?.filter(file => result.files.some(item => item.path === file.path)) || []
      await indexProjectFiles(projectId, added)
      return projectController.activeProject()
    }

    return {
      addProjectFiles,
      addProjectFolder,
      addSelectedFiles,
      indexProjectFile,
      indexProjectFiles,
      summarizeProjectFile,
    }
  }

  window.OPCProjectFileController = { createProjectFileController }
})()
