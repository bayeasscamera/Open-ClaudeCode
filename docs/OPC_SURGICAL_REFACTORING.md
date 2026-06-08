# OPC Surgical Refactoring Report

## Objectif

Transformer progressivement OPC vers une architecture plus propre, modulaire, testable et evolutive, sans changer le comportement metier existant sauf correction de bug identifiee.

Ce rapport couvre deux surfaces distinctes :

- `desktop/` : application Electron locale, testee et packagée, avec 201 tests desktop valides lors de la derniere verification.
- `src/` et `package/` : coeur CLI/agent reconstruit depuis source map, tres large, peu outille au niveau racine, avec un binaire packagé `package/cli.js`.

## Diagnostic Global

L'architecture actuelle fonctionne, mais elle melange plusieurs niveaux de responsabilite dans les memes modules. Le risque principal n'est pas une absence totale de structure ; c'est plutot une accumulation de modules peu profonds, tres longs, dont l'interface force les appelants a connaitre trop d'invariants.

Les points positifs :

- `desktop/` dispose d'une bonne base de tests Node, IPC, provider, renderer, smoke UI et smoke visuel.
- Les modules desktop sont deja partiellement separes par role : Electron, provider bridge, renderer state, controllers, views.
- Les zones sensibles recentes, comme permissions, liens externes, support bundle et secrets provider, ont des tests de non-regression.
- Le coeur `src/` contient deja des sous-domaines nommes : `query`, `bridge`, `services/tools`, `utils/permissions`, `tools/BashTool`, `tools/PowerShellTool`.

Les problemes structurants :

- Le coeur `src/` n'a pas de `tsconfig` ni de script de test/build racine identifiable ; la source TypeScript est donc difficile a verifier directement.
- Plusieurs modules depassent largement une taille raisonnable : `src/cli/print.ts` environ 5 600 lignes, `src/utils/messages.ts` environ 5 500 lignes, `src/utils/sessionStorage.ts` environ 5 100 lignes, `src/main.tsx` environ 4 700 lignes, `src/query.ts` environ 1 700 lignes, `src/bridge/bridgeMain.ts` environ 3 000 lignes.
- `desktop/electron/ipcHandlers.cjs` enregistre 25+ canaux IPC dans un seul module, avec validation, orchestration, fichiers projet, provider config, runtime et export.
- `desktop/renderer/controllers/runController.js` orchestre a la fois prompt, preflight provider, queue, runtime, messages, diagnostics, resume recovery, audit et service probing.
- `desktop/renderer/services/settingsProviderPanel.js` melange etat UI, rendu DOM, logique provider, import/export JSON, discovery, quarantine, history et editor form.
- Les memes concepts sont dupliques entre main process et renderer : classification provider, permission labels/modes, redaction de secrets, statuts provider, serialisation JSON.
- Les interfaces sont souvent implicites via `window.OPC*` et `window.opc`, ce qui rend les dependances reelles difficiles a voir et a typer.

## Architecture Cible Recommandee

Architecture cible, sans rupture :

```text
desktop/
  electron/
    ipc/
      registry.cjs
      domains/
        runtimeIpc.cjs
        projectIpc.cjs
        providerIpc.cjs
        diagnosticsIpc.cjs
        clipboardIpc.cjs
    runtime/
      cliRunner.cjs
      runtimeSupervisor.cjs
    providers/
      providerConfigStore.cjs
      providerPolicy.cjs
      providerIssueClassifier.cjs
    persistence/
      jsonFileStore.cjs
      desktopStateStore.cjs
    diagnostics/
      doctor.cjs
      supportBundle.cjs
  renderer/
    app/
      compositionRoot.js
    state/
    controllers/
    views/
    viewModels/
    ports/
      opcClient.js
```

Pour `src/`, la cible doit rester conservatrice :

