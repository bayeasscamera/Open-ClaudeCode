(function () {
  function createOpcClient(opc = window.opc || {}) {
    return {
      checkProvider: payload => opc.checkProvider?.(payload),
      cleanupRuntime: () => opc.cleanupRuntime?.(),
      copyText: value => opc.copyText?.(value),
      deleteProviderProfile: payload => opc.deleteProviderProfile?.(payload),
      discoverProviderModels: payload => opc.discoverProviderModels?.(payload),
      doctor: payload => opc.doctor?.(payload),
      exportProject: payload => opc.exportProject?.(payload),
      exportProviderConfig: () => opc.exportProviderConfig?.(),
      exportSupportBundle: payload => opc.exportSupportBundle?.(payload),
      health: () => opc.health?.(),
      importProject: () => opc.importProject?.(),
      importProviderConfig: payload => opc.importProviderConfig?.(payload),
      killPid: payload => opc.killPid?.(payload),
      loadState: () => opc.loadState?.(),
      onEvent: callback => opc.onEvent?.(callback) || (() => {}),
      onRunEnd: callback => opc.onRunEnd?.(callback) || (() => {}),
      onRunStart: callback => opc.onRunStart?.(callback) || (() => {}),
      onRuntime: callback => opc.onRuntime?.(callback) || (() => {}),
      openPath: targetPath => opc.openPath?.(targetPath),
      probeServices: payload => opc.probeServices?.(payload),
      providerConfig: () => opc.providerConfig?.(),
      quarantineProviders: payload => opc.quarantineProviders?.(payload),
      readClipboard: () => opc.readClipboard?.(),
      readProjectFile: payload => opc.readProjectFile?.(payload),
      refinePrompt: payload => opc.refinePrompt?.(payload),
      repairProviderConfig: () => opc.repairProviderConfig?.(),
      restoreProviders: payload => opc.restoreProviders?.(payload),
      run: payload => opc.run?.(payload),
      saveProviderProfile: payload => opc.saveProviderProfile?.(payload),
      saveState: value => opc.saveState?.(value),
      selectProjectFiles: () => opc.selectProjectFiles?.(),
      selectProjectFolder: () => opc.selectProjectFolder?.(),
      setDefaultProvider: payload => opc.setDefaultProvider?.(payload),
      stop: () => opc.stop?.(),
    }
  }

  window.OPCOpcClient = { createOpcClient }
})()
