/**
 * sendChannel.cjs
 *
 * Bridge function extracted from main.cjs so it can be unit-tested without
 * spinning up the full Electron main process. Given a `getMainWindow`
 * accessor (which may return null while the window is being created or
 * after it has been closed), it returns a `send(channel, payload)` helper
 * that is a no-op in every unsafe case.
 *
 * M1 (Sprint 4): a destroyed `webContents` (renderer torn down after a
 * crash) would throw synchronously on `send` and pollute the main-process
 * logs. We guard against:
 *   - mainWindow === null                 (not created yet, or closed)
 *   - mainWindow.isDestroyed() === true   (window closed)
 *   - webContents === null                (defensive: should not happen)
 *   - webContents.isDestroyed() === true  (renderer gone, window alive)
 *   - exceptions thrown by send()         (we log and swallow)
 *
 * `log` is optional; when provided, any swallowed exception is recorded so
 * it can be diagnosed from the main-process log file.
 */

function createSendChannel({ getMainWindow, log = null } = {}) {
  if (typeof getMainWindow !== 'function') {
    throw new TypeError('createSendChannel requires a getMainWindow function')
  }

  return function send(channel, payload) {
    const mainWindow = getMainWindow()
    if (!mainWindow || mainWindow.isDestroyed?.()) return
    const webContents = mainWindow.webContents
    if (!webContents || webContents.isDestroyed?.()) return
    try {
      webContents.send(channel, payload)
    } catch (err) {
      // Never let a stray IPC throw escape into the main process - the
      // window is in the middle of being torn down and there is no
      // recoverable action for the caller.
      if (log) {
        try { log('send(' + channel + ') swallowed: ' + (err && err.message || err)) } catch { /* ignore */ }
      }
    }
  }
}

module.exports = { createSendChannel }