```text
src/
  query/
    queryLoop.ts
    queryIteration.ts
    modelStream.ts
    recoveryPolicy.ts
    toolTurn.ts
    attachmentTurn.ts
  bridge/
    bridgeMain.ts
    loop/
    session/
    polling/
    shutdown/
  tools/
    shellSafety/
      commandPolicy.ts
      bashReadOnlyPolicy.ts
      powershellReadOnlyPolicy.ts
      sharedReadOnlyTables.ts
```

Principe directeur : creer des modules profonds. Une interface petite doit cacher une logique riche. Le test doit viser l'interface, pas l'implementation interne.

## Recommandations Priorisees

| Rang | Refactorisation | Impact | Effort | Risque | Priorite |
|---:|---|---|---|---|---|
| 1 | Scinder `desktop/electron/ipcHandlers.cjs` par domaine IPC | Eleve | Moyen | Faible | Haute |
| 2 | Extraire un `RunTaskOrchestrator` depuis `runController.js` | Eleve | Moyen | Moyen | Haute |
| 3 | Separer le provider settings panel en view model + renderer DOM | Eleve | Moyen | Moyen | Haute |
| 4 | Centraliser redaction, JSON prive, ecriture atomique et permissions fichier | Eleve | Faible | Faible | Haute |
| 5 | Centraliser provider issue classification entre Electron et renderer | Moyen | Faible | Faible | Haute |
| 6 | Introduire un port renderer `opcClient` au lieu d'appels directs `window.opc` | Moyen | Faible | Faible | Moyenne |
| 7 | Stabiliser l'outillage racine TypeScript : `tsconfig`, scripts, tests de caracterisation | Eleve | Eleve | Moyen | Critique pour `src/` |
| 8 | Decouper `src/query.ts` en politiques de tour/recovery/outils | Tres eleve | Eleve | Eleve | Critique, mais tardif |
| 9 | Decouper `src/bridge/bridgeMain.ts` en loop/session/polling/shutdown | Tres eleve | Eleve | Eleve | Critique, mais tardif |
| 10 | Refactoriser les validateurs Bash/PowerShell par tables partagees et strategies | Tres eleve | Eleve | Eleve | Critique securite |
| 11 | Remplacer progressivement `localStorage` desktop par store local versionne | Eleve | Eleve | Moyen | Moyenne |
| 12 | Migrer les modules desktop critiques CJS vers TypeScript avec schemas partages | Moyen | Eleve | Moyen | Moyenne |

## Problemes et Refactorisations Detaillees

### 1. IPC Electron trop centralise

Fichiers concernes :

- `desktop/electron/ipcHandlers.cjs`
- `desktop/electron/ipcValidation.cjs`
- `desktop/electron/preload.cjs`
- `desktop/test/ipcHandlers.test.cjs`

Probleme actuel :

`registerIpcHandlers` enregistre la sante, doctor, support bundle, runtime, clipboard, state, fichiers projet, import/export projet, open path, process kill, service probe, provider check/discovery/refine/config dans un seul module. L'interface du module est large : chaque changement IPC impose de charger mentalement tout le registre.

Impact technique :

- Locality faible : une erreur sur projet peut toucher provider ou runtime.
- Tests plus gros que necessaire.
- Ajout d'un canal IPC encourage le fichier unique.
- Le risque de regression monte avec chaque nouveau handler.

Solution :

Creer un registre tres fin et des modules par domaine :

```js
// Avant
registerIpcHandlers({ ipcMain, dialog, shell, cliRunner, providerConfigStore, ... })

// Apres
registerIpcHandlers(ipcMain, [
  createRuntimeIpc(deps),
  createProjectIpc(deps),
  createProviderIpc(deps),
  createDiagnosticsIpc(deps),
  createClipboardIpc(deps),
])
```

Chaque module expose :

```js
function createProviderIpc({ providerConfigStore, providerChecker, providerModelDiscovery }) {
  return {
    channels: {
      'opc:provider-config': async () => ({ ok: true, config: providerConfigStore.editableConfig() }),
      'opc:provider-check': async (_event, payload) => providerChecker.check(validateProviderCheckPayload(payload).model),
    },
  }
}
```

