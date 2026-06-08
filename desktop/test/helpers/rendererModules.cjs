const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

function createStorage() {
  const data = new Map()
  return {
    getItem: key => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
  }
}

function loadRendererModules(overrides = {}) {
  const windowObject = { localStorage: createStorage(), ...(overrides.window || {}) }
  const context = {
    window: windowObject,
    setTimeout,
    clearTimeout,
    Date,
    JSON,
    Math,
    RegExp,
    String,
    URL,
    Object,
    Array,
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (key !== 'window') context[key] = value
  }
  vm.createContext(context)

  function rendererModulePath(file) {
    const rendererRoot = path.join(__dirname, '..', '..', 'renderer')
    for (const dir of ['', 'state', 'services', 'controllers', 'views', 'ports']) {
      const candidate = path.join(rendererRoot, dir, file)
      if (fs.existsSync(candidate)) return candidate
    }
    return path.join(rendererRoot, file)
  }

  for (const file of [
    'stateRules.js',
    'agentTaskLedger.js',
    'agentToolRegistry.js',
    'agentToolEvidence.js',
    'agentVerificationEngine.js',
    'agentContextBudget.js',
    'agentProviderRouter.js',
    'agentToolPlanner.js',
    'agentTaskStepEngine.js',
    'agentWorkerRuntime.js',
    'agentRuntimeProfile.js',
    'agentStepRunner.js',
    'taskCheckpointStore.js',
    'taskCheckpointSummarizer.js',
    'providerFailurePolicy.js',
    'providerRuntimeDiagnostics.js',
    'runtimeQualityDashboard.js',
    'agenticEvaluationScenarios.js',
    'stateRepository.js',
    'stateStore.js',
    'projectFileIndex.js',
    'competenceProfile.js',
    'projectRuntimeContext.js',
    'builtInSkills.js',
    'commandPolicy.js',
    'agentContract.js',
    'speedReader.js',
    'activity.js',
    'completionGuard.js',
    'conversationContext.js',
    'providerIssueRules.js',
    'providerHealth.js',
    'taskManager.js',
    'inspectorView.js',
    'chatController.js',
    'projectController.js',
    'projectFileController.js',
    'serviceController.js',
    'providerController.js',
    'runtimeDiagnostics.js',
    'runRuntimeState.js',
    'runAudit.js',
    'workspaceTrust.js',
    'advancedPermissionPolicy.js',
    'runRequestPlanner.js',
    'runTaskPlanner.js',
    'runTaskQueue.js',
    'runResumeRecovery.js',
    'runController.js',
    'promptComposerController.js',
    'messageScroll.js',
    'renderScheduler.js',
    'logBuffer.js',
    'opcClient.js',
    'toolView.js',
    'markdownRenderer.js',
    'messageActions.js',
    'sidebarView.js',
    'runtimeContextView.js',
    'projectContextView.js',
    'messageView.js',
    'settingsHelpers.js',
    'providerPanelViewModel.js',
    'providerEditorModel.js',
    'settingsProviderPanel.js',
    'settingsController.js',
    'renderController.js',
    'reportSelection.js',
  ]) {
    vm.runInContext(fs.readFileSync(rendererModulePath(file), 'utf8'), context, { filename: file })
  }
  return context.window
}

module.exports = {
  assert,
  createStorage,
  loadRendererModules,
  test,
}
