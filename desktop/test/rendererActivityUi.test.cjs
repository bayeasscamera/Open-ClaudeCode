const { assert, createStorage, loadRendererModules, test } = require('./helpers/rendererModules.cjs')

function createFakeDom() {
  function createNode(tagName) {
    const node = {
      tagName: String(tagName || '').toLowerCase(),
      nodeType: 1,
      childNodes: [],
      children: [],
      dataset: {},
      style: {},
      attributes: {},
      className: '',
      _textContent: '',
      set textContent(value) {
        this._textContent = String(value || '')
        this.childNodes = []
        this.children = []
      },
      get textContent() {
        return this._textContent + this.childNodes.map(child => child.textContent || '').join('')
      },
      set innerHTML(value) {
        this._innerHTML = String(value || '')
        this.childNodes = []
        this.children = []
        this._textContent = ''
      },
      get innerHTML() {
        return this._innerHTML || ''
      },
      appendChild(child) {
        this.childNodes.push(child)
        if (child.nodeType === 1) this.children.push(child)
        return child
      },
      append(...nodes) {
        for (const child of nodes) this.appendChild(child)
      },
      addEventListener() {},
      querySelector(selector) {
        const matches = child => {
          if (selector.startsWith('.')) {
            return String(child.className || '').split(/\s+/).includes(selector.slice(1))
          }
          return child.tagName === selector.toLowerCase()
        }
        const visit = nodeToVisit => {
          for (const child of nodeToVisit.childNodes || []) {
            if (child.nodeType === 1 && matches(child)) return child
            const nested = child.nodeType === 1 ? visit(child) : null
            if (nested) return nested
          }
          return null
        }
        return visit(this)
      },
    }
    node.classList = {
      contains: name => String(node.className || '').split(/\s+/).includes(name),
      toggle: (name, force) => {
        const classes = new Set(String(node.className || '').split(/\s+/).filter(Boolean))
        const shouldAdd = force === undefined ? !classes.has(name) : Boolean(force)
        if (shouldAdd) classes.add(name)
        else classes.delete(name)
        node.className = Array.from(classes).join(' ')
        return shouldAdd
      },
    }
    return node
  }

  return {
    createElement: createNode,
    createTextNode: value => ({ nodeType: 3, textContent: String(value || '') }),
  }
}

test('renderer activity extracts current tool target from streaming deltas', () => {
  const { OPCActivity } = loadRendererModules()
  const assistant = { tools: [], cwd: '/Users/example/project' }
  OPCActivity.recordToolActivity(assistant, {
    type: 'stream_event',
    event: {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'tool_use', id: 'tool_1', name: 'Bash', input: {} },
    },
  })
  OPCActivity.recordToolPartial(assistant, {
    type: 'stream_event',
    event: {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'input_json_delta', partial_json: '{"command":"ls -la /Users/example/project"}' },
    },
  })
  assert.equal(assistant.tools.length, 1)
  assert.equal(assistant.tools[0].name, 'Bash')
  assert.match(assistant.tools[0].command, /ls -la/)
  assert.match(assistant.focus, /ls -la/)
  assert.equal(assistant.tools[0].kind, 'shell')
  assert.match(assistant.tools[0].code, /ls -la/)
  assert.match(
    OPCActivity.toolResultText({
      type: 'user',
      message: { content: [{ type: 'tool_result', content: 'PID 4321\nLocal: http://localhost:18000' }] },
    }),
    /PID 4321/,
  )
})

test('renderer activity expands edit tool details', () => {
  const { OPCActivity } = loadRendererModules()
  const descriptor = OPCActivity.toolDescriptor({
    id: 'edit-1',
    name: 'Edit',
    input: {
      file_path: '/Users/example/project/src/app.js',
      old_string: 'const value = 1',
      new_string: 'const value = 2',
    },
  }, '/Users/example/project')

  assert.equal(descriptor.kind, 'edit')
  assert.equal(descriptor.target, './src/app.js')
  assert.match(descriptor.detail, /1 changement/)
  assert.equal(JSON.stringify(descriptor.fields.map(field => field.label)), JSON.stringify(['Fichier', 'Avant', 'Après']))
  assert.match(descriptor.fields.find(field => field.label === 'Après').value, /value = 2/)
})

