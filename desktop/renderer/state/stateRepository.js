(function () {
  const DEFAULT_STORAGE_KEY = 'opc.desktop.state'

  function createStateRepository({
    storage = window.localStorage,
    storageKey = DEFAULT_STORAGE_KEY,
    remoteSave = null,
  } = {}) {
    function read() {
      try {
        return { ok: true, value: JSON.parse(storage.getItem(storageKey) || '{}') }
      } catch (error) {
        return { ok: false, value: {}, error: error.message || String(error) }
      }
    }

    function write(payload) {
      try {
        storage.setItem(storageKey, JSON.stringify(payload))
      } catch (error) {
        return { ok: false, localError: `Sauvegarde locale impossible: ${error.message || String(error)}` }
      }
      const pendingRemote = typeof remoteSave === 'function' ? remoteSave(payload) : null
      return { ok: true, pendingRemote }
    }

    return { read, write }
  }

  window.OPCStateRepository = {
    DEFAULT_STORAGE_KEY,
    createStateRepository,
  }
})()
