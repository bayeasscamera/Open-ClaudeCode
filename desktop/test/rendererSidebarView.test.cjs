const { assert, loadRendererModules, test } = require('./helpers/rendererModules.cjs')
const { JSDOM } = require('jsdom')

function setupSidebar() {
  const dom = new JSDOM(`
    <div id="pinnedHeader"></div>
    <div id="pinnedChatList"></div>
    <div id="projectList"></div>
    <div id="chatList"></div>
  `)
  const windowObject = loadRendererModules({
    document: dom.window.document,
    window: {
      document: dom.window.document,
      prompt: () => null,
    },
  })
  const store = windowObject.OPCState.createStateStore()
  store.load()
  return { dom, store, windowObject }
}

test('sidebar view separates pinned chats projects and recents', () => {
  const { dom, store, windowObject } = setupSidebar()
  const pinned = store.activeChat()
  pinned.title = 'Osaurrus vs agent zéro'
  store.toggleChatPinned(pinned.id, true)
  const recent = store.createChat({ projectId: '' })
  recent.title = 'Résolution d’un problème de champ'
  const project = store.createProject({ name: 'Deep-search' })
  store.setActiveProject('')

  const projectController = {
    projectById: id => store.projectById(id),
    chatCount: id => store.visibleChats(id).length,
  }
  const view = windowObject.OPCSidebarView.createSidebarView({
    els: {
      pinnedHeader: dom.window.document.querySelector('#pinnedHeader'),
      pinnedChatList: dom.window.document.querySelector('#pinnedChatList'),
      projectList: dom.window.document.querySelector('#projectList'),
      chatList: dom.window.document.querySelector('#chatList'),
    },
    state: store.state,
    store,
    projectController,
    chatController: { deleteChat: () => true },
    actions: {},
    nowLabel: () => '04/06 22:22',
    searchQuery: () => '',
    includesQuery: (...values) => values.some(value => String(value || '').trim()),
  })

  view.renderProjects()
  view.renderChats()

  const pinnedTitles = Array.from(dom.window.document.querySelectorAll('#pinnedChatList .chatTitle')).map(node => node.textContent)
  const recentTitles = Array.from(dom.window.document.querySelectorAll('#chatList .chatTitle')).map(node => node.textContent)
  const projectTitles = Array.from(dom.window.document.querySelectorAll('#projectList .projectBody strong')).map(node => node.textContent)

  assert.equal(dom.window.document.querySelector('#pinnedHeader').hidden, false)
  assert.deepEqual(pinnedTitles, ['Osaurrus vs agent zéro'])
  assert.deepEqual(recentTitles, ['Résolution d’un problème de champ'])
  assert.deepEqual(projectTitles, [project.name])
  assert.equal(projectTitles.includes('Tous les chats'), false)
})