Difficulte : moyenne.

Gain attendu : forte baisse du couplage, tests plus courts, ajout de handlers plus sur.

Risque : collisions de noms de canaux ou ordre d'enregistrement. Mitigation : test de snapshot des canaux enregistres et conservation du preload existant.

Priorite : haute.

### 2. `runController.js` porte trop de responsabilites

Fichier concerne :

- `desktop/renderer/controllers/runController.js`

Probleme actuel :

Le module gere a la fois :

- preparation du prompt ;
- preflight provider ;
- creation des messages user/assistant ;
- queue de taches ;
- lancement IPC ;
- runtime diagnostics ;
- resume recovery ;
- audit ;
- service probing ;
- mutation directe du store.

Impact technique :

- Violation SRP : plusieurs raisons de changer.
- Couplage fort entre UI, etat, runtime et logique de reprise.
- Les cas limites de queue et resume recovery sont difficiles a isoler.

Solution :

Extraire trois modules profonds :

- `runTaskPlanner` : transforme prompt + state en tache.
- `runTaskQueue` : gere queue, activeTask, stop, retry.
- `runEventReducer` : applique `onRunStart`, `onCliEvent`, `onRunEnd`, `onRuntime` sur un etat assistant.

Avant :

```js
async function sendPrompt() {
  const preflight = await providerPreflightWithRefresh()
  const planned = requestPlanner.plan({ prompt, chat })
  chat.messages.push(...)
  taskQueue.push(...)
  startNextTask()
}
```

Apres :

```js
async function sendPrompt() {
  const result = await taskPlanner.planPrompt({ prompt: getPrompt().trim() })
  if (!result.ok) return messageWriter.writePreflightError(result)
  taskQueue.enqueue(result.task)
  renderAfterQueueChange()
}
```

Difficulte : moyenne.

Gain attendu : meilleure testabilite des transitions, moins de regression sur les flows runtime.

Risque : changement d'ordre subtil entre `store.save()`, `onRender()` et `startNextTask()`. Mitigation : tests de caracterisation sur ordre d'appels pour `sendPrompt`, `stopActiveTask`, `onRunEnd`.

Priorite : haute.

### 3. Provider Settings Panel trop volumineux

Fichier concerne :

- `desktop/renderer/services/settingsProviderPanel.js`

Probleme actuel :

Le module contient editor state, import state, action state, repair log, rendu de listes, rendu de meta provider, discovery, quarantine, import JSON et wiring DOM.

Impact technique :

- Les changements UX et provider policy sont melanges.
- Les tests doivent simuler trop de DOM pour valider une regle.
- L'interface du module est peu profonde : beaucoup de comportement cache derriere tres peu de separations internes, mais avec de nombreux invariants globaux.

Solution :

Extraire :

- `providerPanelViewModel.js` : calcule groupes, labels, boutons disponibles, etats disabled.
- `providerEditorModel.js` : lit/normalise le formulaire.
- `providerPanelDom.js` : cree uniquement le DOM.

Avant :

```js
function providerItem(profile) {
  const check = window.OPCProviderHealth?.checkForProfile?.(...)
  const item = document.createElement('div')
  item.innerHTML = '...'
  item.querySelector('.settingsProviderActions').append(
    providerButton('Tester', ...),
    providerButton('Modifier', ...),
  )
  return item
}
```

Apres :

```js
const itemModel = providerPanelViewModel.profileItem(profile, context)
return providerPanelDom.renderProviderItem(itemModel, actions)
```

Difficulte : moyenne.

Gain attendu : UX plus facile a faire evoluer, tests sans DOM sur 70% de la logique.

Risque : regression visuelle. Mitigation : conserver `test:visual` comme gate et ajouter tests view model.

Priorite : haute.

