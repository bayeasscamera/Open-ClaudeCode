function sandboxSwitchDecision({ disableSandboxEnv = '', isPackaged = false } = {}) {
  if (disableSandboxEnv !== '1') {
    return { appendNoSandbox: false, warning: '' }
  }
  if (isPackaged) {
    return {
      appendNoSandbox: false,
      warning: 'OPC_DISABLE_ELECTRON_SANDBOX ignored for packaged builds.',
    }
  }
  return { appendNoSandbox: true, warning: '' }
}

module.exports = {
  sandboxSwitchDecision,
}
