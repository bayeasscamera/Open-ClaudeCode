(function () {
  const helpers = window.OPCSettingsHelpers

  const SETTINGS_TABS = {
    general: {
      label: 'Runtime',
      keywords: 'général runtime dossier modèle permissions mémoire cwd repository autoriser édition auto plan standard',
    },
    providers: {
      label: 'Providers',
      keywords: 'providers modèles api clé token timeout retries base url nvidia ollama local cloud test défaut streaming importer export json dupliquer copier',
    },
    environment: {
      label: 'Environnement',
      keywords: 'environnement local cli bridge provider mémoire tooling agent doctor santé installation paquet sandbox offline runtime',
    },
    project: {
      label: 'Projet',
      keywords: 'projet instructions mémoire fichiers conversations runtime dossier nouveau chat',
    },
    data: {
      label: 'Données',
      keywords: 'données historique sessions sauvegarde export import effacer local disque projets',
    },
    doctor: {
      label: 'Doctor',
      keywords: 'diagnostic doctor santé runtime cli provider git secrets installation erreurs warnings rapport verification',
    },
    interface: {
      label: 'Interface',
      keywords: 'interface compact inspecteur logs densité panneau visuel affichage',
    },
  }

  function createSettingsController({
    els,
    state,
    store,
    providerController,
    projectController,
    chatController,
    opc = window.opc,
    actions = {},
    applySettingsPatch = () => {},
    applyUiSettings = () => {},
    render = () => {},
  } = {}) {
    const root = els.settingsModal
    let activeTab = 'general'
    let searchQuery = ''

    const q = selector => root?.querySelector(selector)
    const qa = selector => Array.from(root?.querySelectorAll(selector) || [])
    const fields = {
      close: q('#settingsClose'),
      search: q('#settingsSearchInput'),
      overview: q('#settingsOverview'),
      searchEmpty: q('#settingsSearchEmpty'),
      cwd: q('#settingsCwdInput'),
      model: q('#settingsModelInput'),
      refineModel: q('#settingsRefineModelInput'),
      permission: q('#settingsPermissionSelect'),
      memory: q('#settingsMemoryToggle'),
      providerAutoRouter: q('#settingsProviderAutoRouterToggle'),
      providerAutoRouterThreshold: q('#settingsProviderAutoRouterThreshold'),
      advancedPermissionStrict: q('#settingsAdvancedPermissionStrictToggle'),
      think: q('#settingsThinkToggle'),
      compact: q('#settingsCompactToggle'),
      inspector: q('#settingsInspectorToggle'),
      textSize: q('#settingsTextSizeSelect'),
      providerSummary: q('#settingsProviderSummary'),
      providerList: q('#settingsProviderList'),
      providerActionStatus: q('#settingsProviderActionStatus'),
      providerRepairLog: q('#settingsProviderRepairLog'),
      providerEventJournal: q('#settingsProviderEventJournal'),
      providerHistory: q('#settingsProviderHistory'),
      environmentSummary: q('#settingsEnvironmentSummary'),
      environmentStack: q('#settingsEnvironmentStack'),
      environmentDoctor: q('#settingsEnvironmentDoctor'),
      environmentRepair: q('#settingsEnvironmentRepair'),
      environmentRefresh: q('#settingsEnvironmentRefresh'),
      projectSummary: q('#settingsProjectSummary'),
      dataSummary: q('#settingsDataSummary'),
      dataStatus: q('#settingsDataStatus'),
      doctorSummary: q('#settingsDoctorSummary'),
      doctorReport: q('#settingsDoctorReport'),
      runDoctor: q('#settingsRunDoctor'),
      doctorRepairProviders: q('#settingsDoctorRepairProviders'),
      copyDoctor: q('#settingsCopyDoctor'),
      exportSupportBundle: q('#settingsExportSupportBundle'),
      applyGeneral: q('#settingsApplyGeneral'),
      openFolder: q('#settingsOpenFolder'),
      testModel: q('#settingsTestModel'),
      testAllProviders: q('#settingsTestAllProviders'),
      repairProviders: q('#settingsRepairProviders'),
      discoverProviders: q('#settingsDiscoverProviders'),
      quarantineProviders: q('#settingsQuarantineProviders'),
      refreshProviders: q('#settingsRefreshProviders'),
      exportProviders: q('#settingsExportProviders'),
      importProviders: q('#settingsImportProviders'),
      addProvider: q('#settingsAddProvider'),
      addOllamaProvider: q('#settingsAddOllamaProvider'),
      providerEditor: q('#settingsProviderEditor'),
      providerEditorTitle: q('#settingsProviderEditorTitle'),
      providerEditorError: q('#settingsProviderEditorError'),
      providerLabel: q('#settingsProviderLabel'),
      providerModel: q('#settingsProviderModel'),
      providerName: q('#settingsProviderName'),
      providerBaseUrl: q('#settingsProviderBaseUrl'),
      providerUpstreamApi: q('#settingsProviderUpstreamApi'),
      providerTransport: q('#settingsProviderTransport'),
      providerTimeout: q('#settingsProviderTimeout'),
      providerCheckTimeout: q('#settingsProviderCheckTimeout'),
      providerRetries: q('#settingsProviderRetries'),
      providerMaxTokens: q('#settingsProviderMaxTokens'),
      providerApiKey: q('#settingsProviderApiKey'),
      providerNoAuth: q('#settingsProviderNoAuth'),
      providerDefault: q('#settingsProviderDefault'),
      providerCapabilityAgent: q('#settingsProviderCapabilityAgent'),
      providerCapabilitySystem: q('#settingsProviderCapabilitySystem'),
      providerCapabilityStreaming: q('#settingsProviderCapabilityStreaming'),
      providerCapabilityTools: q('#settingsProviderCapabilityTools'),
      providerCapabilityToolChoice: q('#settingsProviderCapabilityToolChoice'),
      providerCapabilityTemperature: q('#settingsProviderCapabilityTemperature'),
      providerCapabilityThinking: q('#settingsProviderCapabilityThinking'),
      providerCapabilityRefine: q('#settingsProviderCapabilityRefine'),
      providerCapabilityReasoningPassThrough: q('#settingsProviderCapabilityReasoningPassThrough'),
      providerCapabilityReasoningExclude: q('#settingsProviderCapabilityReasoningExclude'),
      providerSystemPrefix: q('#settingsProviderSystemPrefix'),
      providerExtraBody: q('#settingsProviderExtraBody'),
      providerSave: q('#settingsProviderSave'),
      providerCancel: q('#settingsProviderCancel'),
      providerDelete: q('#settingsProviderDelete'),
      providerImportPanel: q('#settingsProviderImportPanel'),
      providerImportText: q('#settingsProviderImportText'),
      providerImportError: q('#settingsProviderImportError'),
      providerImportCancel: q('#settingsProviderImportCancel'),
      providerImportSave: q('#settingsProviderImportSave'),
      providerImportPaste: q('#settingsProviderImportPaste'),
      applyProjectRuntime: q('#settingsApplyProjectRuntime'),
      saveProjectRuntime: q('#settingsSaveProjectRuntime'),
      newProject: q('#settingsNewProject'),
      newChat: q('#settingsNewChat'),
      clearHistory: q('#settingsClearHistory'),
      exportProject: q('#settingsExportProject'),
      importProject: q('#settingsImportProject'),
      exportStateBackup: q('#settingsExportStateBackup'),
      importStateBackup: q('#settingsImportStateBackup'),
      applyInterface: q('#settingsApplyInterface'),
    }
    let dataStatusMessage = ''
    let dataStatusTone = ''
    const doctorState = {
      status: 'idle',
      report: null,
      error: '',
      repairRunning: false,
      supportExporting: false,
      supportMessage: '',
    }

    const providerPanel = window.OPCSettingsProviderPanel.createSettingsProviderPanel({
      fields,
      state,
      providerController,
      applySettingsPatch,
      render,
      renderSettings,
    })

    function open() {
      renderSettings()
      root.classList.remove('hidden')
      providerPanel.refresh()
      requestAnimationFrame(() => fields.search?.focus())
    }

    function close() {
      root.classList.add('hidden')
    }

    function selectTab(tab, { refresh = true } = {}) {
      activeTab = tab || 'general'
      applySearchFilter()
      if (refresh && activeTab === 'providers') providerPanel.refresh()
    }

    function shortPath(value = '') {
      const text = String(value || '').replace(/\/+$/g, '')
      if (!text) return 'Non défini'
      return text.split('/').filter(Boolean).pop() || text
    }

    function providerSearchText() {
      return (state.providerProfiles || []).map(profile => [
        profile.label,
        profile.model,
        profile.providerName,
        profile.baseUrl,
        profile.upstreamApi,
        profile.transport,
        helpers.checkLabel(state.providerChecks?.[profile.model]),
      ].filter(Boolean).join(' ')).join(' ')
    }

    function tabSearchText(tab) {
      const base = `${SETTINGS_TABS[tab]?.label || tab} ${SETTINGS_TABS[tab]?.keywords || ''}`
      const permissionLabel = helpers.PERMISSION_LABELS[state.settings?.permissionMode] || state.settings?.permissionMode || ''
      const summary = helpers.activeProjectSummary(state, projectController)
      if (tab === 'general') {
        return `${base} ${state.settings?.cwd || ''} ${state.settings?.model || ''} ${state.settings?.refineModel || ''} raffinage prompt composer ${permissionLabel} ${state.settings?.memoryEnabled !== false ? 'mémoire active' : 'mémoire pause'} ${state.settings?.providerAutoRouterEnabled ? 'auto-router provider actif fallback automatique' : 'auto-router provider inactif'} seuil provider ${state.settings?.providerAutoRouterThreshold || 2} ${state.settings?.advancedPermissionStrictMode ? 'permissions strictes actives blocage critique' : 'permissions strictes inactives'} ${state.settings?.thinkEnabled ? 'think actif raisonnement profond' : 'think inactif'}`
      }
      if (tab === 'providers') return `${base} ${providerSearchText()}`
      if (tab === 'environment') {
        const counts = helpers.settingsCounts(state)
        const bridge = state.providerBridgeUrl || ''
        const runtime = state.runtime?.pid ? `pid ${state.runtime.pid}` : 'runtime inactif'
        return `${base} ${state.healthOk ? 'cli ok' : 'cli erreur'} ${state.healthVersion || ''} ${bridge} ${runtime} ${counts.localProviders} providers locaux ${state.settings?.memoryEnabled !== false ? 'memoire active' : 'memoire pause'} ${state.providerConfigError || ''}`
      }
      if (tab === 'project') return `${base} ${summary.name} ${summary.description} ${summary.runtime.join(' ')}`
      if (tab === 'data') {
        const counts = helpers.settingsCounts(state)
        return `${base} ${counts.chats} sessions ${counts.projects} projets ${counts.providers} providers ${state.persistenceError || 'sauvegarde ok'}`
      }
      if (tab === 'doctor') {
        const summary = doctorState.report?.summary || {}
        return `${base} ${summary.status || doctorState.status} ${summary.errors || 0} erreurs ${summary.warnings || 0} alertes ${doctorState.error || ''}`
      }
      if (tab === 'interface') return `${base} taille texte ${state.settings?.textSize || 'medium'} ${state.settings?.compactMode ? 'compact actif' : 'compact inactif'} ${state.settings?.inspectorOpen ? 'inspecteur ouvert' : 'inspecteur fermé'}`
      return base
    }

    function tabMatchesSearch(tab) {
      return helpers.settingsSearchMatches(tabSearchText(tab), searchQuery)
    }

    function visibleTabs() {
      return Object.keys(SETTINGS_TABS).filter(tabMatchesSearch)
    }

    function applySearchFilter() {
      const visible = visibleTabs()
      if (!visible.includes(activeTab) && visible.length) activeTab = visible[0]
      const hasMatch = visible.length > 0
      for (const button of qa('[data-settings-tab]')) {
        const isVisible = visible.includes(button.dataset.settingsTab)
        button.classList.toggle('searchHidden', !isVisible)
        button.classList.toggle('active', hasMatch && button.dataset.settingsTab === activeTab)
      }
      for (const panel of qa('[data-settings-panel]')) {
        const isVisible = visible.includes(panel.dataset.settingsPanel)
        panel.classList.toggle('searchHidden', !isVisible)
        panel.classList.toggle('active', hasMatch && panel.dataset.settingsPanel === activeTab)
      }
      fields.searchEmpty?.classList.toggle('hidden', hasMatch)
      renderOverview()
    }

    function jumpToTab(tab) {
      if (searchQuery && !tabMatchesSearch(tab)) {
        searchQuery = ''
        if (fields.search) fields.search.value = ''
      }
      selectTab(tab)
    }

    function overviewCard(tab, label, value, detail) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'settingsOverviewCard'
      button.classList.toggle('active', activeTab === tab)
      button.innerHTML = '<span></span><strong></strong><em></em>'
      button.querySelector('span').textContent = label
      button.querySelector('strong').textContent = value
      button.querySelector('em').textContent = detail
      button.addEventListener('click', () => jumpToTab(tab))
      return button
    }

    function renderOverview() {
      if (!fields.overview) return
      const counts = helpers.settingsCounts(state)
      const project = helpers.activeProjectSummary(state, projectController)
      const selectedModel = providerController?.modelLabel?.(state.settings?.model) || state.settings?.model || 'aucun'
      const providerDetail = counts.errorProviders ? `${counts.errorProviders} erreur(s)` : `${counts.okProviders}/${counts.providers} OK`
      fields.overview.replaceChildren(
        overviewCard('general', 'Runtime', selectedModel, shortPath(state.settings?.cwd)),
        overviewCard('providers', 'Providers', `${counts.providers} profils`, providerDetail),
        overviewCard('environment', 'Local', state.healthOk ? 'CLI prêt' : 'CLI à vérifier', state.providerBridgeUrl ? 'bridge actif' : 'bridge non lu'),
        overviewCard('project', 'Projet', project.name, `${project.chats} sessions · ${project.files} fichiers`),
        overviewCard('data', 'Données', `${counts.chats} sessions`, state.persistenceError ? 'sauvegarde en erreur' : 'sauvegarde OK'),
        overviewCard('doctor', 'Doctor', doctorStatusText(), doctorDetailText()),
      )
    }

    function syncModelOptions(select) {
      if (!select) return
      const profiles = providerController?.agentProfiles ? providerController.agentProfiles() : (state.providerProfiles || []).filter(profile => profile.agentRunnable !== false)
      const signature = JSON.stringify(profiles.map(profile => [profile.model, profile.label]))
      if (select.dataset.signature === signature && select.value === state.settings.model) return
      select.dataset.signature = signature
      select.innerHTML = ''
      if (!profiles.length && state.settings.model) {
        select.append(new Option(state.settings.model, state.settings.model))
      } else {
        for (const profile of profiles) {
          select.append(new Option(providerController?.profileOptionLabel?.(profile) || profile.label || profile.model, profile.model))
        }
      }
      select.value = state.settings.model || state.providerDefaultModel || ''
    }

    function syncRefineModelOptions(select) {
      if (!select) return
      const profiles = providerController?.refineProfiles
        ? providerController.refineProfiles()
        : (state.providerProfiles || []).filter(profile => profile.agentRunnable !== false && profile.capabilities?.refine !== false)
      const value = state.settings.refineModel || window.OPCPromptComposerController?.DEFAULT_REFINER_MODEL || 'qwen/qwen3.5-122b-a10b'
      const signature = JSON.stringify(['refine', value, profiles.map(profile => [profile.model, profile.label])])
      if (select.dataset.signature === signature && select.value === value) return
      select.dataset.signature = signature
      select.innerHTML = ''
      let hasValue = false
      for (const profile of profiles) {
        const option = new Option(providerController?.profileOptionLabel?.(profile) || profile.label || profile.model, profile.model)
        select.append(option)
        if (profile.model === value) hasValue = true
      }
      if (value && !hasValue) select.prepend(new Option(value, value))
      select.value = value
    }

    function renderProjectSummary() {
      const summary = helpers.activeProjectSummary(state, projectController)
      fields.projectSummary.innerHTML = [
        '<div class="settingsProjectHeader"><div><h3></h3><p></p></div><span class="settingsLocalBadge">local seulement</span></div>',
        '<div class="settingsProjectRuntime"></div>',
        '<div class="settingsProjectMaturity"></div>',
        '<div class="settingsMetricGrid"></div>',
      ].join('')
      fields.projectSummary.querySelector('h3').textContent = summary.name
      fields.projectSummary.querySelector('p').textContent = summary.description
      const runtime = fields.projectSummary.querySelector('.settingsProjectRuntime')
      for (const item of summary.runtime) {
        const chip = document.createElement('span')
        chip.textContent = item
        runtime.appendChild(chip)
      }
      const maturity = fields.projectSummary.querySelector('.settingsProjectMaturity')
      for (const item of [
        ['Mémoire', summary.memoryStatus, summary.memoryChars ? `${summary.memoryChars} caractères` : 'à compléter'],
        ['Instructions', summary.instructionsStatus, summary.instructionsChars ? `${summary.instructionsChars} caractères` : 'à compléter'],
        ['Fichiers', `${summary.fileStats.indexed}/${summary.fileStats.total} indexés`, summary.fileStats.readNext ? `${summary.fileStats.readNext} à lire au prochain prompt` : 'aucun fichier forcé'],
        ['Runtime', summary.runtimeOverrides ? `${summary.runtimeOverrides} override(s)` : 'réglages globaux', 'appliqué par projet'],
      ]) {
        const block = document.createElement('div')
        block.innerHTML = '<span></span><strong></strong><em></em>'
        block.querySelector('span').textContent = item[0]
        block.querySelector('strong').textContent = item[1]
        block.querySelector('em').textContent = item[2]
        maturity.appendChild(block)
      }
      const grid = fields.projectSummary.querySelector('.settingsMetricGrid')
      grid.append(
        helpers.metric('Sessions', summary.chats, 'dans ce projet'),
        helpers.metric('Fichiers', summary.files, summary.fileStats.errors ? `${summary.fileStats.errors} erreur(s) index` : 'attachés au projet'),
      )
    }

    function environmentItem({ title, value, detail, tone = 'neutral' }) {
      const item = document.createElement('article')
      item.className = `settingsEnvironmentItem ${tone}`.trim()
      item.innerHTML = '<div><span></span><strong></strong></div><p></p>'
      item.querySelector('span').textContent = title
      item.querySelector('strong').textContent = value
      item.querySelector('p').textContent = detail
      return item
    }

    function renderEnvironment() {
      if (!fields.environmentSummary || !fields.environmentStack) return
      const counts = helpers.settingsCounts(state)
      const activeProfile = providerController?.profileForModel?.(state.settings?.model) || null
      const selectedCheck = providerController?.selectedProviderCheck?.() || state.providerCheck || null
      const memoryState = state.settings?.memoryEnabled !== false ? 'Active' : 'Pause'
      const bridgeUrl = state.providerBridgeUrl || 'Non lu'
      fields.environmentSummary.replaceChildren(
        helpers.metric('CLI', state.healthOk ? 'Prêt' : 'À vérifier', state.healthVersion || state.healthError || 'version non lue'),
        helpers.metric('Bridge', state.providerBridgeUrl ? 'Actif' : 'Non lu', bridgeUrl),
        helpers.metric('Mémoire', memoryState, 'stockage local OPC'),
        helpers.metric('Providers locaux', counts.localProviders, `${counts.agentProviders} agents · ${counts.refineProviders} raffineurs`),
      )
      fields.environmentStack.replaceChildren(
        environmentItem({
          title: 'Agent CLI',
          value: state.runtime?.pid ? `PID ${state.runtime.pid}` : (state.running ? 'Session active' : 'Disponible'),
          detail: state.running ? 'Une commande est en cours. Les contrôles restent côté renderer pour ne pas bloquer l’UI.' : 'Le CLI est lancé à la demande et reste piloté localement.',
          tone: state.running || state.runtime?.pid ? 'running' : 'ok',
        }),
        environmentItem({
          title: 'Provider sélectionné',
          value: activeProfile ? providerController?.profileOptionLabel?.(activeProfile) || activeProfile.label || activeProfile.model : 'Aucun profil',
          detail: selectedCheck ? helpers.checkLabel(selectedCheck) : 'Lance un test modèle depuis Providers ou Doctor pour valider la clé et les capacités.',
          tone: selectedCheck?.ok ? 'ok' : selectedCheck?.ok === false ? 'error' : 'neutral',
        }),
        environmentItem({
          title: 'Outils agent',
          value: 'Shell · Read · Edit · Web',
          detail: 'Les outils restent exécutés par le CLI local avec permissions contrôlées depuis le sélecteur OPC.',
          tone: 'neutral',
        }),
        environmentItem({
          title: 'Données locales',
          value: `${counts.chats} sessions · ${counts.projects} projets`,
          detail: 'Projets, mémoire, historique et providers sont conservés dans les données locales de l’app.',
          tone: state.persistenceError ? 'error' : 'ok',
        }),
      )
      if (fields.environmentDoctor) fields.environmentDoctor.disabled = doctorState.status === 'running'
      if (fields.environmentRepair) {
        fields.environmentRepair.disabled = doctorState.status === 'running' || doctorState.repairRunning || providerController?.isCheckingAll?.()
        fields.environmentRepair.textContent = doctorState.repairRunning ? 'Réparation...' : 'Réparer providers'
      }
    }

    function renderDataSummary() {
      const counts = helpers.settingsCounts(state)
      fields.dataSummary.replaceChildren(
        helpers.metric('Sessions', counts.chats, 'historique local'),
        helpers.metric('Projets', counts.projects, 'espaces de travail'),
        helpers.metric('Providers', counts.providers, 'profils disponibles'),
        helpers.metric('Sauvegarde', state.persistenceError ? 'Erreur' : 'OK', state.persistenceError || 'local + disque'),
      )
      if (fields.dataStatus) {
        fields.dataStatus.textContent = dataStatusMessage
        fields.dataStatus.classList.toggle('hidden', !dataStatusMessage)
        fields.dataStatus.classList.toggle('warning', dataStatusTone === 'warning')
        fields.dataStatus.classList.toggle('error', dataStatusTone === 'error')
      }
    }

    function setDataStatus(message = '', tone = '') {
      dataStatusMessage = message
      dataStatusTone = tone
      renderDataSummary()
      renderOverview()
    }

    function doctorStatusText() {
      if (doctorState.repairRunning) return 'Réparation...'
      if (doctorState.status === 'running') return 'Diagnostic...'
      if (doctorState.error) return 'Erreur'
      const status = doctorState.report?.summary?.status
      if (status === 'error') return 'Bloquant'
      if (status === 'warning') return 'À surveiller'
      if (status === 'info') return 'Info'
      if (status === 'ok') return 'Sain'
      return 'Non lancé'
    }

    function doctorDetailText() {
      if (doctorState.repairRunning) return 'réparation provider + retest'
      if (doctorState.status === 'running') return 'analyse runtime en cours'
      if (doctorState.error) return doctorState.error
      if (doctorState.supportMessage) return doctorState.supportMessage
      const summary = doctorState.report?.summary
      if (!summary) return 'lancer un diagnostic'
      return `${summary.errors || 0} erreurs · ${summary.warnings || 0} alertes · ${summary.passed || 0} OK`
    }

    function doctorMetric(label, value, detail = '') {
      return helpers.metric(label, value, detail)
    }

    function selectedProviderDoctor() {
      return providerController?.providerDoctorSummary?.({
        model: state.settings?.model,
        requirements: { requireAgent: true, requireTools: true, minInputTokens: 8000 },
      }) || null
    }

    function providerDoctorStatusText(summary = null) {
      if (!summary) return 'Indisponible'
      if (summary.status === 'error') return 'À corriger'
      if (summary.status === 'warning') return 'À surveiller'
      return 'OK'
    }

    function renderDoctorSummary() {
      if (!fields.doctorSummary) return
      const summary = doctorState.report?.summary || {}
      const providerDoctor = selectedProviderDoctor()
      fields.doctorSummary.replaceChildren(
        doctorMetric('État', doctorStatusText(), doctorDetailText()),
        doctorMetric('Runtime', state.runtime?.pid ? `PID ${state.runtime.pid}` : 'Inactif', state.running ? 'tâche en cours' : 'aucune tâche active'),
        doctorMetric('Modèle', providerController?.modelLabel?.(state.settings?.model) || state.settings?.model || 'aucun', state.providerCheck?.ok ? 'testé OK' : helpers.checkLabel(state.providerCheck)),
        doctorMetric('Provider Doctor', providerDoctorStatusText(providerDoctor), providerDoctor?.fallback ? `fallback ${providerDoctor.fallback.label || providerDoctor.fallback.model}` : providerDoctor?.contextPolicy?.strategy || ''),
        doctorMetric('Contrôles', summary.total || 0, doctorState.report?.generatedAt ? new Date(doctorState.report.generatedAt).toLocaleTimeString() : 'jamais lancé'),
      )
    }

    function checkClass(status) {
      if (status === 'error') return 'error'
      if (status === 'warning') return 'warning'
      if (status === 'info') return 'info'
      return 'ok'
    }

    function renderDoctorReport() {
      if (!fields.doctorReport) return
      fields.doctorReport.replaceChildren()
      const providerDoctor = selectedProviderDoctor()
      if (doctorState.status === 'running') {
        const item = document.createElement('div')
        item.className = 'settingsDoctorEmpty'
        item.textContent = 'Diagnostic OPC en cours...'
        fields.doctorReport.appendChild(item)
        return
      }
      if (doctorState.error) {
        const item = document.createElement('div')
        item.className = 'settingsDoctorEmpty error'
        item.textContent = doctorState.error
        fields.doctorReport.appendChild(item)
        return
      }
      if (doctorState.supportMessage) {
        const item = document.createElement('div')
        item.className = 'settingsDoctorEmpty'
        item.textContent = doctorState.supportMessage
        fields.doctorReport.appendChild(item)
      }
      if (providerDoctor && (providerDoctor.issues?.length || providerDoctor.actions?.length)) {
        const item = document.createElement('article')
        item.className = `settingsDoctorCheck ${checkClass(providerDoctor.status)}`
        item.innerHTML = '<div><span></span><strong></strong></div><p></p><pre></pre>'
        item.querySelector('span').textContent = providerDoctor.status === 'error' ? 'Erreur' : providerDoctor.status === 'warning' ? 'Alerte' : 'Info'
        item.querySelector('strong').textContent = `Provider Doctor · ${providerDoctor.label}`
        item.querySelector('p').textContent = providerDoctor.detail || providerDoctor.contextPolicy?.strategy || ''
        item.querySelector('pre').textContent = JSON.stringify({
          issues: providerDoctor.issues?.map(issue => ({ code: issue.code, label: issue.label, detail: issue.detail })) || [],
          actions: providerDoctor.actions || [],
          fallback: providerDoctor.fallback ? { model: providerDoctor.fallback.model, label: providerDoctor.fallback.label } : null,
          contextPolicy: providerDoctor.contextPolicy,
        }, null, 2)
        fields.doctorReport.appendChild(item)
      }
      const checks = doctorState.report?.checks || []
      if (!checks.length) {
        if (doctorState.supportMessage || providerDoctor?.issues?.length || providerDoctor?.actions?.length) return
        const item = document.createElement('div')
        item.className = 'settingsDoctorEmpty'
        item.textContent = 'Lance le diagnostic pour vérifier CLI, provider, runtime, mémoire, git et installation.'
        fields.doctorReport.appendChild(item)
        return
      }
      for (const result of checks) {
        const item = document.createElement('article')
        item.className = `settingsDoctorCheck ${checkClass(result.status)}`
        item.innerHTML = '<div><span></span><strong></strong></div><p></p><pre class="hidden"></pre>'
        item.querySelector('span').textContent = result.status === 'ok' ? 'OK' : result.status === 'error' ? 'Erreur' : result.status === 'warning' ? 'Alerte' : 'Info'
        item.querySelector('strong').textContent = result.title || result.id
        item.querySelector('p').textContent = result.detail || ''
        const meta = result.meta && Object.keys(result.meta).length ? JSON.stringify(result.meta, null, 2) : ''
        const pre = item.querySelector('pre')
        if (meta) {
          pre.textContent = meta
          pre.classList.remove('hidden')
        }
        fields.doctorReport.appendChild(item)
      }
    }

    function renderDoctor() {
      renderDoctorSummary()
      renderDoctorReport()
      if (fields.runDoctor) fields.runDoctor.disabled = doctorState.status === 'running'
      if (fields.doctorRepairProviders) {
        fields.doctorRepairProviders.disabled = doctorState.status === 'running' || doctorState.repairRunning || providerController?.isCheckingAll?.()
        fields.doctorRepairProviders.textContent = doctorState.repairRunning ? 'Réparation...' : 'Réparer providers'
      }
      if (fields.copyDoctor) fields.copyDoctor.disabled = !doctorState.report && !doctorState.error
      if (fields.exportSupportBundle) {
        fields.exportSupportBundle.disabled = doctorState.supportExporting
        fields.exportSupportBundle.textContent = doctorState.supportExporting ? 'Export...' : 'Exporter bundle support'
      }
    }

    function renderSettings() {
      if (!root) return
      syncModelOptions(fields.model)
      syncRefineModelOptions(fields.refineModel)
      fields.cwd.value = state.settings.cwd || ''
      fields.model.value = state.settings.model || ''
      fields.refineModel.value = state.settings.refineModel || window.OPCPromptComposerController?.DEFAULT_REFINER_MODEL || 'qwen/qwen3.5-122b-a10b'
      fields.permission.value = state.settings.permissionMode || window.OPCStateRules?.DEFAULT_PERMISSION_MODE || 'acceptEdits'
      fields.memory.checked = state.settings.memoryEnabled !== false
      if (fields.providerAutoRouter) fields.providerAutoRouter.checked = Boolean(state.settings.providerAutoRouterEnabled)
      if (fields.providerAutoRouterThreshold) fields.providerAutoRouterThreshold.value = String(state.settings.providerAutoRouterThreshold || 2)
      if (fields.advancedPermissionStrict) fields.advancedPermissionStrict.checked = Boolean(state.settings.advancedPermissionStrictMode)
      fields.think.checked = false
      fields.think.disabled = true
      fields.think.title = 'Mode Think désactivé globalement.'
      fields.compact.checked = Boolean(state.settings.compactMode)
      fields.inspector.checked = Boolean(state.settings.inspectorOpen)
      if (fields.textSize) fields.textSize.value = state.settings.textSize || 'medium'
      providerPanel.render()
      renderEnvironment()
      renderProjectSummary()
      renderDataSummary()
      renderDoctor()
      applySearchFilter()
    }

    function commitGeneral() {
      applySettingsPatch(helpers.normalizeSettingsPatch({
        cwd: fields.cwd.value,
        model: fields.model.value,
        refineModel: fields.refineModel.value,
        permissionMode: fields.permission.value,
        memoryEnabled: fields.memory.checked,
        providerAutoRouterEnabled: Boolean(fields.providerAutoRouter?.checked),
        providerAutoRouterThreshold: fields.providerAutoRouterThreshold?.value || state.settings.providerAutoRouterThreshold || 2,
        advancedPermissionStrictMode: Boolean(fields.advancedPermissionStrict?.checked),
        thinkEnabled: false,
      }, state.settings))
      renderSettings()
    }

    function commitInterface() {
      applySettingsPatch(helpers.normalizeSettingsPatch({
        compactMode: fields.compact.checked,
        inspectorOpen: fields.inspector.checked,
        textSize: fields.textSize?.value || 'medium',
      }, state.settings), { persistRuntime: false })
      applyUiSettings()
      renderSettings()
    }

    function wireGeneral() {
      els.settingsToggle?.addEventListener('click', open)
      fields.close?.addEventListener('click', close)
      root.addEventListener('click', event => {
        if (event.target === root) close()
      })
      window.addEventListener('keydown', event => {
        if (event.key === 'Escape' && !root.classList.contains('hidden')) close()
      })
      for (const button of qa('[data-settings-tab]')) {
        button.addEventListener('click', () => selectTab(button.dataset.settingsTab))
      }
      fields.search?.addEventListener('input', () => {
        searchQuery = fields.search.value
        applySearchFilter()
      })
      fields.search?.addEventListener('keydown', event => {
        if (event.key === 'Escape' && fields.search.value) {
          event.stopPropagation()
          fields.search.value = ''
          searchQuery = ''
          applySearchFilter()
        }
      })
      window.addEventListener('keydown', event => {
        const target = event.target
        const isEditing = target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
        if (event.key === '/' && !event.metaKey && !event.ctrlKey && !event.altKey && !root.classList.contains('hidden') && !isEditing) {
          event.preventDefault()
          fields.search?.focus()
        }
      })
      for (const field of [fields.cwd, fields.model, fields.refineModel, fields.permission, fields.memory, fields.providerAutoRouter, fields.providerAutoRouterThreshold, fields.advancedPermissionStrict, fields.think]) {
        field?.addEventListener('change', commitGeneral)
      }
      fields.applyGeneral?.addEventListener('click', commitGeneral)
      fields.openFolder?.addEventListener('click', () => actions.openPath?.(state.settings.cwd))
    }

    function wireProjectAndData() {
      fields.applyProjectRuntime?.addEventListener('click', () => {
        actions.applyProjectRuntime?.(projectController?.activeProject?.()?.id || '')
        renderSettings()
      })
      fields.saveProjectRuntime?.addEventListener('click', () => {
        actions.saveProjectRuntime?.(projectController?.activeProject?.()?.id || '')
        renderSettings()
      })
      fields.newProject?.addEventListener('click', () => {
        actions.createProject?.()
        render()
        renderSettings()
      })
      fields.newChat?.addEventListener('click', () => {
        chatController?.createChat?.()
        render()
        renderSettings()
      })
      fields.clearHistory?.addEventListener('click', () => {
        chatController?.clearHistory?.()
        render()
        renderSettings()
      })
      fields.exportProject?.addEventListener('click', () => {
        const project = projectController?.activeProject?.()
        if (project) actions.exportProject?.(project.id)
      })
      fields.importProject?.addEventListener('click', async () => {
        await actions.importProject?.()
        render()
        renderSettings()
      })
      fields.exportStateBackup?.addEventListener('click', async () => {
        if (!opc?.exportStateBackup) {
          setDataStatus('Export sauvegarde indisponible.', 'error')
          return
        }
        try {
          const result = await opc.exportStateBackup({ state: store.serializedState?.() || {} })
          if (!result?.ok) throw new Error(result?.error || 'Export sauvegarde impossible.')
          setDataStatus(result.canceled ? 'Export sauvegarde annulé.' : `Sauvegarde exportée: ${result.path || 'fichier enregistré'}`, '')
        } catch (error) {
          setDataStatus(error.message || String(error), 'error')
        }
      })
      fields.importStateBackup?.addEventListener('click', async () => {
        if (!opc?.importStateBackup) {
          setDataStatus('Import sauvegarde indisponible.', 'error')
          return
        }
        try {
          const result = await opc.importStateBackup()
          if (!result?.ok) throw new Error(result?.error || 'Import sauvegarde impossible.')
          if (result.canceled) {
            setDataStatus('Import sauvegarde annulé.', '')
            return
          }
          const loaded = store.loadFromPayload?.(result.state || {})
          store.save?.()
          render()
          renderSettings()
          setDataStatus(loaded ? `Sauvegarde importée: ${result.path || 'fichier chargé'}` : 'Sauvegarde importée sans données utilisables.', loaded ? '' : 'warning')
        } catch (error) {
          setDataStatus(error.message || String(error), 'error')
        }
      })
    }

    function wireInterface() {
      for (const field of [fields.compact, fields.inspector, fields.textSize]) {
        field?.addEventListener('change', commitInterface)
      }
      fields.applyInterface?.addEventListener('click', commitInterface)
    }

    async function runDoctor() {
      if (!opc?.doctor || doctorState.status === 'running') return
      doctorState.status = 'running'
      doctorState.error = ''
      doctorState.supportMessage = ''
      renderDoctor()
      renderOverview()
      try {
        const report = await opc.doctor({
          cwd: state.settings?.cwd || '',
          model: state.settings?.model || '',
        })
        if (!report?.ok) throw new Error(report?.error || 'Diagnostic OPC indisponible.')
        doctorState.status = 'done'
        doctorState.report = report
      } catch (error) {
        doctorState.status = 'error'
        doctorState.error = error.message || String(error)
        doctorState.report = null
      }
      renderDoctor()
      renderOverview()
    }

    async function copyDoctorReport() {
      const text = doctorState.report
        ? JSON.stringify(doctorState.report, null, 2)
        : doctorState.error
      if (!text) return
      await actions.copyText?.(text)
    }

    async function repairProvidersFromDoctor() {
      const repairAction = providerController?.repairAndCheckProblemProviders || providerController?.repairAndCheckAllProviders
      if (!repairAction || doctorState.repairRunning) return
      doctorState.repairRunning = true
      doctorState.error = ''
      doctorState.supportMessage = ''
      renderDoctor()
      renderOverview()
      try {
        await repairAction({ force: true })
        await providerPanel.refresh()
        await runDoctor()
      } catch (error) {
        doctorState.status = 'error'
        doctorState.error = error.message || String(error)
        doctorState.report = null
      } finally {
        doctorState.repairRunning = false
        renderDoctor()
        renderOverview()
      }
    }

    async function exportSupportBundle() {
      if (!opc?.exportSupportBundle || doctorState.supportExporting) return
      doctorState.supportExporting = true
      doctorState.error = ''
      doctorState.supportMessage = ''
      renderDoctor()
      renderOverview()
      try {
        const result = await opc.exportSupportBundle({
          cwd: state.settings?.cwd || '',
          model: state.settings?.model || '',
          report: doctorState.report || null,
        })
        if (!result?.ok) throw new Error(result?.error || 'Export support indisponible.')
        doctorState.supportMessage = result.canceled ? 'Export support annulé.' : `Bundle support exporté: ${result.path || 'fichier enregistré'}`
      } catch (error) {
        doctorState.error = error.message || String(error)
      } finally {
        doctorState.supportExporting = false
        renderDoctor()
        renderOverview()
      }
    }

    function wireDoctor() {
      fields.runDoctor?.addEventListener('click', runDoctor)
      fields.doctorRepairProviders?.addEventListener('click', repairProvidersFromDoctor)
      fields.copyDoctor?.addEventListener('click', copyDoctorReport)
      fields.exportSupportBundle?.addEventListener('click', exportSupportBundle)
      fields.environmentDoctor?.addEventListener('click', async () => {
        selectTab('doctor', { refresh: false })
        await runDoctor()
      })
      fields.environmentRepair?.addEventListener('click', repairProvidersFromDoctor)
      fields.environmentRefresh?.addEventListener('click', async () => {
        await providerController?.refreshHealth?.()
        await providerPanel.refresh()
        renderSettings()
      })
    }

    function wire() {
      if (!root) return
      wireGeneral()
      wireProjectAndData()
      wireInterface()
      wireDoctor()
    }

    wire()

    return {
      close,
      open,
      render: renderSettings,
      selectTab,
    }
  }

  window.OPCSettingsController = {
    activeProjectSummary: helpers.activeProjectSummary,
    checkLabel: helpers.checkLabel,
    createSettingsController,
    normalizeProviderEditorPayload: helpers.normalizeProviderEditorPayload,
    normalizeSettingsSearch: helpers.normalizeSettingsSearch,
    normalizeSettingsPatch: helpers.normalizeSettingsPatch,
    settingsSearchMatches: helpers.settingsSearchMatches,
    settingsSearchTokens: helpers.settingsSearchTokens,
    settingsCounts: helpers.settingsCounts,
  }
})()