### 4. Redaction et ecriture JSON privee dupliquees

Fichiers concernes :

- `desktop/electron/redaction.cjs`
- `desktop/electron/desktopStateStore.cjs`
- `desktop/electron/providerConfig.cjs`
- `desktop/electron/supportBundle.cjs`
- `desktop/renderer/state/stateRules.js`
- `desktop/renderer/services/logBuffer.js`

Probleme actuel :

La redaction et l'ecriture privee JSON existent a plusieurs endroits. Les patterns sont proches mais pas toujours centralises. Exemple : `desktopStateStore`, `supportBundle`, `providerConfig` et `userDataMigration` ecrivent tous des fichiers JSON `0600`.

Impact technique :

- Une nouvelle surface peut oublier la redaction.
- Les tests anti-fuite doivent etre dupliques.
- Difficile d'assurer le meme comportement sur tous les exports.

Solution :

Creer :

- `desktop/electron/persistence/privateJsonFile.cjs`
- `desktop/electron/security/redaction.cjs`
- `desktop/renderer/security/redaction.js`

Interface cible :

```js
writePrivateJson(filePath, value, { redact: redactSecretsDeep })
readJsonFile(filePath, { maxBytes: 2 * 1024 * 1024 })
```

Difficulte : faible.

Gain attendu : fort, car securite et maintenance.

Risque : faible. Mitigation : tests existants `providerConfig`, `desktopStateStore`, `supportBundle`, `userDataMigration`.

Priorite : haute.

### 5. Classification provider dupliquee

Fichiers concernes :

- `desktop/electron/providerIssue.cjs`
- `desktop/electron/providerProfilePolicy.cjs`
- `desktop/renderer/services/providerHealth.js`
- `desktop/renderer/controllers/providerController.js`

Probleme actuel :

Les categories `rate_limited`, `unsupported`, `timeout`, `needs_config`, etc. sont derivees a plusieurs endroits, avec regex similaires comme `rate limit|quota|too many requests|capacity`.

Impact technique :

- Incoherence possible entre main process et UI.
- Les cooldowns peuvent diverger de la classification affichée.
- Les nouveaux providers augmentent la duplication.

Solution :

Creer un module partageable ou generer une table commune :

```js
const PROVIDER_ISSUE_RULES = [
  { code: 'rate_limited', statusCodes: [429], pattern: /\b(rate limit|quota|too many requests|capacity)\b/i },
  { code: 'unsupported', pattern: /\b(unsupported|unknown parameter|reasoning_content|thinking)\b/i },
]
```

Le main process classe l'erreur et le renderer ne fait qu'afficher une categorie deja normalisee. Le renderer garde une fonction de fallback pour compatibilite avec les anciens etats.

Difficulte : faible.

Gain attendu : comportement provider plus previsible.

Risque : faible. Mitigation : tests de categories sur les deux cotes.

Priorite : haute.

### 6. Dependances implicites via `window.OPC*`

Fichiers concernes :

- `desktop/renderer/app.js`
- `desktop/renderer/controllers/*.js`
- `desktop/renderer/state/*.js`
- `desktop/renderer/services/*.js`

Probleme actuel :

La composition renderer repose sur des globals : `window.OPCState`, `window.OPCProviderHealth`, `window.OPCRunController`, etc. Cela fonctionne sans bundler, mais les interfaces ne sont pas explicites.

Impact technique :

- Ordre de chargement fragile.
- Tests obliges de reconstruire un faux `window`.
- Migration TypeScript difficile.

Solution :

Introduire un composition root et des ports explicites sans changer le chargement :

```js
function createOpcRuntime(win = window) {
  return {
    state: win.OPCState,
    providerHealth: win.OPCProviderHealth,
    ipc: win.opc,
  }
}
```

Puis injecter `runtime` dans les controllers au lieu de lire `window` en profondeur.

Difficulte : faible a moyenne.