test('renderer activity describes web search and fetch tools', () => {
  const { OPCActivity } = loadRendererModules()
  const search = OPCActivity.toolDescriptor({
    id: 'web-search-1',
    name: 'WebSearch',
    input: { query: 'OPC desktop CLI web tools', allowed_domains: ['docs.example.com'] },
  })
  const fetch = OPCActivity.toolDescriptor({
    id: 'web-fetch-1',
    name: 'WebFetch',
    input: { url: 'https://example.com/docs', prompt: 'Résume la page' },
  })

  assert.equal(search.kind, 'web')
  assert.equal(search.title, 'Web Search')
  assert.match(search.detail, /Recherche web/)
  assert.equal(search.fields.find(field => field.label === 'Domaines autorisés').value, 'docs.example.com')
  assert.equal(fetch.kind, 'web')
  assert.equal(fetch.title, 'Web Fetch')
  assert.match(fetch.detail, /Lecture web/)
  assert.match(fetch.fields.find(field => field.label === 'Prompt').value, /Résume/)
})

test('renderer render scheduler coalesces and throttles message renders', () => {
  const { OPCRenderScheduler } = loadRendererModules()
  const timers = []
  const frames = []
  let now = 100
  let count = 0
  const scheduler = OPCRenderScheduler.createRenderScheduler({
    win: {},
    now: () => now,
    requestFrame: callback => frames.push(callback),
    setTimer: (callback, ms) => timers.push({ callback, ms }),
    minIntervalMs: 50,
  })

  assert.equal(scheduler.schedule(() => { count += 1 }), true)
  assert.equal(scheduler.schedule(() => { count += 1 }), false)
  assert.equal(frames.length, 1)
  frames.shift()()
  assert.equal(count, 1)

  now = 120
  assert.equal(scheduler.schedule(() => { count += 1 }), true)
  assert.equal(timers[0].ms, 30)
  timers.shift().callback()
  frames.shift()()
  assert.equal(count, 2)
})

test('renderer render scheduler waits while report text is being selected', () => {
  const { OPCRenderScheduler } = loadRendererModules()
  const timers = []
  const frames = []
  let now = 1000
  let count = 0
  const win = {
    __opcReportSelectionHoldUntil: 0,
    __opcIsReportSelectionActive: () => true,
  }
  const scheduler = OPCRenderScheduler.createRenderScheduler({
    win,
    now: () => now,
    requestFrame: callback => frames.push(callback),
    setTimer: (callback, ms) => timers.push({ callback, ms }),
  })

  assert.equal(scheduler.schedule(() => { count += 1 }), true)
  assert.equal(frames.length, 0)
  assert.equal(timers[0].ms, 1200)
  assert.equal(win.__opcReportSelectionHoldUntil, 2400)

  win.__opcIsReportSelectionActive = () => false
  now = 2200
  timers.shift().callback()
  assert.equal(frames.length, 0)
  assert.equal(timers[0].ms, 240)

  now = 2440
  timers.shift().callback()
  frames.shift()()
  assert.equal(count, 1)
})

test('renderer log buffer truncates, caps and coalesces DOM writes', () => {
  const { OPCLogBuffer } = loadRendererModules()
  const frames = []
  const element = { textContent: '', scrollHeight: 200, scrollTop: 0 }
  const buffer = OPCLogBuffer.createLogBuffer({
    element,
    requestFrame: callback => frames.push(callback),
    maxLines: 2,
    maxLineChars: 8,
  })

  buffer.append('alpha')
  buffer.append('bravo')
  buffer.append('charlie-long')
  assert.equal(frames.length, 1)
  assert.equal(JSON.stringify(buffer.lines()), JSON.stringify(['bravo', 'charl...']))

  frames.shift()()
  assert.equal(element.textContent, 'bravo\ncharl...')
  assert.equal(element.scrollTop, 200)

  buffer.clear()
  assert.equal(element.textContent, '')
  assert.equal(element.scrollTop, 0)
  assert.equal(JSON.stringify(buffer.lines()), JSON.stringify([]))

  const redacted = OPCLogBuffer.redactSecrets('token nvapi-secretSECRET1234567890')
  assert.equal(redacted.includes('nvapi-secret'), false)
  assert.match(redacted, /\[REDACTED\]/)
})

