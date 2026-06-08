function installApplicationLifecycle({
  app,
  BrowserWindow,
  createWindow,
  startProviderBridge,
  closeProviderBridge,
  unregisterIpcHandlers,
  destroyWindowSafely,
  cliRunner,
  installApplicationMenu,
  log,
  platform = process.platform,
  setTimeoutFn = setTimeout,
}) {
  let quitAfterRunStops = false
  let finalQuitStarted = false

  function quitAfterActiveRun() {
    if (finalQuitStarted) return
    finalQuitStarted = true
    closeProviderBridge()
    app.quit()
  }

  app.whenReady().then(() => {
    installApplicationMenu()
    startProviderBridge().catch(error => log(`Provider bridge failed: ${error.message}`))
    createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('before-quit', event => {
    if (finalQuitStarted) {
      try { destroyWindowSafely?.(BrowserWindow.getAllWindows()?.[0]) } catch {}
      closeProviderBridge()
      return
    }
    if (cliRunner.hasActiveRun() && !quitAfterRunStops) {
      event.preventDefault()
      quitAfterRunStops = true
      const child = cliRunner.activeChild()
      if (child) child.once('close', quitAfterActiveRun)
      cliRunner.stop()
      setTimeoutFn(quitAfterActiveRun, 2500)
      return
    }
    try { unregisterIpcHandlers?.() } catch {}
    try { destroyWindowSafely?.(BrowserWindow.getAllWindows()?.[0]) } catch {}
    closeProviderBridge()
  })

  app.on('window-all-closed', () => {
    if (platform !== 'darwin') app.quit()
  })

  return { quitAfterActiveRun }
}

module.exports = { installApplicationLifecycle }