Gain attendu : meilleure testabilite et chemin de migration vers modules ES/TypeScript.

Risque : ordre d'initialisation. Mitigation : garder les exports `window.OPC*` pendant la transition.

Priorite : moyenne.

### 7. Outillage racine TypeScript insuffisant

Fichiers concernes :

- `package.json`
- `src/**/*.ts`
- `src/**/*.tsx`
- `src/cli/print.test.ts`

Probleme actuel :

Le package racine minimal ne declare ni script de test, ni build, ni `tsconfig`. La source `src/` est large mais non verifiable comme base TypeScript autonome.

Impact technique :

- Toute refactorisation de `src/` est a haut risque.
- Les changements peuvent casser types/imports sans gate locale.
- Le binaire veritable est `package/cli.js`, pas directement `src/`.

Solution :

Phase d'abord non intrusive :

- Ajouter `tsconfig.check.json` avec `noEmit`.
- Ajouter un script `typecheck:src`.
- Ajouter un runner minimal pour les tests TypeScript existants ou documenter qu'ils sont non executables.
- Ne pas reconnecter immediatement `package/cli.js` a `src/`.

Difficulte : elevee, car source reconstruite et imports `bun:bundle`/alias `src/*`.

Gain attendu : prerequis pour toute chirurgie serieuse du coeur CLI.

Risque : fort bruit initial de typecheck. Mitigation : commencer par un `tsconfig` permissif et une allowlist de fichiers critiques.

Priorite : critique pour refactoriser `src/`.

### 8. `src/query.ts` est une boucle metier monolithique

Fichier concerne :

- `src/query.ts`

Probleme actuel :

`queryLoop` gere dans une seule boucle : compaction, snip, context collapse, budget, streaming API, fallback model, withheld errors, tool execution, stop hooks, attachments, memory prefetch, skill prefetch, queue commands et max turns.

Impact technique :

- Violation SRP.
- Complexite cyclomatique elevee.
- Les transitions de boucle sont difficiles a prouver.
- Les commentaires compensent une interface trop large.

Solution :

Extraire des politiques pures :

- `prepareQueryInput(state, params)`
- `streamModelAttempt(context)`
- `recoverFromTerminalAssistantMessage(...)`
- `executeToolTurn(...)`
- `appendTurnAttachments(...)`
- `nextQueryState(...)`

Avant :

```ts
while (true) {
  // compaction
  // streaming
  // recovery
  // tools
  // attachments
  state = next
}
```

Apres :

```ts
while (true) {
  const prepared = await prepareQueryInput(state, context)
  const streamed = await streamModelAttempt(prepared)
  const recovery = await decideRecovery(streamed, state)
  if (recovery.terminal) return recovery.terminal
  if (recovery.retry) {
    state = recovery.state
    continue
  }
  const toolTurn = await executeToolTurn(streamed)
  state = await nextQueryState(prepared, streamed, toolTurn)
}
```

Difficulte : elevee.

Gain attendu : tres eleve sur maintenabilite, verification des edge cases et evolutivite.

Risque : eleve. Mitigation : tests de caracterisation sur transitions : prompt too long, streaming fallback, max output tokens, tool abort, stop hook blocking, max turns.

Priorite : critique mais seulement apres outillage.

### 9. `src/bridge/bridgeMain.ts` concentre loop, sessions et CLI

Fichier concerne :

- `src/bridge/bridgeMain.ts`

Probleme actuel :

Le module combine parsing CLI, config, auth, polling, backoff, heartbeat, spawn, worktree, session timeout, logger, shutdown et mode headless.

Impact technique :

- Locality faible autour des sessions.
- Les changements sur retry/backoff peuvent impacter shutdown.
- Les tests doivent couvrir trop de branches dans un seul module.

Solution :

Extraire :

- `bridge/session/sessionRegistry.ts`
- `bridge/polling/pollLoop.ts`
- `bridge/shutdown/shutdownCoordinator.ts`
- `bridge/config/parseBridgeArgs.ts`
- `bridge/session/sessionSpawnerAdapter.ts`

