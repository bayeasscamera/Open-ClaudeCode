const { assert, createStorage, loadRendererModules, test } = require('./helpers/rendererModules.cjs')

test('state repository reads and writes local payloads with optional remote save', async () => {
  const storage = createStorage()
  const remotePayloads = []
  const { OPCStateRepository } = loadRendererModules({ window: { localStorage: storage } })
  const repository = OPCStateRepository.createStateRepository({
    storage,
    remoteSave: payload => {
      remotePayloads.push(payload)
      return Promise.resolve({ ok: true })
    },
  })

  const write = repository.write({ chats: [{ id: 'chat-1' }] })
  await write.pendingRemote

  assert.equal(write.ok, true)
  assert.deepEqual(repository.read().value.chats.map(chat => chat.id), ['chat-1'])
  assert.equal(remotePayloads.length, 1)
})

test('state store can persist through an injected repository', () => {
  const writes = []
  const storage = createStorage()
  const { OPCState, OPCStateRepository } = loadRendererModules({ window: { localStorage: storage } })
  const repository = OPCStateRepository.createStateRepository({
    storage,
    remoteSave: payload => {
      writes.push(payload)
      return Promise.resolve({ ok: true })
    },
  })
  const store = OPCState.createStateStore(storage, repository)

  store.load()
  store.createChat()

  assert.equal(writes.length > 0, true)
  assert.equal(store.state.persistenceError, '')
})

test('state store smoke test keeps large history bounded before persistence', () => {
  const writes = []
  const storage = createStorage()
  const { OPCState, OPCStateRepository } = loadRendererModules({ window: { localStorage: storage } })
  const repository = OPCStateRepository.createStateRepository({
    storage,
    remoteSave: payload => {
      writes.push(payload)
      return Promise.resolve({ ok: true })
    },
  })
  const store = OPCState.createStateStore(storage, repository)
  const largeState = {
    activeChatId: 'chat-0',
    chats: Array.from({ length: 120 }, (_, index) => ({
      id: `chat-${index}`,
      title: `Chat ${index}`,
      createdAt: '2026-06-03T00:00:00.000Z',
      messages: Array.from({ length: 12 }, (__, messageIndex) => ({
        id: `message-${index}-${messageIndex}`,
        role: messageIndex % 2 ? 'assistant' : 'user',
        content: 'message '.repeat(200),
        events: [],
        status: 'done',
      })),
    })),
  }

  assert.equal(store.loadFromPayload(largeState), true)
  store.save()

  const saved = JSON.parse(storage.getItem(OPCStateRepository.DEFAULT_STORAGE_KEY))
  assert.equal(saved.chats.length, 40)
  assert.equal(writes.at(-1).chats.length, 40)
  assert.equal(store.state.persistenceError, '')
})