test('renderer render controller preserves manual message scroll position', () => {
  const { OPCRenderController } = loadRendererModules()
  let scrollHandler = null
  const messagesEl = {
    scrollHeight: 1000,
    scrollTop: 800,
    clientHeight: 200,
    lastElementChild: null,
    addEventListener: (name, handler) => {
      if (name === 'scroll') scrollHandler = handler
    },
    replaceChildren: () => {},
    appendChild: () => {},
  }
  const chat = { id: 'chat-1', messages: [] }
  const renderer = OPCRenderController.createRenderController({
    els: { messages: messagesEl },
    state: {},
    markdown: {},
    chatController: { activeChat: () => chat },
    providerController: {},
    runController: {},
    serviceController: {},
    actions: {},
  })

  renderer.renderMessages()
  assert.equal(messagesEl.scrollTop, 1000)

  messagesEl.scrollHeight = 1200
  messagesEl.scrollTop = 760
  scrollHandler()
  renderer.renderMessages()
  assert.equal(messagesEl.scrollTop, 760)

  messagesEl.scrollTop = 980
  scrollHandler()
  messagesEl.scrollHeight = 1300
  renderer.renderMessages()
  assert.equal(messagesEl.scrollTop, 1300)
})

test('renderer message scroll restores manual position by visible message anchor', () => {
  const { OPCMessageScroll } = loadRendererModules()
  const messagesEl = {
    scrollHeight: 1000,
    scrollTop: 450,
    clientHeight: 200,
    children: [
      { dataset: { messageId: 'a' }, offsetTop: 0, offsetHeight: 400 },
      { dataset: { messageId: 'b' }, offsetTop: 400, offsetHeight: 400 },
    ],
    addEventListener: () => {},
  }
  const scroll = OPCMessageScroll.createMessageScrollController(messagesEl)

  const anchor = scroll.captureAnchor()
  assert.equal(anchor.id, 'b')
  assert.equal(anchor.offset, 50)

  messagesEl.children[1].offsetTop = 520
  scroll.restoreAnchor(anchor)
  assert.equal(messagesEl.scrollTop, 570)
})

test('renderer report selection keeps report text selectable and excludes controls', () => {
  const { OPCReportSelection } = loadRendererModules()
  const reportText = {
    closest: selector => (selector === '.bubble, .activityPanel, .timeline, .diagnostics' ? {} : null),
  }
  const reportButton = {
    closest: selector => {
      if (selector === '.bubble, .activityPanel, .timeline, .diagnostics') return {}
      if (selector === 'button, input, textarea, select, a') return {}
      return null
    },
  }
  const outsideText = { closest: () => null }

  assert.equal(OPCReportSelection.isSelectableReportTarget(reportText), true)
  assert.equal(OPCReportSelection.isSelectableReportTarget(reportButton), false)
  assert.equal(OPCReportSelection.isSelectableReportTarget(outsideText), false)
})

test('renderer markdown marks structured reports for premium layout', () => {
  const document = createFakeDom()
  const { OPCMarkdown } = loadRendererModules({ document })
  const root = document.createElement('div')
  OPCMarkdown.renderMessageContent(root, '## Audit\nRésumé\n```bash\npnpm test\n```')
  assert.equal(root.classList.contains('reportRich'), true)
  assert.equal(root.querySelector('h2').textContent, 'Audit')
  assert.equal(root.querySelector('.codeCopy').textContent, 'Copier')
  assert.equal(OPCMarkdown.safeMarkdownHref('javascript:alert(1)'), '#')
  assert.equal(OPCMarkdown.safeMarkdownHref('http://example.com'), '#')
  assert.equal(OPCMarkdown.safeMarkdownHref('https://example.com/a').startsWith('https://example.com/a'), true)
  assert.equal(OPCMarkdown.safeMarkdownHref('http://localhost:3000/status').startsWith('http://localhost:3000/status'), true)
})

test('renderer tool and message action modules classify visible affordances', () => {
  const document = createFakeDom()
  const { OPCToolView, OPCMessageActions } = loadRendererModules({ document })
  assert.equal(OPCToolView.inferredToolKind({ name: 'Bash' }), 'shell')
  assert.equal(OPCToolView.inferredToolKind({ name: 'Edit' }), 'edit')
  assert.equal(OPCToolView.inferredToolKind({ name: 'WebFetch' }), 'web')
  assert.equal(OPCToolView.inferredToolKind({ name: 'Read' }), 'generic')
  const shellItem = OPCToolView.renderToolItem({ name: 'Bash', command: 'pnpm test' })
  assert.equal(Boolean(shellItem.querySelector('.toolCommandFrame')), true)
  assert.equal(shellItem.querySelector('.toolCopy').textContent, 'Copier')

  const messageActions = OPCMessageActions.createMessageActions({
    state: { settings: { model: 'mock/model' } },
    chatController: { previousUserPrompt: () => 'relance' },
    actions: {},
  })
  assert.equal(
    JSON.stringify(messageActions.signature({ role: 'assistant', status: 'done', content: 'ok' })),
    JSON.stringify(['copy', 'retry', 'check-model', 'open-folder']),
  )
})