Difficulte : elevee.

Gain attendu : meilleur controle des modes single-session, same-dir, worktree, headless.

Risque : eleve. Mitigation : tests contractuels sur `parseArgs`, `runBridgeHeadless`, reconnect, heartbeat auth failure, shutdown.

Priorite : critique mais tardive.

### 10. Validateurs Bash/PowerShell massifs et sensibles

Fichiers concernes :

- `src/tools/BashTool/readOnlyValidation.ts`
- `src/tools/PowerShellTool/readOnlyValidation.ts`
- `src/utils/shell/readOnlyCommandValidation.ts`
- `src/tools/BashTool/bashPermissions.ts`
- `src/tools/PowerShellTool/powershellPermissions.ts`

Probleme actuel :

Les regles de securite sont volumineuses, avec beaucoup de tables et callbacks specifiques. Bash et PowerShell partagent des concepts mais pas une interface de politique commune.

Impact technique :

- Toute simplification non testee peut devenir une faille.
- Duplication conceptuelle entre shell types.
- Difficulté a auditer les garanties d'`acceptEdits`, `auto`, `bypassPermissions`.

Solution :

Ne pas decouper directement. D'abord creer une suite de tests de caracterisation :

- commandes read-only autorisees ;
- payloads d'evasion bloques ;
- differences Bash/PowerShell explicites ;
- mode `acceptEdits` vs `bypassPermissions`.

Ensuite extraire un module `shellSafety` :

```ts
type ShellSafetyPolicy = {
  parse(command: string): ParsedShellCommand
  classify(parsed: ParsedShellCommand, context: PermissionContext): PermissionResult
}
```

Difficulte : elevee.

Gain attendu : securite plus auditable, duplication reduite.

Risque : critique. Mitigation : refactorisation sans changement fonctionnel, golden tests, fuzz cases de commandes dangereuses.

Priorite : critique, mais uniquement avec tests.

### 11. Persistance desktop encore limitee par `localStorage`

Fichiers concernes :

- `desktop/renderer/state/stateStore.js`
- `desktop/electron/desktopStateStore.cjs`
- `desktop/electron/projectFiles.cjs`

Probleme actuel :

L'etat renderer est stocke dans `localStorage` puis sauvegarde cote Electron. C'est acceptable pour une application locale, mais fragile pour beaucoup de conversations, fichiers indexes et historique provider.

Impact technique :

- Performance degradee avec gros historiques.
- Pas de requetes efficaces ni de migration fine.
- Risque de corruption globale d'un gros JSON.

Solution :

Introduire un `StateRepository` compatible :

- phase 1 : interface au-dessus du JSON actuel ;
- phase 2 : adapter SQLite local ;
- phase 3 : migration progressive chats/projets/provider health/index fichiers.

Difficulte : elevee.

Gain attendu : scalabilite locale, recherche, robustesse.

Risque : moyen. Mitigation : double-write temporaire, export projet existant comme plan de retour.

Priorite : moyenne.

### 12. Incoherences de nommage et langue technique

Fichiers concernes :

- `desktop/renderer/**`
- `desktop/electron/**`
- `src/**`

Probleme actuel :

Le code melange anglais technique, libelles francais, noms historiques Claude/Tengu/OPC, et concepts provider varies. Exemples : `tengu_*` events dans `src/query.ts`, UI francaise dans desktop, `OPC` globals, `claude` package.

Impact technique :

- Onboarding plus lent.
- Recherche dans le code moins fiable.
- Risque de dupliquer un concept sous un autre nom.

Solution :

Creer un glossaire local :

- `docs/OPC_DOMAIN_GLOSSARY.md`
- termes : Run, Task, Companion Job, Provider Profile, Provider Check, Doctor Report, Support Bundle, Project Runtime, Permission Mode.

Difficulte : faible.

