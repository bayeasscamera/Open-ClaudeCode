const SELECTED_TEXT_SCRIPT = `
(() => {
  const active = document.activeElement
  if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {
    const start = active.selectionStart ?? 0
    const end = active.selectionEnd ?? 0
    return end > start ? active.value.slice(start, end) : ''
  }
  const selected = window.getSelection ? window.getSelection().toString() : ''
  return selected.trim() ? selected : (window.__opcLastSelectedReportText || '')
})()
`

function createSelectionController({ clipboard, log, getMainWindow }) {
  async function copySelectionFromWindow(targetWindow = getMainWindow()) {
    if (!targetWindow || targetWindow.isDestroyed()) return false
    try {
      const selectedText = await targetWindow.webContents.executeJavaScript(SELECTED_TEXT_SCRIPT, true)
      if (String(selectedText || '').trim()) {
        clipboard.writeText(String(selectedText))
        return true
      }
    } catch (error) {
      log(`Selection copy failed: ${error.message}`)
    }
    targetWindow.webContents.copy()
    return false
  }

  function attachToWindow(targetWindow, Menu) {
    targetWindow.webContents.on('context-menu', (_event, params) => {
      const template = []
      if (params.selectionText?.trim()) {
        template.push({ label: 'Copier la sélection', click: () => copySelectionFromWindow(targetWindow) })
      }
      if (params.isEditable) {
        template.push(
          { label: 'Couper', role: 'cut' },
          { label: 'Copier', click: () => copySelectionFromWindow(targetWindow) },
          { label: 'Coller', role: 'paste' },
        )
      }
      if (!template.length) return
      Menu.buildFromTemplate(template).popup({ window: targetWindow })
    })
    targetWindow.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown' || input.key?.toLowerCase() !== 'c' || !(input.meta || input.control)) return
      event.preventDefault()
      copySelectionFromWindow(targetWindow)
    })
  }

  function installApplicationMenu(Menu) {
    const template = [
      {
        label: 'OPC',
        submenu: [
          { role: 'about', label: 'À propos de OPC' },
          { type: 'separator' },
          { role: 'hide', label: 'Masquer OPC' },
          { role: 'hideOthers', label: 'Masquer les autres' },
          { role: 'unhide', label: 'Tout afficher' },
          { type: 'separator' },
          { role: 'quit', label: 'Quitter OPC' },
        ],
      },
      {
        label: 'Édition',
        submenu: [
          { role: 'undo', label: 'Annuler' },
          { role: 'redo', label: 'Rétablir' },
          { type: 'separator' },
          { role: 'cut', label: 'Couper' },
          {
            label: 'Copier',
            accelerator: 'CmdOrCtrl+C',
            click: (_menuItem, focusedWindow) => copySelectionFromWindow(focusedWindow || getMainWindow()),
          },
          { role: 'paste', label: 'Coller' },
          { role: 'selectAll', label: 'Tout sélectionner' },
        ],
      },
      {
        label: 'Affichage',
        submenu: [
          { role: 'reload', label: 'Recharger' },
          { role: 'toggleDevTools', label: 'Outils développeur' },
          { type: 'separator' },
          { role: 'resetZoom', label: 'Taille réelle' },
          { role: 'zoomIn', label: 'Zoom avant' },
          { role: 'zoomOut', label: 'Zoom arrière' },
          { type: 'separator' },
          { role: 'togglefullscreen', label: 'Plein écran' },
        ],
      },
      {
        label: 'Fenêtre',
        submenu: [
          { role: 'minimize', label: 'Réduire' },
          { role: 'zoom', label: 'Agrandir' },
          { type: 'separator' },
          { role: 'front', label: 'Tout ramener au premier plan' },
        ],
      },
    ]
    Menu.setApplicationMenu(Menu.buildFromTemplate(template))
  }

  return {
    attachToWindow,
    copySelectionFromWindow,
    installApplicationMenu,
  }
}

module.exports = { SELECTED_TEXT_SCRIPT, createSelectionController }
