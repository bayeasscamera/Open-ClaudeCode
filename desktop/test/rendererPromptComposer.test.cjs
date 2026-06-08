const { assert, loadRendererModules, test } = require('./helpers/rendererModules.cjs')

function classList() {
  const values = new Set()
  return {
    add: value => values.add(value),
    remove: value => values.delete(value),
    toggle: (value, force) => {
      if (force === undefined) {
        if (values.has(value)) values.delete(value)
        else values.add(value)
        return values.has(value)
      }
      if (force) values.add(value)
      else values.delete(value)
      return Boolean(force)
    },
    contains: value => values.has(value),
  }
}

function button() {
  const listeners = {}
  return {
    classList: classList(),
    disabled: false,
    textContent: '',
    title: '',
    addEventListener: (event, handler) => {
      listeners[event] = handler
    },
    click: () => listeners.click?.({}),
  }
}

function promptInput(value = '') {
  const listeners = {}
  return {
    classList: classList(),
    style: {},
    scrollHeight: 52,
    value,
    focused: false,
    addEventListener: (event, handler) => {
      listeners[event] = handler
    },
    focus() {
      this.focused = true
    },
    trigger(event, payload = {}) {
      return listeners[event]?.(payload)
    },
  }
}

function statusElement() {
  return {
    classList: classList(),
    dataset: {},
    textContent: '',
  }
}

function composerEls(promptValue = '') {
  const refineUndo = button()
  refineUndo.classList.add('hidden')
  return {
    prompt: promptInput(promptValue),
    send: button(),
    refine: button(),
    refineUndo,
    rescue: button(),
    composerStatus: statusElement(),
  }
}

test('prompt composer uses the configured refine model and keeps undo local', async () => {
  const { OPCPromptComposerController } = loadRendererModules()
  const els = composerEls(' analyse ce repo ')
  const logs = []
  let payload = null
  const controller = OPCPromptComposerController.createPromptComposerController({
    els,
    state: { settings: { refineModel: 'custom/refiner' } },
    opc: {
      refinePrompt: async value => {
        payload = value
        return { ok: true, text: 'Analyse ce dépôt avec un plan vérifiable.', model: value.model, latencyMs: 14 }
      },
    },
    runController: { sendPrompt: () => {} },
    appendLog: line => logs.push(line),
  })

  await controller.refinePromptDraft()

  assert.equal(payload.model, 'custom/refiner')
  assert.equal(els.prompt.value, 'Analyse ce dépôt avec un plan vérifiable.')
  assert.equal(els.refineUndo.classList.contains('hidden'), false)
  assert.equal(els.composerStatus.dataset.tone, 'done')
  assert.match(logs.at(-1), /RAFFINE custom\/refiner/)

  controller.undoRefinedPrompt()
  assert.equal(els.prompt.value, ' analyse ce repo ')
  assert.equal(els.refineUndo.classList.contains('hidden'), true)
})

test('prompt composer sends only on explicit submit and supports rescue prefix', () => {
  const { OPCPromptComposerController } = loadRendererModules()
  const els = composerEls('diagnostic profond')
  let sent = 0
  const controller = OPCPromptComposerController.createPromptComposerController({
    els,
    state: { settings: {} },
    opc: {},
    runController: { sendPrompt: () => { sent += 1 } },
  })

  controller.wire()
  els.rescue.click()
  assert.equal(els.prompt.value, '/opc:rescue diagnostic profond')
  assert.equal(sent, 0)

  els.send.click()
  assert.equal(sent, 1)
})
