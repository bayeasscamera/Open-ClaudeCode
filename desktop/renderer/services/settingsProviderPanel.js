(function () {
  const helpers = window.OPCSettingsHelpers
  const panelModel = window.OPCProviderPanelViewModel
  const editorModel = window.OPCProviderEditorModel

  function createSettingsProviderPanel({
    fields,
    state,
    providerController,
    applySettingsPatch = () => {},
    render = () => {},
    renderSettings = () => {},
  } = {}) {
    let providerConfig = null
    let providerConfigLoading = false
    let providerEditorOpen = false
    let providerImportOpen = false
    let providerRepairRunning = false
    let providerDiscoverRunning = false
    let providerQuarantineRunning = false
    let editingProviderId = ''
    let editingProviderModel = ''
    let providerEditorError = ''
    let providerImportError = ''
    let providerActionStatus = ''
    let providerActionTone = ''
    let providerRepairLog = null
    const capabilityFields = {
      agent: () => fields.providerCapabilityAgent,
      system: () => fields.providerCapabilitySystem,
      streaming: () => fields.providerCapabilityStreaming,
      tools: () => fields.providerCapabilityTools,
      toolChoice: () => fields.providerCapabilityToolChoice,
      temperature: () => fields.providerCapabilityTemperature,
      thinking: () => fields.providerCapabilityThinking,
      refine: () => fields.providerCapabilityRefine,
      reasoningPassThrough: () => fields.providerCapabilityReasoningPassThrough,
      reasoningExclude: () => fields.providerCapabilityReasoningExclude,
    }

    function editableProviderFor(model) {
      return providerConfig?.profiles?.find(profile => profile.model === model || profile.id === model) || null
    }

    function setProviderEditorError(message = '') {
      providerEditorError = message
      if (!fields.providerEditorError) return
      fields.providerEditorError.textContent = message
      fields.providerEditorError.classList.toggle('hidden', !message)
    }

    function setProviderImportError(message = '') {
      providerImportError = message
      if (!fields.providerImportError) return
      fields.providerImportError.textContent = message
      fields.providerImportError.classList.toggle('hidden', !message)
    }

    function setProviderActionStatus(message = '', tone = '') {
      providerActionStatus = message
      providerActionTone = tone
      if (!fields.providerActionStatus) return
      fields.providerActionStatus.textContent = message
      fields.providerActionStatus.classList.toggle('hidden', !message)
      fields.providerActionStatus.classList.toggle('warning', tone === 'warning')
      fields.providerActionStatus.classList.toggle('error', tone === 'error')
    }

    function repairLogTitle(log = {}) {
      return panelModel.repairLogTitle(log)
    }

    function repairChangeLabel(change = {}) {
      return panelModel.repairChangeLabel(change)
    }

    function renderProviderRepairLog() {
      if (!fields.providerRepairLog) return
      fields.providerRepairLog.replaceChildren()
      fields.providerRepairLog.classList.toggle('hidden', !providerRepairLog)
      if (!providerRepairLog) return
      const title = document.createElement('div')
      title.className = 'settingsRepairLogHeader'
      title.innerHTML = '<strong></strong><span></span>'
      title.querySelector('strong').textContent = 'Journal de réparation'
      title.querySelector('span').textContent = repairLogTitle(providerRepairLog)
      fields.providerRepairLog.appendChild(title)

      const changes = Array.isArray(providerRepairLog.repair?.changes) ? providerRepairLog.repair.changes : []
      if (changes.length) {
        const list = document.createElement('div')
        list.className = 'settingsRepairLogList'
        for (const change of changes) {
          const item = document.createElement('article')
          item.className = 'settingsRepairLogItem'
          item.innerHTML = '<span></span><strong></strong><em></em>'
          item.querySelector('span').textContent = repairChangeLabel(change)
          item.querySelector('strong').textContent = change.message || 'Correction appliquée.'
          const fromTo = [change.from ? `avant: ${change.from}` : '', change.to ? `après: ${change.to}` : ''].filter(Boolean).join(' · ')
          item.querySelector('em').textContent = fromTo || 'Correction sans valeur sensible affichée.'
          list.appendChild(item)
        }
        fields.providerRepairLog.appendChild(list)
      }

      const checkedModels = Array.isArray(providerRepairLog.checkedModels) ? providerRepairLog.checkedModels : []
      if (checkedModels.length) {
        const checked = document.createElement('p')
        checked.className = 'settingsRepairLogChecked'
        checked.textContent = `Retest ciblé: ${checkedModels.map(model => providerController?.modelLabel?.(model) || model).join(', ')}.`
        fields.providerRepairLog.appendChild(checked)
      }
    }

    async function refreshProviderConfig() {
      if (!providerController?.loadProviderConfig || providerConfigLoading) return providerConfig
      providerConfigLoading = true
      try {
        providerConfig = await providerController.loadProviderConfig()
        providerEditorError = providerConfig?.configError || ''
      } catch (error) {
        providerEditorError = error.message || String(error)
      } finally {
        providerConfigLoading = false
        renderSettings()
      }
      return providerConfig
    }

    function renderSummary() {
      const counts = helpers.settingsCounts(state)
      const summary = providerController?.providerAuditSummary?.() || window.OPCProviderHealth?.auditSummary?.(state.providerProfiles || [], state.providerChecks || {}) || { buckets: {} }
      fields.providerSummary.replaceChildren(
        helpers.metric('Profils', counts.providers, 'modèles configurés'),
        helpers.metric('OK', summary.ready ?? counts.okProviders, `${summary.tested || 0}/${summary.total || counts.providers} testés`),
        helpers.metric('Rate limit', summary.buckets?.rate_limited || counts.rateLimitedProviders || 0, 'pause avant retest'),
        helpers.metric('Timeout', summary.buckets?.timeout || counts.timeoutProviders || 0, 'réponse trop lente'),
        helpers.metric('Non supporté', summary.buckets?.unsupported || counts.unsupportedProviders || 0, 'paramètre refusé'),
        helpers.metric('À configurer', summary.buckets?.needs_config || counts.needsConfigProviders || 0, 'clé ou URL'),
        helpers.metric('Défaut', providerController?.modelLabel?.(state.providerDefaultModel) || state.providerDefaultModel || 'aucun', providerConfig?.path || 'configuration locale'),
        helpers.metric('Sélection', providerController?.modelLabel?.(state.settings.model) || state.settings.model || 'aucun', 'modèle courant'),
      )
    }

    function fillEditor(profile = {}) {
      const values = editorModel.editorValuesForProfile(profile, {
        baseUrl: providerConfig?.baseUrl || '',
        defaultModel: state.providerDefaultModel,
      })
      editingProviderId = values.editingProviderId
      editingProviderModel = values.editingProviderModel
      fields.providerEditorTitle.textContent = values.title
      fields.providerLabel.value = values.label
      fields.providerModel.value = values.model
      fields.providerName.value = values.providerName
      fields.providerBaseUrl.value = values.baseUrl
      fields.providerUpstreamApi.value = values.upstreamApi
      fields.providerTransport.value = values.transport
      fields.providerTimeout.value = values.timeoutMs
      if (fields.providerCheckTimeout) fields.providerCheckTimeout.value = values.checkTimeoutMs
      fields.providerRetries.value = values.retries
      fields.providerMaxTokens.value = values.maxTokens
      fields.providerApiKey.value = ''
      fields.providerApiKey.placeholder = values.apiKeyPlaceholder
      fields.providerNoAuth.checked = values.noAuth
      fields.providerDefault.checked = values.makeDefault
      for (const [key, getter] of Object.entries(capabilityFields)) {
        const input = getter()
        if (input) input.checked = Boolean(values.capabilities[key])
      }
      fields.providerSystemPrefix.value = values.systemPrefix
      fields.providerExtraBody.value = values.extraBodyText
      fields.providerDelete.disabled = !values.canDelete
      syncEditorUsageControls()
      setProviderEditorError('')
    }

    function openEditor(profile = {}) {
      providerEditorOpen = true
      providerImportOpen = false
      fields.providerEditor.classList.remove('hidden')
      fields.providerImportPanel?.classList.add('hidden')
      fillEditor(profile)
      requestAnimationFrame(() => fields.providerModel?.focus())
    }

    function openBlankEditor() {
      openEditor({
        baseUrl: providerConfig?.baseUrl || '',
        providerName: 'NVIDIA',
        timeoutMs: 300000,
        retries: 0,
        maxTokens: 4096,
        upstreamApi: 'openai',
        transport: 'stream',
      })
    }

    function openOllamaEditor() {
      openEditor({
        id: 'llama3.1:8b',
        label: 'Ollama Local',
        model: 'llama3.1:8b',
        providerName: 'Ollama',
        baseUrl: 'http://localhost:11434/v1',
        upstreamApi: 'ollama',
        transport: 'stream',
        timeoutMs: 300000,
        checkTimeoutMs: 60000,
        retries: 0,
        maxTokens: 8192,
        noAuth: true,
        capabilities: {
          agent: true,
          system: true,
          streaming: true,
          tools: true,
          toolChoice: false,
          temperature: true,
          thinking: false,
          refine: true,
          reasoningPassThrough: false,
          reasoningExclude: false,
        },
      })
    }

    function closeEditor() {
      providerEditorOpen = false
      editingProviderId = ''
      editingProviderModel = ''
      fields.providerEditor.classList.add('hidden')
      setProviderEditorError('')
    }

    function openImportPanel() {
      providerImportOpen = true
      providerEditorOpen = false
      fields.providerEditor?.classList.add('hidden')
      fields.providerImportPanel?.classList.remove('hidden')
      setProviderImportError('')
      requestAnimationFrame(() => fields.providerImportText?.focus())
    }

    function closeImportPanel() {
      providerImportOpen = false
      fields.providerImportPanel?.classList.add('hidden')
      setProviderImportError('')
    }

    function readEditor() {
      return editorModel.buildProviderEditorPayload({
        id: editingProviderId,
        label: fields.providerLabel.value,
        model: fields.providerModel.value,
        providerName: fields.providerName.value,
        baseUrl: fields.providerBaseUrl.value,
        upstreamApi: fields.providerUpstreamApi.value,
        transport: fields.providerTransport.value,
        timeoutMs: fields.providerTimeout.value,
        checkTimeoutMs: fields.providerCheckTimeout?.value,
        retries: fields.providerRetries.value,
        maxTokens: fields.providerMaxTokens.value,
        apiKey: fields.providerApiKey.value,
        noAuth: fields.providerNoAuth.checked,
        makeDefault: fields.providerDefault.checked,
        capabilities: readCapabilities(),
        systemPrefix: fields.providerSystemPrefix.value,
        extraBody: fields.providerExtraBody.value,
      }, helpers.normalizeProviderEditorPayload)
    }

    function readCapabilities() {
      return Object.fromEntries(Object.entries(capabilityFields).map(([key, getter]) => [key, Boolean(getter()?.checked)]))
    }

    function renderEditor() {
      fields.providerEditor.classList.toggle('hidden', !providerEditorOpen)
      setProviderEditorError(providerEditorError)
    }

    function renderImportPanel() {
      fields.providerImportPanel?.classList.toggle('hidden', !providerImportOpen)
      setProviderImportError(providerImportError)
    }

    function providerSubtitle(profile) {
      return panelModel.providerSubtitle(profile, state.providerDefaultModel)
    }

    function providerCopyPayload(profile) {
      return panelModel.providerCopyPayload(profile, {
        editable: editableProviderFor(profile.model),
        baseUrl: providerConfig?.baseUrl || '',
      })
    }

    function duplicateProvider(profile) {
      openEditor(panelModel.duplicateProviderPayload(profile, {
        editable: editableProviderFor(profile.model),
        baseUrl: providerConfig?.baseUrl || '',
      }))
    }

    async function copyProviderJson(profile) {
      const payload = providerCopyPayload(profile)
      const ok = await providerController?.copyText?.(JSON.stringify(payload, null, 2))
      if (!ok) setProviderEditorError('Copie JSON indisponible.')
    }

    function metaChip(text) {
      const chip = document.createElement('span')
      chip.textContent = text
      return chip
    }

    function providerHistoryMeta(row = {}) {
      return panelModel.providerHistoryMeta(row, {
        cooldownRemainingMs: window.OPCProviderHealth?.cooldownRemainingMs || (() => 0),
      })
    }

    function renderProviderHistory() {
      if (!fields.providerHistory) return
      fields.providerHistory.classList.toggle('hidden', providerEditorOpen || providerImportOpen)
      if (providerEditorOpen || providerImportOpen) return
      const rows = providerController?.providerHistory?.({ limit: 12 }) || []
      fields.providerHistory.replaceChildren()
      const header = document.createElement('div')
      header.className = 'settingsProviderHistoryHeader'
      header.innerHTML = '<div><strong>Historique provider</strong><span></span></div><em></em>'
      header.querySelector('span').textContent = rows.length
        ? 'Derniers tests directs, erreurs normalisées et pauses actives.'
        : 'Aucun test provider enregistré.'
      header.querySelector('em').textContent = rows.length ? `${rows.length} lignes` : 'vide'
      fields.providerHistory.appendChild(header)

      if (!rows.length) {
        const empty = document.createElement('p')
        empty.className = 'settingsProviderHistoryEmpty'
        empty.textContent = 'Teste un modèle pour alimenter cet historique.'
        fields.providerHistory.appendChild(empty)
        return
      }

      const list = document.createElement('div')
      list.className = 'settingsProviderHistoryList'
      for (const row of rows) {
        const category = row.category || window.OPCProviderHealth?.statusCategory?.(row) || (row.ok ? 'ok' : 'error')
        const item = document.createElement('article')
        item.className = `settingsProviderHistoryItem ${category}`.trim()
        item.innerHTML = `
          <div class="settingsProviderHistoryMain">
            <strong></strong>
            <span></span>
          </div>
          <div class="settingsProviderHistoryMeta"></div>
          <p></p>
          <div class="settingsProviderHistoryActions"></div>
        `
        item.querySelector('strong').textContent = row.label || providerController?.modelLabel?.(row.model) || row.model
        item.querySelector('span').textContent = window.OPCProviderHealth?.categoryLabel?.(category) || category
        const meta = item.querySelector('.settingsProviderHistoryMeta')
        for (const text of providerHistoryMeta(row)) meta.appendChild(metaChip(text))
        const detail = row.error || row.issue?.detail || row.warning || row.hint || 'Test sans détail.'
        item.querySelector('p').textContent = detail
        item.querySelector('.settingsProviderHistoryActions').appendChild(
          providerButton('Retester', () => providerController?.runProviderCheck?.(row.model, { force: true }))
        )
        list.appendChild(item)
      }
      fields.providerHistory.appendChild(list)
    }

    function providerEventLabel(event = {}) {
      const labels = {
        added: 'Ajout',
        updated: 'Modification',
        deleted: 'Suppression',
        paused: 'Pause',
        restored: 'Restauration',
      }
      return labels[event.action] || event.action || 'Événement'
    }

    function providerEventDetail(event = {}) {
      const parts = [
        event.providerName,
        event.upstreamApi,
        event.keyState === 'configured' ? 'clé configurée' : event.keyState === 'no_auth' ? 'sans auth' : event.keyState === 'missing' ? 'clé manquante' : '',
        event.reason,
      ].filter(Boolean)
      return parts.join(' · ') || 'Mutation provider enregistrée sans secret.'
    }

    function renderProviderEventJournal() {
      if (!fields.providerEventJournal) return
      fields.providerEventJournal.classList.toggle('hidden', providerEditorOpen || providerImportOpen)
      if (providerEditorOpen || providerImportOpen) return
      const rows = Array.isArray(providerConfig?.providerEvents) ? providerConfig.providerEvents.slice().reverse().slice(0, 8) : []
      fields.providerEventJournal.replaceChildren()
      const header = document.createElement('div')
      header.className = 'settingsProviderHistoryHeader'
      header.innerHTML = '<div><strong>Journal provider</strong><span></span></div><em></em>'
      header.querySelector('span').textContent = rows.length
        ? 'Ajouts, suppressions, pauses et restaurations sans clés ni secrets.'
        : 'Aucune mutation provider enregistrée.'
      header.querySelector('em').textContent = rows.length ? `${rows.length} lignes` : 'vide'
      fields.providerEventJournal.appendChild(header)

      if (!rows.length) return
      const list = document.createElement('div')
      list.className = 'settingsProviderHistoryList'
      for (const row of rows) {
        const item = document.createElement('article')
        item.className = 'settingsProviderHistoryItem'
        item.innerHTML = `
          <div class="settingsProviderHistoryMain">
            <strong></strong>
            <span></span>
          </div>
          <div class="settingsProviderHistoryMeta"></div>
          <p></p>
        `
        item.querySelector('strong').textContent = row.label || row.model || row.id || 'Provider'
        item.querySelector('span').textContent = providerEventLabel(row)
        const meta = item.querySelector('.settingsProviderHistoryMeta')
        for (const text of [row.at ? new Date(row.at).toLocaleTimeString() : '', row.model, row.baseUrl].filter(Boolean)) {
          meta.appendChild(metaChip(text))
        }
        item.querySelector('p').textContent = providerEventDetail(row)
        list.appendChild(item)
      }
      fields.providerEventJournal.appendChild(list)
    }

    function profileHost(profile) {
      return panelModel.profileHost(profile, providerConfig?.baseUrl || '')
    }

    function upstreamApiLabel(value) {
      return panelModel.upstreamApiLabel(value)
    }

    function isSuggestionProfile(profile) {
      const usage = providerController?.profileUsage?.(profile) || profile?.usage
      return panelModel.isSuggestionProfile(profile, usage)
    }

    function isDisabledProfile(profile) {
      const usage = providerController?.profileUsage?.(profile) || profile?.usage
      return panelModel.isDisabledProfile(profile, usage)
    }

    function syncEditorUsageControls() {
      const isSuggestion = fields.providerUpstreamApi?.value === 'gitlab-code-suggestions'
      const isOllama = fields.providerUpstreamApi?.value === 'ollama'
      if (isOllama) {
        if (!fields.providerName.value || fields.providerName.value === 'Provider' || fields.providerName.value === 'NVIDIA') fields.providerName.value = 'Ollama'
        if (!fields.providerBaseUrl.value || fields.providerBaseUrl.value === providerConfig?.baseUrl) fields.providerBaseUrl.value = 'http://localhost:11434/v1'
        fields.providerNoAuth.checked = true
      }
      const caps = readCapabilities()
      if (isSuggestion) {
        fields.providerTransport.value = 'buffered'
        fields.providerDefault.checked = false
        for (const [key, getter] of Object.entries(capabilityFields)) {
          const input = getter()
          if (!input) continue
          input.checked = false
          input.disabled = true
        }
      } else {
        for (const getter of Object.values(capabilityFields)) {
          const input = getter()
          if (input) input.disabled = false
        }
        if (!caps.agent) {
          fields.providerDefault.checked = false
        }
        if (fields.providerCapabilityToolChoice && fields.providerCapabilityTools) {
          fields.providerCapabilityToolChoice.disabled = !fields.providerCapabilityTools.checked
          if (!fields.providerCapabilityTools.checked) fields.providerCapabilityToolChoice.checked = false
        }
        if (fields.providerCapabilityAgent && fields.providerCapabilityRefine && !fields.providerCapabilityAgent.checked) {
          fields.providerCapabilityRefine.checked = false
        }
      }
      fields.providerDefault.disabled = Boolean(isSuggestion || !fields.providerCapabilityAgent?.checked)
    }

    function renderProviderMeta(container, profile) {
      const editable = editableProviderFor(profile.model) || profile
      const caps = editable.capabilities || profile.capabilities || {}
      const check = window.OPCProviderHealth?.checkForProfile?.(profile, state.providerChecks || {}) || state.providerChecks?.[profile.model] || state.providerChecks?.[profile.id]
      const category = window.OPCProviderHealth?.statusCategory?.(check)
      const hint = window.OPCProviderHealth?.actionHint?.(check)
      container.replaceChildren(...[
        category ? metaChip(`statut ${window.OPCProviderHealth?.categoryLabel?.(category) || category}`) : metaChip('statut non testé'),
        hint ? metaChip(hint) : metaChip('lancer un test'),
        metaChip(profileHost(editable)),
        metaChip(upstreamApiLabel(editable.upstreamApi)),
        metaChip(editable.transport === 'buffered' ? 'bufferisé' : 'streaming'),
        isDisabledProfile(editable) ? metaChip(`pause ${editable.disabledReason || 'diagnostic'}`) : null,
        metaChip(editable.agentRunnable === false ? 'non agent' : 'agent'),
        metaChip(caps.tools === false ? 'sans outils' : 'outils'),
        metaChip(caps.reasoningPassThrough ? 'reasoning relay' : caps.thinking === false ? 'thinking off' : 'thinking'),
        metaChip(caps.refine === false ? 'sans raffinage' : 'raffinage'),
        metaChip(`${Math.round((editable.timeoutMs || 300000) / 1000)}s timeout`),
        metaChip(`${Math.round((editable.checkTimeoutMs || 60000) / 1000)}s test`),
        metaChip(`${editable.retries ?? 0} retries`),
        ...((panelModel.providerBudgetMeta?.(editable) || []).map(metaChip)),
        metaChip(editable.noAuth ? 'sans auth' : editable.apiKeySet || editable.configured ? 'clé configurée' : 'clé à ajouter'),
      ].filter(Boolean))
    }

    function providerItem(profile) {
        const check = window.OPCProviderHealth?.checkForProfile?.(profile, state.providerChecks || {}) || state.providerChecks?.[profile.model]
        const item = document.createElement('div')
        const statusClass = window.OPCProviderHealth?.statusClass?.(check) || ''
        item.className = `settingsProviderItem ${statusClass}`.trim()
        item.innerHTML = '<div><strong></strong><span></span></div><span class="settingsProviderStatus"></span><div class="settingsProviderMeta"></div><div class="settingsProviderActions"></div>'
        item.querySelector('strong').textContent = profile.label || profile.id || profile.model
        item.querySelector('span').textContent = providerSubtitle(profile)
        const status = item.querySelector('.settingsProviderStatus')
        status.textContent = helpers.checkLabel(check)
        if (statusClass) status.classList.add(statusClass)
        status.title = window.OPCProviderHealth?.title?.(check) || ''
        renderProviderMeta(item.querySelector('.settingsProviderMeta'), profile)
        item.querySelector('.settingsProviderActions').append(
          providerButton('Tester', () => providerController?.runProviderCheck?.(profile.model)),
          providerButton('Modifier', () => openEditor(editableProviderFor(profile.model) || profile)),
          providerButton('Dupliquer', () => duplicateProvider(profile)),
          providerButton('Copier JSON', () => copyProviderJson(profile)),
          isDisabledProfile(profile) ? providerButton('Restaurer', () => restoreProvider(profile)) : quarantineProviderButton(profile),
          deleteProviderButton(profile),
          defaultProviderButton(profile),
        )
        return item
    }

    function providerGroup(title, detail, profiles, className = '') {
      const group = document.createElement('section')
      group.className = `settingsProviderGroup ${className}`.trim()
      const header = document.createElement('div')
      header.className = 'settingsProviderGroupHeader'
      header.innerHTML = '<div><strong></strong><span></span></div><em></em>'
      header.querySelector('strong').textContent = title
      header.querySelector('span').textContent = detail
      header.querySelector('em').textContent = `${profiles.length}`
      group.appendChild(header)
      for (const profile of profiles) group.appendChild(providerItem(profile))
      return group
    }

    function renderList() {
      fields.providerList.classList.toggle('hidden', providerEditorOpen || providerImportOpen)
      if (providerEditorOpen || providerImportOpen) return
      fields.providerList.innerHTML = ''
      const profiles = state.providerProfiles || []
      if (!profiles.length) {
        const empty = document.createElement('div')
        empty.className = 'settingsProviderItem'
        empty.innerHTML = '<div><strong>Aucun provider chargé</strong><span>Vérifie la configuration OPC ou relance le health check.</span></div><span class="settingsProviderStatus error">vide</span>'
        fields.providerList.appendChild(empty)
        return
      }
      const activeProfiles = profiles.filter(profile => !isDisabledProfile(profile))
      const nvidia = activeProfiles.filter(profile => (profile.providerName || profile.provider || '').toLowerCase() === 'nvidia')
      const ollama = activeProfiles.filter(profile => (profile.providerName || profile.provider || '').toLowerCase() === 'ollama')
      const other = activeProfiles.filter(profile => !nvidia.includes(profile) && !ollama.includes(profile) && !isSuggestionProfile(profile))
      const disabled = providerController?.disabledProfiles ? providerController.disabledProfiles(profiles) : profiles.filter(isDisabledProfile)
      if (nvidia.length) fields.providerList.appendChild(providerGroup('NVIDIA', 'Modèles cloud conservés dans OPC.', nvidia, 'agent nvidia'))
      if (ollama.length) fields.providerList.appendChild(providerGroup('Ollama', 'Modèles locaux OpenAI-compatible via http://localhost:11434/v1.', ollama, 'agent ollama'))
      if (other.length) fields.providerList.appendChild(providerGroup('Autres masqués au prochain lancement', 'Ces profils ne font plus partie du périmètre NVIDIA/Ollama.', other, 'disabled'))
      if (disabled.length) {
        fields.providerList.appendChild(providerGroup('Providers en pause', 'Retirés du sélecteur principal sans perdre leur configuration.', disabled, 'disabled'))
      }
    }

    function providerButton(label, onClick, options = {}) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = `settingsProviderMiniButton ${options.className || ''}`.trim()
      button.textContent = label
      if (options.title) button.title = options.title
      button.addEventListener('click', onClick)
      return button
    }

    function deleteProviderButton(profile) {
      const label = panelModel.deleteModelLabel?.(profile) || 'Supprimer'
      const title = `Supprimer ${profile.label || profile.model || 'ce modèle'}`
      return providerButton(label, () => deleteProviderProfile(profile), { className: 'danger', title })
    }

    function defaultProviderButton(profile) {
      if (isDisabledProfile(profile)) {
        const button = providerButton('En pause', () => {})
        button.disabled = true
        return button
      }
      if (isSuggestionProfile(profile)) {
        const button = providerButton('Non agent', () => {})
        button.disabled = true
        return button
      }
      const button = providerButton(profile.model === state.providerDefaultModel ? 'Défaut' : 'Par défaut', async () => {
        try {
          providerConfig = await providerController?.setDefaultProvider?.(profile.model)
          applySettingsPatch({ model: profile.model })
        } catch (error) {
          providerEditorOpen = true
          setProviderEditorError(error.message || String(error))
        }
      })
      button.disabled = profile.model === state.providerDefaultModel
      return button
    }

    function quarantineProviderButton(profile) {
      const check = window.OPCProviderHealth?.checkForProfile?.(profile, state.providerChecks || {}) || state.providerChecks?.[profile.model]
      const category = window.OPCProviderHealth?.statusCategory?.(check) || ''
      const canPause = ['needs_config', 'context_length', 'unsupported', 'timeout', 'network', 'server', 'error', 'rate_limited'].includes(category)
      const button = providerButton('Pause', () => pauseProvider(profile))
      button.disabled = !canPause
      button.title = canPause ? 'Mettre ce provider en pause.' : 'Disponible après un test provider en erreur.'
      return button
    }

    async function pauseProvider(profile) {
      try {
        setProviderActionStatus(`Mise en pause de ${profile.label || profile.model}...`, 'warning')
        await providerController?.quarantineProviders?.([profile.model], 'Mis en pause manuellement depuis Settings OPC.')
        await refreshProviderConfig()
        setProviderActionStatus(`${profile.label || profile.model} est en pause.`, '')
      } catch (error) {
        setProviderActionStatus(error.message || String(error), 'error')
      } finally {
        render()
        renderSettings()
      }
    }

    async function deleteProviderProfile(profile) {
      const target = profile.model || profile.id
      if (!target || !window.confirm?.(panelModel.deleteModelConfirmMessage?.(profile) || 'Supprimer ce modèle OPC ?')) return
      try {
        setProviderActionStatus(`Suppression de ${profile.label || profile.model}...`, 'warning')
        providerConfig = await providerController?.deleteProviderProfile?.(target)
        if (state.settings.model === target) {
          applySettingsPatch({ model: providerConfig?.defaultModel || state.providerDefaultModel || '' }, { renderView: false })
        }
        setProviderActionStatus(`${profile.label || profile.model} a été supprimé.`, '')
      } catch (error) {
        setProviderActionStatus(error.message || String(error), 'error')
      } finally {
        render()
        renderSettings()
      }
    }

    async function restoreProvider(profile) {
      try {
        setProviderActionStatus(`Restauration de ${profile.label || profile.model}...`, 'warning')
        await providerController?.restoreProviderProfile?.(profile.model)
        await refreshProviderConfig()
        setProviderActionStatus(`${profile.label || profile.model} est restauré. Relance un test modèle.`, '')
      } catch (error) {
        setProviderActionStatus(error.message || String(error), 'error')
      } finally {
        render()
        renderSettings()
      }
    }

    async function saveEditor(event) {
      event.preventDefault()
      try {
        fields.providerSave.disabled = true
        const payload = readEditor()
        providerConfig = await providerController?.saveProviderProfile?.(payload)
        if (payload.makeDefault) applySettingsPatch({ model: payload.model }, { renderView: false })
        closeEditor()
        render()
        renderSettings()
      } catch (error) {
        setProviderEditorError(error.message || String(error))
      } finally {
        fields.providerSave.disabled = false
      }
    }

    async function deleteCurrentProvider() {
      const target = editingProviderModel || editingProviderId
      if (!target || !window.confirm?.('Supprimer ce provider OPC ?')) return
      try {
        providerConfig = await providerController?.deleteProviderProfile?.(target)
        if (state.settings.model === target) {
          applySettingsPatch({ model: providerConfig?.defaultModel || state.providerDefaultModel || '' }, { renderView: false })
        }
        closeEditor()
        render()
        renderSettings()
      } catch (error) {
        setProviderEditorError(error.message || String(error))
      }
    }

    async function exportProviderConfig() {
      try {
        const config = await providerController?.exportProviderConfig?.()
        const ok = await providerController?.copyText?.(JSON.stringify(config, null, 2))
        if (!ok) setProviderEditorError('Export JSON indisponible.')
      } catch (error) {
        providerEditorOpen = true
        setProviderEditorError(error.message || String(error))
      }
    }

    async function repairProviders() {
      const repairAction = providerController?.repairAndCheckProblemProviders || providerController?.repairAndCheckAllProviders
      if (!repairAction || providerRepairRunning) return
      providerRepairRunning = true
      providerEditorOpen = false
      providerImportOpen = false
      setProviderEditorError('')
      setProviderActionStatus('Réparation provider et retest ciblé en cours...', 'warning')
      render()
      renderSettings()
      try {
        const result = await repairAction({ force: true })
        providerConfig = result?.config || providerConfig
        await refreshProviderConfig()
        providerRepairLog = {
          repair: result?.repair || { repaired: false, count: 0, changes: [] },
          checkedModels: result?.checkedModels || [],
        }
        const detail = result?.repair?.repaired
          ? `${result.repair.count || 0} correction(s) provider appliquée(s).`
          : 'Aucune réparation provider nécessaire.'
        const checkedCount = Array.isArray(result?.checkedModels) ? result.checkedModels.length : 0
        setProviderActionStatus(`${detail} Retest ciblé terminé: ${checkedCount} provider(s).`, '')
      } catch (error) {
        setProviderActionStatus(error.message || String(error), 'error')
      } finally {
        providerRepairRunning = false
        render()
        renderSettings()
      }
    }

    function discoveryPayload() {
      if (providerEditorOpen && fields.providerBaseUrl?.value) {
        return {
          model: fields.providerModel?.value || editingProviderModel,
          baseUrl: fields.providerBaseUrl.value,
          providerName: fields.providerName?.value || fields.providerLabel?.value || 'Provider',
          upstreamApi: fields.providerUpstreamApi?.value || 'openai',
          transport: fields.providerTransport?.value || 'stream',
          timeoutMs: fields.providerTimeout?.value,
          checkTimeoutMs: fields.providerCheckTimeout?.value,
          retries: fields.providerRetries?.value,
          maxTokens: fields.providerMaxTokens?.value,
          apiKey: fields.providerApiKey?.value,
          noAuth: Boolean(fields.providerNoAuth?.checked),
          capabilities: readCapabilities(),
          import: true,
        }
      }
      return { model: state.settings.model, import: true }
    }

    async function discoverProviderModels() {
      if (providerDiscoverRunning) return
      providerDiscoverRunning = true
      setProviderActionStatus('Découverte /models en cours...', 'warning')
      try {
        const result = await providerController?.discoverProviderModels?.(discoveryPayload())
        providerConfig = result?.config || providerConfig
        await refreshProviderConfig()
        setProviderActionStatus(`${result?.count || 0} modèle(s) importé(s) depuis /models${result?.truncated ? ' · liste tronquée' : ''}.`, '')
      } catch (error) {
        setProviderActionStatus(error.message || String(error), 'error')
      } finally {
        providerDiscoverRunning = false
        render()
        renderSettings()
      }
    }

    async function quarantineProblemProviders() {
      if (providerQuarantineRunning) return
      providerQuarantineRunning = true
      setProviderActionStatus('Mise en pause des providers en erreur...', 'warning')
      try {
        const result = await providerController?.quarantineProblemProviders?.()
        providerConfig = result?.config || providerConfig
        await refreshProviderConfig()
        setProviderActionStatus(`${result?.changed || 0} provider(s) mis en pause.`, '')
      } catch (error) {
        setProviderActionStatus(error.message || String(error), 'error')
      } finally {
        providerQuarantineRunning = false
        render()
        renderSettings()
      }
    }

    async function pasteProviderImport() {
      try {
        const text = await providerController?.readClipboardText?.()
        fields.providerImportText.value = text || ''
      } catch (error) {
        setProviderImportError(error.message || String(error))
      }
    }

    async function importProviderConfig() {
      try {
        fields.providerImportSave.disabled = true
        const text = fields.providerImportText.value.trim()
        if (!text) throw new Error('Colle un JSON de provider ou de configuration.')
        const payload = JSON.parse(text)
        providerConfig = await providerController?.importProviderConfig?.(payload)
        closeImportPanel()
        render()
        renderSettings()
      } catch (error) {
        setProviderImportError(error.message || String(error))
      } finally {
        fields.providerImportSave.disabled = false
      }
    }

    function renderPanel() {
      renderSummary()
      renderList()
      renderEditor()
      renderImportPanel()
      renderProviderRepairLog()
      renderProviderEventJournal()
      renderProviderHistory()
      if (fields.repairProviders) {
        fields.repairProviders.disabled = providerRepairRunning || providerController?.isCheckingAll?.()
        fields.repairProviders.textContent = providerRepairRunning ? 'Réparation...' : 'Réparer + retester'
      }
      if (fields.discoverProviders) {
        fields.discoverProviders.disabled = providerDiscoverRunning
        fields.discoverProviders.textContent = providerDiscoverRunning ? 'Découverte...' : 'Découvrir /models'
      }
      if (fields.quarantineProviders) {
        fields.quarantineProviders.disabled = providerQuarantineRunning
        fields.quarantineProviders.textContent = providerQuarantineRunning ? 'Pause...' : 'Pause erreurs'
      }
      setProviderActionStatus(providerActionStatus, providerActionTone)
    }

    function wire() {
      fields.testModel?.addEventListener('click', () => providerController?.checkSelectedProvider?.(fields.model.value || state.settings.model))
      fields.testAllProviders?.addEventListener('click', () => providerController?.checkAllProviders?.())
      fields.repairProviders?.addEventListener('click', repairProviders)
      fields.discoverProviders?.addEventListener('click', discoverProviderModels)
      fields.quarantineProviders?.addEventListener('click', quarantineProblemProviders)
      fields.refreshProviders?.addEventListener('click', async () => {
        await providerController?.refreshHealth?.()
        await refreshProviderConfig()
      })
      fields.exportProviders?.addEventListener('click', exportProviderConfig)
      fields.importProviders?.addEventListener('click', openImportPanel)
      fields.addProvider?.addEventListener('click', openBlankEditor)
      fields.addOllamaProvider?.addEventListener('click', openOllamaEditor)
      fields.providerCancel?.addEventListener('click', closeEditor)
      fields.providerEditor?.addEventListener('submit', saveEditor)
      fields.providerDelete?.addEventListener('click', deleteCurrentProvider)
      fields.providerImportCancel?.addEventListener('click', closeImportPanel)
      fields.providerImportSave?.addEventListener('click', importProviderConfig)
      fields.providerImportPaste?.addEventListener('click', pasteProviderImport)
      fields.providerUpstreamApi?.addEventListener('change', syncEditorUsageControls)
      for (const getter of Object.values(capabilityFields)) {
        getter()?.addEventListener('change', syncEditorUsageControls)
      }
    }

    wire()

    return {
      closeEditor,
      refresh: refreshProviderConfig,
      render: renderPanel,
    }
  }

  window.OPCSettingsProviderPanel = { createSettingsProviderPanel }
})()
