(function () {
  function createChatController({ state, store, confirm = window.confirm, onChange = () => {} } = {}) {
    function activeChat() {
      return store.activeChat()
    }

    function activeAssistant() {
      return store.activeAssistant()
    }

    function assistantByTaskId(taskId) {
      if (!taskId) return null
      for (const chat of state.chats) {
        const message = chat.messages.find(item => item.role === 'assistant' && item.diagnostics?.taskId === taskId)
        if (message) return message
      }
      return null
    }

    function assistantForEvent(event) {
      return assistantByTaskId(event?.taskId) || activeAssistant()
    }

    function chatForAssistant(assistant) {
      return assistant ? store.chatForMessage(assistant.id) : null
    }

    function createChat() {
      store.createChat()
      onChange()
    }

    function renameChat(chatId, title) {
      if (state.running) return false
      const renamed = store.renameChat?.(chatId, title)
      if (renamed) onChange()
      return Boolean(renamed)
    }

    function toggleChatPinned(chatId, pinned) {
      if (state.running) return false
      const updated = store.toggleChatPinned?.(chatId, pinned)
      if (updated) onChange()
      return Boolean(updated)
    }

    function deleteChat(chatId) {
      if (state.running) return false
      const chat = state.chats.find(item => item.id === chatId)
      if (!chat) return false
      if (!confirm('Supprimer cette session ? La mémoire durable OPC reste active.')) return false
      store.deleteChat(chatId)
      onChange()
      return true
    }

    function clearHistory() {
      if (state.running || !state.chats.length) return false
      if (!confirm("Effacer tout l'historique visible ? La mémoire durable OPC reste active.")) return false
      store.clearHistory()
      onChange()
      return true
    }

    function previousUserPrompt(message) {
      const chat = chatForAssistant(message)
      if (!chat) return ''
      const index = chat.messages.findIndex(item => item.id === message.id)
      for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
        if (chat.messages[cursor]?.role === 'user') return chat.messages[cursor].content || ''
      }
      return ''
    }

    return {
      activeAssistant,
      activeChat,
      assistantByTaskId,
      assistantForEvent,
      chatForAssistant,
      clearHistory,
      createChat,
      deleteChat,
      renameChat,
      previousUserPrompt,
      toggleChatPinned,
    }
  }

  window.OPCChatController = { createChatController }
})()
