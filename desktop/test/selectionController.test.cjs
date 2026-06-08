const assert = require('node:assert/strict')
const test = require('node:test')
const { createSelectionController } = require('../electron/selectionController.cjs')

function createWindow(selectedText = '') {
  const listeners = {}
  let fallbackCopied = false
  return {
    listeners,
    isDestroyed: () => false,
    fallbackCopied: () => fallbackCopied,
    webContents: {
      executeJavaScript: async () => selectedText,
      copy: () => {
        fallbackCopied = true
      },
      on: (event, handler) => {
        listeners[event] = handler
      },
    },
  }
}

test('selection controller copies selected report text before falling back', async () => {
  const writes = []
  const targetWindow = createWindow('texte sélectionné')
  const controller = createSelectionController({
    clipboard: { writeText: text => writes.push(text) },
    log: () => {},
    getMainWindow: () => targetWindow,
  })

  assert.equal(await controller.copySelectionFromWindow(), true)
  assert.deepEqual(writes, ['texte sélectionné'])
  assert.equal(targetWindow.fallbackCopied(), false)
})

test('selection controller falls back to native copy when no text is selected', async () => {
  const targetWindow = createWindow('')
  const controller = createSelectionController({
    clipboard: { writeText: () => {} },
    log: () => {},
    getMainWindow: () => targetWindow,
  })

  assert.equal(await controller.copySelectionFromWindow(), false)
  assert.equal(targetWindow.fallbackCopied(), true)
})

test('selection controller wires context menu and keyboard copy', () => {
  const targetWindow = createWindow('abc')
  let popupOpened = false
  const controller = createSelectionController({
    clipboard: { writeText: () => {} },
    log: () => {},
    getMainWindow: () => targetWindow,
  })
  const Menu = {
    buildFromTemplate: template => {
      assert.equal(template.some(item => item.label === 'Copier la sélection'), true)
      return { popup: () => { popupOpened = true } }
    },
  }

  controller.attachToWindow(targetWindow, Menu)
  targetWindow.listeners['context-menu'](null, { selectionText: 'abc', isEditable: false })
  assert.equal(popupOpened, true)

  let prevented = false
  targetWindow.listeners['before-input-event']({ preventDefault: () => { prevented = true } }, { type: 'keyDown', key: 'c', meta: true })
  assert.equal(prevented, true)
})
