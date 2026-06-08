const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8')

test('desktop shell keeps modal accessibility anchors', () => {
  assert.match(html, /id="settingsModal"[^>]+role="dialog"[^>]+aria-modal="true"[^>]+aria-labelledby="settingsTitle"/)
  assert.match(html, /id="projectModal"[^>]+role="dialog"[^>]+aria-modal="true"[^>]+aria-labelledby="projectModalTitle"/)
  assert.match(html, /id="composerStatus"[^>]+aria-live="polite"/)
  assert.match(html, /class="settingsNav"[^>]+aria-label="Sections des réglages"/)
})

test('desktop shell icon-only buttons keep title affordances', () => {
  for (const id of ['providerCheck', 'settingsToggle', 'logsToggle', 'settingsClose', 'settingsProviderCancel', 'settingsProviderImportCancel', 'sendButton']) {
    assert.match(html, new RegExp(`id="${id}"[^>]+title="[^"]+"`))
  }
})

test('desktop shell exposes accessible names for primary runtime regions', () => {
  assert.match(html, /id="messages"[^>]+role="log"[^>]+aria-live="polite"[^>]+aria-label="Conversation OPC"/)
  assert.match(html, /id="pinnedChatList"[^>]+role="list"[^>]+aria-label="Sessions épinglées"/)
  assert.match(html, /id="chatList"[^>]+role="list"[^>]+aria-label="Sessions récentes"/)
  assert.match(html, /id="projectList"[^>]+role="list"[^>]+aria-label="Projets OPC"/)
  assert.match(html, /id="promptInput"[^>]+aria-label="Message à envoyer à OPC"/)
  assert.match(html, /id="sendButton"[^>]+aria-label="Envoyer le message"/)
  assert.match(html, /id="stopButton"[^>]+aria-label="Arrêter la tâche en cours"/)
  assert.match(html, /id="logsPanel"[^>]+aria-label="Inspecteur OPC"/)
  assert.match(html, /id="logs"[^>]+aria-live="polite"/)
})

test('desktop shell loads agent runtime policy modules in the packaged UI', () => {
  for (const script of [
    './state/agentToolPlanner.js',
    './state/agentToolEvidence.js',
    './state/agentTaskStepEngine.js',
    './state/agentWorkerRuntime.js',
    './state/taskCheckpointStore.js',
    './state/taskCheckpointSummarizer.js',
    './state/providerFailurePolicy.js',
    './state/providerRuntimeDiagnostics.js',
    './state/runtimeQualityDashboard.js',
    './state/agenticEvaluationScenarios.js',
  ]) {
    assert.match(html, new RegExp(`<script src="${script.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"></script>`))
  }
})