Gain attendu : maintenabilite et coherence.

Risque : faible.

Priorite : moyenne.

## Plan de Refactorisation par Etapes

### Phase 1 : Refactorisation sans changement fonctionnel

Objectif : reduire duplication et renforcer les interfaces sans deplacer le comportement.

Taches :

1. Ajouter un glossaire `docs/OPC_DOMAIN_GLOSSARY.md`.
2. Creer `desktop/electron/persistence/privateJsonFile.cjs`.
3. Remplacer les ecritures JSON privees desktop par ce module.
4. Centraliser la redaction deep cote Electron.
5. Centraliser la classification provider issue.
6. Ajouter tests de caracterisation pour provider issue, redaction, private JSON.
7. Ajouter un test listant les canaux IPC attendus.
8. Documenter dans `OPC_SCALE_READINESS.md` les gates de refactorisation.

Verification :

```bash
npm --prefix desktop run verify:ci
npm --prefix desktop run verify
```

### Phase 2 : Reorganisation structurelle

Objectif : separer les responsabilites desktop les plus visibles.

Taches :

1. Scinder `ipcHandlers.cjs` en modules de domaines IPC.
2. Conserver un registre central compatible avec le preload actuel.
3. Extraire `providerPanelViewModel.js`.
4. Extraire `providerEditorModel.js`.
5. Extraire `runTaskPlanner.js`.
6. Extraire `runTaskQueue.js`.
7. Ajouter tests unitaires sans DOM pour les view models et planners.
8. Garder `app.js` comme composition root temporaire.

Verification :

```bash
npm --prefix desktop test
npm --prefix desktop run test:ui
npm --prefix desktop run test:visual
```

### Phase 3 : Amelioration architecturale

Objectif : mettre des modules profonds aux endroits critiques.

Taches :

1. Introduire `desktop/renderer/ports/opcClient.js`.
2. Injecter `opcClient` dans controllers au lieu de `window.opc`.
3. Introduire une interface `StateRepository` au-dessus de `stateStore`.
4. Ajouter un `tsconfig.check.json` experimental pour un sous-ensemble `src/query`, `src/bridge`, `src/services/tools`.
5. Ajouter tests de caracterisation de `src/query.ts` avant tout decoupage.
6. Extraire `src/query/recoveryPolicy.ts`.
7. Extraire `src/query/toolTurn.ts`.
8. Extraire `src/query/attachmentTurn.ts`.

Verification :

```bash
npm --prefix desktop run verify
node package/cli.js --version
```

Le typecheck `src` doit d'abord etre introduit en mode allowlist pour eviter un mur d'erreurs non actionnables.

### Phase 4 : Preparation a l'evolutivite

Objectif : rendre l'application prete aux volumes, au diagnostic et aux evolutions longues.

Taches :

1. Introduire SQLite local derriere `StateRepository`.
2. Migrer provider health et long tasks en premier.
3. Migrer chats/projets ensuite avec double-write temporaire.
4. Ajouter FTS local pour historique et fichiers projet.
5. Ajouter observabilite locale : spans runtime, doctor metadata, crash metadata dans support bundle.
6. Ajouter tests accessibilite automatises pour les dialogs desktop.
7. Migrer modules desktop critiques vers TypeScript par domaine, pas en big bang.

Verification :

```bash
npm --prefix desktop run verify
./script/build_and_run.sh --verify
```

## Roadmap Priorisee

### Sprint 1 : Fondations faible risque

- Centraliser private JSON + redaction.
- Centraliser provider issue classifier.
- Ajouter glossaire.
- Ajouter test snapshot IPC.
- Mettre a jour tracker readiness.

Gain : securite, coherence, regression faible.

### Sprint 2 : Decoupage IPC et provider UI

- Scinder IPC par domaine.
- Extraire provider panel view model.
- Extraire provider editor model.
- Ajouter tests de view model.

Gain : ajout de fonctionnalites provider plus rapide, baisse du risque de regression UI.

