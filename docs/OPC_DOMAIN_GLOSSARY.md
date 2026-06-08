# OPC Domain Glossary

This glossary stabilizes names used during surgical refactoring. It is intentionally small and mirrors the current desktop and CLI vocabulary.

| Term | Meaning | Current Surface |
| --- | --- | --- |
| Provider | External or local model endpoint used by OPC. | `desktop/electron/provider*.cjs`, provider settings UI |
| Provider Profile | One runnable provider/model configuration, including base URL, model, capabilities, timeout, retry and secret references. | `providerConfig.cjs`, `providerProfilePolicy.cjs` |
| Provider Issue | Normalized reason why a provider cannot be used now: auth, quota, timeout, network, unsupported, server or request error. | `providerIssue.cjs`, `providerHealth.js` |
| Provider Check | Direct diagnostic request used to classify provider readiness before a run. | `providerChecker.cjs`, renderer health state |
| Runtime | The active CLI process and related children launched by the desktop shell. | `cliRunner.cjs`, `runtimeSupervisor.cjs`, `runController.js` |
| Run | A single user prompt execution through the OPC CLI. | `ipcHandlers.cjs`, `runController.js` |
| Long Task | A command or service observed during a run that may outlive the immediate CLI response. | `taskManager.js`, `processControl.cjs` |
| Project File | User-authorized file or folder excerpt attached to a run context. | `projectFiles.cjs`, `projectFileController.js` |
| Desktop State | Local renderer state persisted across launches, after secret redaction. | `stateStore.js`, `desktopStateStore.cjs` |
| Support Bundle | Local diagnostic JSON export containing redacted runtime, provider, memory, state and doctor context. | `supportBundle.cjs` |
| Private JSON | JSON written locally with `0600` permissions and, when critical, atomic replacement. | `privateJsonFile.cjs` |
| Redaction | Recursive removal of provider secrets, tokens and authorization fields before persistence or export. | `redaction.cjs` |

## Naming Rules

- Use `ProviderProfile` for persisted/editable model configuration.
- Use `ProviderCheck` for diagnostic results.
- Use `ProviderIssue` for normalized failure categories.
- Use `Runtime` for process lifecycle state.
- Use `Run` for one prompt execution.
- Use `PrivateJson` only for filesystem persistence helpers, not for domain objects.
