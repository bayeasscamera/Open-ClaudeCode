(function () {
  function createRunTaskQueue(initialTasks = []) {
    let tasks = Array.isArray(initialTasks) ? initialTasks.slice() : []
    let activeTask = null

    return {
      active: () => activeTask,
      clearActive: () => {
        activeTask = null
      },
      length: () => tasks.length,
      push: task => tasks.push(task),
      removeByAssistantId: assistantId => {
        tasks = tasks.filter(task => task.assistantId !== assistantId)
        return tasks.length
      },
      shift: () => tasks.shift() || null,
      setActive: task => {
        activeTask = task || null
        return activeTask
      },
      snapshot: () => tasks.slice(),
      unshift: task => tasks.unshift(task),
    }
  }

  window.OPCRunTaskQueue = { createRunTaskQueue }
})()