### Sprint 3 : Runtime renderer

- Extraire `runTaskPlanner`.
- Extraire `runTaskQueue`.
- Extraire `runEventReducer`.
- Ajouter tests de transitions queue/runtime/recovery.

Gain : stabilite runtime, bugs plus localisables.

### Sprint 4 : Outillage `src`

- Ajouter `tsconfig.check.json` allowlist.
- Rendre executable au moins un test TypeScript critique.
- Ajouter tests de caracterisation query/bridge/shell safety.

Gain : possibilite de refactoriser le coeur CLI avec garde-fous.

### Sprint 5 : Chirurgie coeur CLI

- Refactoriser `query.ts` par politiques.
- Refactoriser `bridgeMain.ts` par sous-modules.
- Refactoriser shell safety uniquement sous couverture.

Gain : maintenabilite long terme, evolution des agents, meilleure robustesse.

### Sprint 6 : Scalabilite locale

- Introduire `StateRepository`.
- Adapter SQLite.
- Double-write + migration.
- FTS.

Gain : performance locale et usage a grande echelle.

## Refactorisations Critiques

Ces zones ne doivent pas etre touchees sans tests de caracterisation prealables :

- `src/tools/BashTool/readOnlyValidation.ts`
- `src/tools/BashTool/bashPermissions.ts`
- `src/tools/BashTool/bashSecurity.ts`
- `src/tools/PowerShellTool/readOnlyValidation.ts`
- `src/tools/PowerShellTool/powershellPermissions.ts`
- `src/query.ts`
- `src/bridge/bridgeMain.ts`
- `desktop/electron/providerConfig.cjs`
- `desktop/electron/providerSecretVault.cjs`
- `desktop/electron/ipcValidation.cjs`

## Points a Surveiller pour Eviter les Regressions

- Ordre des evenements runtime : `onRunStart`, `onCliEvent`, `onRunEnd`, `onRuntime`.
- Semantique des permissions : `acceptEdits`, `auto`, `dontAsk`, `plan`, `bypassPermissions`.
- Redaction de secrets dans logs, state, support bundle, backups provider.
- Compatibilite preload : ne pas renommer les canaux `opc:*` sans adapter renderer et tests.
- Fichiers projet autorises : ne pas affaiblir `projectFileAccess`.
- Provider streaming vs buffered : conserver les tests OpenAI-compatible, Anthropic et GitLab suggestions.
- Recovery de session CLI : conserver le comportement de relance sans `--resume`.
- Export/import projet : garder format JSON compatible.
- Smoke visuel : toute extraction DOM doit passer `test:visual`.

## Gains Attendus

Maintenabilite :

- Baisse du nombre de fichiers a ouvrir pour comprendre un changement.
- Tests plus cibles et plus rapides a ecrire.
- Interfaces plus explicites entre IPC, runtime, provider, state et UI.

Performance :

- Moins de serialisation globale via `localStorage` a terme.
- Possibilite de recherche et pagination locales.
- Moins de rendu DOM recompute par gros panels.

Evolutivite :

- Ajout de providers plus simple.
- Ajout de diagnostics Doctor plus fiable.
- Migration progressive vers TypeScript et SQLite sans big bang.
- Refactorisation du coeur CLI possible une fois l'outillage pose.

## Decision Architecturale Recommandee

Commencer par `desktop/`, pas par `src/`.

Raison : `desktop/` est deja couvert par tests et verifications. `src/` est beaucoup plus large, mais sans outillage racine suffisant ; une chirurgie directe sur `query.ts`, `bridgeMain.ts` ou les validateurs shell serait trop risquee aujourd'hui.

Top recommendation :

1. Centraliser redaction/private JSON/provider issue classifier.
2. Scinder IPC par domaine.
3. Extraire le runtime renderer en planner/queue/reducer.
4. Seulement ensuite preparer la chirurgie `src/`.
