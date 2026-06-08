(function () {
  const DEFAULT_REFINER_MODEL = 'qwen/qwen3.5-122b-a10b'

  function selectedRefinerModel(state = {}) {
    return String(state.settings?.refineModel || '').trim() || DEFAULT_REFINER_MODEL
  }

  function createPromptComposerController({
    els = {},
    state = {},
    opc = window.opc,
    runController = null,
    appendLog = () => {},
  } = {}) {
    let refineSnapshot = ''
    let refineRunning = false

    function setStatus(message = '', tone = '') {
      if (!els.composerStatus) return
      els.composerStatus.textContent = message
      els.composerStatus.dataset.tone = tone
      els.composerStatus.classList.toggle('hidden', !message)
    }

    function resizePrompt() {
      if (!els.prompt) return
      els.prompt.style.height = 'auto'
      els.prompt.style.height = `${Math.min(180, els.prompt.scrollHeight)}px`
    }

    function updatePromptControls() {
      const hasPrompt = Boolean(String(els.prompt?.value || '').trim())
      if (els.send) els.send.disabled = !hasPrompt
      if (els.refine) els.refine.disabled = refineRunning || !hasPrompt
      resizePrompt()
    }

    function clearRefineSnapshot() {
      refineSnapshot = ''
      els.refineUndo?.classList.add('hidden')
      if (!refineRunning) setStatus('')
    }

    function setPrompt(value, { clearUndo = false } = {}) {
      if (!els.prompt) return
      els.prompt.value = String(value || '')
      if (clearUndo) clearRefineSnapshot()
      updatePromptControls()
    }

    function setRefineRunning(value) {
      refineRunning = Boolean(value)
      const model = selectedRefinerModel(state)
      if (els.refine) {
        els.refine.classList.toggle('isRunning', refineRunning)
        els.refine.textContent = refineRunning ? '…' : '✦'
        els.refine.title = refineRunning ? `Raffinage en cours avec ${model}` : `Raffiner le prompt avec ${model}`
      }
      updatePromptControls()
    }

    async function refinePromptDraft() {
      const prompt = String(els.prompt?.value || '').trim()
      if (!prompt || refineRunning) return
      if (!opc?.refinePrompt) {
        setStatus('Raffinage indisponible', 'error')
        appendLog('RAFFINE indisponible: IPC opc:refine-prompt absent.')
        return
      }

      const model = selectedRefinerModel(state)
      refineSnapshot = els.prompt.value
      setStatus(`Raffinage avec ${model}...`, 'running')
      setRefineRunning(true)
      try {
        const result = await opc.refinePrompt({ prompt, model })
        if (!result?.ok || !String(result.text || '').trim()) {
          const error = result?.error || 'réponse vide'
          setStatus(`Raffinage échoué: ${error}`, 'error')
          appendLog(`RAFFINE erreur: ${error}`)
          return
        }
        setPrompt(result.text.trim())
        els.refineUndo?.classList.remove('hidden')
        const latency = Math.round(result.latencyMs || 0)
        setStatus(`Prompt raffiné avec ${result.model || model}${latency ? ` · ${latency}ms` : ''}.`, 'done')
        appendLog(`RAFFINE ${result.model || model} ${latency}ms`)
        els.prompt?.focus?.()
      } catch (error) {
        const message = error.message || String(error)
        setStatus(`Raffinage échoué: ${message}`, 'error')
        appendLog(`RAFFINE erreur: ${message}`)
      } finally {
        setRefineRunning(false)
      }
    }

    function undoRefinedPrompt() {
      if (!refineSnapshot) return
      setPrompt(refineSnapshot)
      clearRefineSnapshot()
      els.prompt?.focus?.()
    }

    function sendPrompt() {
      clearRefineSnapshot()
      runController?.sendPrompt?.()
    }

    function rescuePrompt() {
      const value = String(els.prompt?.value || '').trim()
      setPrompt(value.startsWith('/opc:rescue') ? value : `/opc:rescue ${value}`.trim())
      els.prompt?.focus?.()
    }

    function wire() {
      els.send?.addEventListener('click', sendPrompt)
      els.refine?.addEventListener('click', refinePromptDraft)
      els.refineUndo?.addEventListener('click', undoRefinedPrompt)
      els.rescue?.addEventListener('click', rescuePrompt)
      els.prompt?.addEventListener('input', () => {
        updatePromptControls()
        if (!String(els.prompt.value || '').trim()) clearRefineSnapshot()
      })
      els.prompt?.addEventListener('keydown', event => {
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault()
          sendPrompt()
        }
      })
      updatePromptControls()
    }

    return {
      clearRefineSnapshot,
      refinePromptDraft,
      resizePrompt,
      selectedRefinerModel: () => selectedRefinerModel(state),
      setPrompt,
      undoRefinedPrompt,
      updatePromptControls,
      wire,
    }
  }

  window.OPCPromptComposerController = {
    DEFAULT_REFINER_MODEL,
    createPromptComposerController,
    selectedRefinerModel,
  }
})()
