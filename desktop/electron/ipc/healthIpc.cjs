function registerHealthIpc({
  cliRunner,
  handle,
  memoryStore,
  projectRoot,
  providerConfigStore,
  startProviderBridge,
}) {
  handle('opc:health', async () => {
    const providerBridge = await startProviderBridge()
    const cliVersion = cliRunner.version()
    const providerConfig = providerConfigStore.reload()
    return {
      ok: cliVersion.ok,
      node: cliVersion.node,
      cli: cliVersion.cli,
      projectRoot: projectRoot(),
      version: cliVersion.version,
      error: cliVersion.error,
      provider: {
        baseUrl: providerConfig.baseUrl,
        bridgeUrl: `http://127.0.0.1:${providerBridge.port}`,
        configError: providerConfigStore.loadError?.() || '',
        defaultModel: providerConfig.defaultModel,
        profiles: providerConfigStore.profiles(),
      },
      memory: memoryStore.info(),
      runtime: cliRunner.runtimeStatus(),
    }
  })
}

module.exports = { registerHealthIpc }
