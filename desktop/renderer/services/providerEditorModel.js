(function () {
  const DEFAULT_CAPABILITIES = {
    agent: true,
    system: true,
    streaming: true,
    tools: true,
    toolChoice: true,
    temperature: true,
    thinking: false,
    refine: true,
    reasoningPassThrough: false,
    reasoningExclude: false,
  }

  function editorValuesForProfile(profile = {}, { baseUrl = '', defaultModel = '' } = {}) {
    const caps = { ...DEFAULT_CAPABILITIES, ...(profile.capabilities || {}) }
    return {
      editingProviderId: profile.id || '',
      editingProviderModel: profile.model || '',
      title: profile.model ? `Modifier ${profile.label || profile.model}` : 'Nouveau provider',
      label: profile.label || '',
      model: profile.model || '',
      providerName: profile.providerName || profile.provider || '',
      baseUrl: profile.baseUrl || baseUrl || '',
      upstreamApi: String(profile.providerName || profile.provider || '').toLowerCase() === 'ollama'
        ? 'ollama'
        : profile.upstreamApi || 'openai',
      transport: profile.transport || 'stream',
      timeoutMs: profile.timeoutMs || 300000,
      checkTimeoutMs: profile.checkTimeoutMs || 60000,
      retries: profile.retries || 0,
      maxTokens: profile.maxTokens || 4096,
      apiKeyPlaceholder: profile.apiKeySet ? `clé existante ${profile.apiKeyPreview || 'conservée'}` : 'coller une clé si nécessaire',
      noAuth: Boolean(profile.noAuth),
      makeDefault: Boolean(profile.model && profile.model === defaultModel),
      capabilities: caps,
      systemPrefix: profile.systemPrefix || '',
      extraBodyText: profile.extraBody && Object.keys(profile.extraBody).length ? JSON.stringify(profile.extraBody, null, 2) : '',
      canDelete: Boolean(profile.model),
    }
  }

  function buildProviderEditorPayload(values = {}, normalize = value => value) {
    return normalize({
      id: values.id,
      label: values.label,
      model: values.model,
      providerName: values.providerName,
      baseUrl: values.baseUrl,
      upstreamApi: values.upstreamApi,
      transport: values.transport,
      timeoutMs: values.timeoutMs,
      checkTimeoutMs: values.checkTimeoutMs,
      retries: values.retries,
      maxTokens: values.maxTokens,
      apiKey: values.apiKey,
      noAuth: Boolean(values.noAuth),
      makeDefault: Boolean(values.makeDefault),
      capabilities: values.capabilities || {},
      systemPrefix: values.systemPrefix,
      extraBody: values.extraBody,
    })
  }

  window.OPCProviderEditorModel = {
    DEFAULT_CAPABILITIES,
    buildProviderEditorPayload,
    editorValuesForProfile,
  }
})()
