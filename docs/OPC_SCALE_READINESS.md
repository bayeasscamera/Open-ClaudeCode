# OPC Scale Readiness Plan

Derniere mise a jour: 2026-06-05 - vague 8 source-only appliquee

## Plan d'action - 8 axes

### 1. Stabiliser la distribution macOS

- Probleme actuel: le packaging local fonctionne, mais la distribution reste en signature ad hoc et le script historique `script/build_and_run.sh` pouvait quitter/remplacer l'app automatiquement.
- Impact: risque de perte d'etat en developpement, confiance utilisateur limitee, installation moins previsible.
- Solution: unifier les chemins de release autour de `desktop/scripts/installApplications.cjs`, refuser l'installation si `/Applications/OPC.app` tourne, ajouter Developer ID, notarization, checksums et artefacts release.
- Difficulte: moyenne.
- Gain attendu: installation fiable, distribution credible, support reduit.
- Priorite: critique.

### 2. Migrer la persistance vers un store local versionne

- Probleme actuel: le renderer persiste encore des structures globales via `localStorage` puis JSON local, avec des plafonds defensifs.
- Impact: ralentissements et risque de corruption lorsque les conversations, projets, fichiers indexes et checks provider grossissent.
- Solution: introduire SQLite derriere `StateRepository`, double-write JSON/SQLite, migrations versionnees, rollback, puis bascule progressive.
- Difficulte: elevee.
- Gain attendu: performance, robustesse, recherche locale, meilleure montee en volume.
- Priorite: critique.

### 3. Ajouter SQLite FTS pour l'historique et les fichiers projet

- Probleme actuel: la recherche repose sur des index texte bornes et en memoire.
- Impact: UX de recherche limitee, cout CPU cote renderer, scalabilite faible pour gros projets.
- Solution: tables FTS pour messages, projets, fichiers, provider history et support metadata.
- Difficulte: moyenne a elevee.
- Gain attendu: recherche instantanee et meilleur usage expert.
- Priorite: haute.

### 4. Optimiser l'UI pour gros volumes

- Probleme actuel: les listes de messages, conversations, fichiers, logs et providers peuvent croitre au-dela du confort DOM.
- Impact: jank, consommation memoire, scroll fragile, impression de lenteur.
- Solution: virtualiser timeline, recents, fichiers projet et logs; conserver les ancres de scroll et tester les layouts Electron.
- Difficulte: moyenne.
- Gain attendu: UI fluide sur longues sessions.
- Priorite: haute.

### 5. Renforcer l'observabilite locale

- Probleme actuel: Doctor et support bundle existent, mais les metriques crash/performance restent limitees.
- Impact: diagnostic plus lent chez les utilisateurs et correlation difficile entre provider, runtime et UI.
- Solution: ajouter spans runtime/provider, latence premier flux, taille prompt, troncature contexte, crash metadata et timings de rendu dans les exports rediges.
- Difficulte: moyenne.
- Gain attendu: resolution incidents plus rapide et priorisation produit plus factuelle.
- Priorite: haute.

### 6. Typage et schemas partages pour les contrats IPC

- Probleme actuel: une partie du desktop reste en CommonJS avec contrats implicites entre preload, main process et renderer.
- Impact: regressions de payload, refactors plus lents, surface de securite plus difficile a auditer.
- Solution: schemas partages pour IPC, provider config, support bundle et runtime events; migration TypeScript domaine par domaine.
- Difficulte: elevee.
- Gain attendu: maintenabilite, securite et testabilite.
- Priorite: haute.

### 7. Refactoriser le coeur CLI sous caracterisation

- Probleme actuel: plusieurs modules racine restent tres volumineux, notamment `src/cli/print.ts`, `src/utils/messages.ts`, `src/utils/sessionStorage.ts`, `src/main.tsx`, `src/query.ts` et `src/bridge/bridgeMain.ts`.
- Impact: cout de changement eleve, risque de regression agent, onboarding difficile.
- Solution: tests de caracterisation d'abord, puis extraction progressive de modules profonds: query loop, recovery policy, bridge session, polling, shell safety.
- Difficulte: elevee.
- Gain attendu: evolution durable des agents et baisse du risque sur les changements complexes.
- Priorite: haute.

### 8. Durcir securite, accessibilite et UX provider

- Probleme actuel: la base est meilleure, mais il reste des gaps: sandbox override, audit accessibilite automatise incomplet, diagnostic provider encore trop disperse.
- Impact: risque de securite en distribution, exclusion d'utilisateurs clavier/lecteurs, support provider plus couteux.
- Solution: refuser `no-sandbox` en app packagee, tests focus/contraste/reduced motion, assistant Provider Doctor, rollback provider events, messages d'action directs.
- Difficulte: faible a moyenne.
- Gain attendu: confiance, accessibilite, baisse du support.
- Priorite: haute.

## Roadmap detaillee

### Sprint 0 - Gates immediats

1. Aligner tous les scripts d'installation sur le garde "app non lancee".
2. Refuser l'override sandbox dans les builds packages.
3. Remplacer le workflow GitHub par `npm run verify:ci`.
4. Mettre a jour ce tracker avec les priorites CTO.
5. Verifier: `node --test` cible, `bash -n`, `npm --prefix desktop run verify:ci`.
6. Ajouter backup complet state local avant les migrations lourdes.
7. Ajouter journal provider lisible dans Settings et dans le bundle support.
8. Ajouter telemetry provider/runtime dans support bundle.

### Sprint 1 - Release fiable

1. Ajouter configuration Developer ID dans `electron-builder`.
2. Ajouter notarization macOS et verification Gatekeeper.
3. Produire DMG/zip avec checksums SHA-256.
4. Publier les artefacts dans GitHub Actions.
5. Ajouter un Doctor check "release trust" pour signature/notarization.

### Sprint 2 - Persistance SQLite

1. Designer le schema local: chats, messages, projects, project_files, provider_checks, provider_events, long_tasks.
2. Ajouter l'adapter SQLite derriere `StateRepository`.
3. Implementer double-write JSON + SQLite.
4. Ajouter migration et rollback.
5. Migrer provider health et long tasks en premier.

### Sprint 3 - FTS et recherche scale-ready

1. Ajouter FTS messages et project_files.
2. Migrer la recherche projet vers FTS.
3. Ajouter recherche historique conversation.
4. Ajouter tests sur gros volumes synthetiques.
5. Exposer les resultats avec snippets et scores.

### Sprint 4 - UI performance

1. Mesurer temps de rendu timeline et listes.
2. Virtualiser messages et logs.
3. Virtualiser recents et fichiers projet.
4. Verifier scroll anchoring, selection texte et rendu markdown.
5. Ajouter smoke visuel gros volume.

### Sprint 5 - Observabilite et support

1. Ajouter spans runtime: queued, preflight, first stream, tool activity, completion.
2. Ajouter spans provider: request start, retry, timeout, prompt truncation, context length.
3. Ajouter crash metadata au support bundle.
4. Ajouter redaction de toutes les nouvelles surfaces.
5. Ajouter Doctor summary par severite.

### Sprint 6 - Contrats typés

1. Definir schemas IPC partages.
2. Migrer provider IPC.
3. Migrer diagnostics/support IPC.
4. Migrer runtime IPC.
5. Generer tests de compatibilite preload.

### Sprint 7 - Coeur CLI

1. Ajouter tests de caracterisation query/bridge/shell.
2. Extraire `queryLoop`, `toolTurn`, `attachmentTurn`.
3. Extraire `bridgeSession`, `pollLoop`, `shutdownCoordinator`.
4. Refactoriser Bash/PowerShell safety avec tables partagees.
5. Garder chaque extraction reversible et couverte.

### Sprint 8 - Accessibilite et UX provider

1. Ajouter tests clavier/focus trap pour dialogs.
2. Ajouter tests reduced motion et contrastes.
3. Ajouter panneau Provider Doctor avec actions directes.
4. Afficher le journal provider et proposer rollback.
5. Tester parcours provider complet: ajouter, tester, reparer, supprimer, restaurer.

## Quick wins

| Quick win | Effort | Gain | Statut |
| --- | --- | --- | --- |
| Aligner `script/build_and_run.sh` avec le garde install | faible | evite remplacement pendant execution | fait |
| Refuser `OPC_DISABLE_ELECTRON_SANDBOX` en app packagee | faible | durcit la distribution | fait |
| Utiliser `npm run verify:ci` dans GitHub Actions | faible | CI plus proche des gates locaux | fait |
| Ajouter lecture UI du journal provider | moyenne | meilleure auditabilite provider | fait |
| Ajouter metriques premier flux/provider latency | moyenne | diagnostic performance | fait |
| Ajouter test smoke gros historique | moyenne | detecte jank early | fait |
| Ajouter export/import backup state complet | moyenne | protege migrations SQLite | fait |
| Ajouter warning Doctor pour app non notariee | faible | clarte release | fait |
| Seuil auto-router configurable | faible | controle plus fin des bascules provider | fait |
| Permissions strictes pour blocage critique | faible | evite les payloads CLI dangereux | fait |
| Diagnostic runtime provider avec fallback compatible | moyenne | baisse des blocages provider repetes | fait |
| Provider Doctor actionnable dans Settings | moyenne | explique blocage, fallback et action suivante | fait |
| Politique contexte modele avant envoi | faible | evite petits contextes et fallback tardif | fait |
| Worker runtime agentique isole | moyenne | suit phase, blocage, verification et reprise par tache | fait |
| Workers actionnables + preuves outils natives | moyenne | reprend/verifie/interrompt une tache sans repartir de zero | fait |

## Vague 2 - Statut applique

| Livraison | Zone | Verification | Statut |
| --- | --- | --- | --- |
| Journal provider lisible dans Settings | `provider-events.jsonl`, Settings Providers | `providerConfig.test.cjs` | fait |
| Telemetry provider/runtime dans bundle support | `supportBundle.cjs` | `supportBundle.test.cjs` | fait |
| Smoke gros historique borne | `stateStore`, `StateRepository` | `rendererStateRepository.test.cjs` | fait |
| Export/import backup state complet | IPC state + Settings Donnees | `ipcHandlers.test.cjs` | fait |
| Warning Doctor signature/notarization | `doctor.cjs` | `doctor.test.cjs` | fait |

## Vague 3 - Statut applique

| Livraison | Zone | Verification | Statut |
| --- | --- | --- | --- |
| Miroir SQLite local + lecture prioritaire | `desktopStateStore`, `sqliteStateStore` | `desktopStateStore.test.cjs` | fait |
| Schema persistance v2 messages + ledger agentique | `stateSchema.cjs` | `stateSchema.test.cjs` | fait |
| Recherche FTS project_files | `sqliteStateStore` | `desktopStateStore.test.cjs` | fait |
| Contrat IPC partage main/preload | `ipcContract.cjs`, `preload.cjs` | `ipcContract.test.cjs`, `ipcHandlers.test.cjs` | fait |
| Support bundle v2 agent/context/router/artifacts | `supportBundle.cjs` | `supportBundle.test.cjs` | fait |
| Accessibilite runtime: conversation, listes, composer, logs | `index.html` | `accessibilitySmoke.test.cjs` | fait |

## Vague 4 - Statut applique

| Livraison | Zone | Verification | Statut |
| --- | --- | --- | --- |
| Recherche FTS messages avec metadata chat | `sqliteStateStore` | `desktopStateStore.test.cjs` | fait |
| Recherche state IPC partagee preload/main | `ipcContract.cjs`, `clipboardStateIpc.cjs`, `preload.cjs` | `ipcContract.test.cjs`, `ipcHandlers.test.cjs` | fait |
| Fallback recherche JSON si SQLite absent/corrompu | `desktopStateStore` | `desktopStateStore.test.cjs` | fait |

## Vague 5 - Statut applique source-only

| Livraison | Zone | Verification | Statut |
| --- | --- | --- | --- |
| Mode permissions strictes bloque les actions critiques avant CLI | `advancedPermissionPolicy`, `runRequestPlanner`, `runController` | `rendererRunTaskModels.test.cjs`, `rendererRuntime.test.cjs` | fait |
| Seuil auto-router provider configurable et persiste | `stateStore`, `stateRules`, `settingsHelpers`, Settings Runtime | `rendererSettings.test.cjs`, `rendererState.test.cjs`, `rendererRunTaskModels.test.cjs` | fait |
| Diagnostic provider runtime detecte outils manquants, contexte insuffisant et fallback compatible | `providerRuntimeDiagnostics`, `renderController` | `rendererRunTaskModels.test.cjs` | fait |
| Matrice d'evaluation agentique completee avec preuves attendues | `agenticEvaluationScenarios` | `rendererRunTaskModels.test.cjs` | fait |
| Installation non executee pendant cette vague | workflow local | app en cours conservee, aucun rebuild/install lance | fait |

## Vague 6 - Statut applique source-only

| Livraison | Zone | Verification | Statut |
| --- | --- | --- | --- |
| Politique contexte modele par profil avant envoi | `agentContextBudget` | `rendererRunTaskModels.test.cjs` | fait |
| Provider Doctor actionnable: issues, fallback, actions | `providerController` | `rendererRuntime.test.cjs` | fait |
| Provider Doctor visible dans Settings Doctor | `settingsController` | `rendererSettings.test.cjs`, `accessibilitySmoke.test.cjs` | fait |
| Installation non executee pendant cette vague | workflow local | tests source uniquement | fait |

## Vague 7 - Statut applique source-only

| Livraison | Zone | Verification | Statut |
| --- | --- | --- | --- |
| Worker runtime agentique isole par tache | `agentWorkerRuntime`, `runRuntimeState` | `rendererRunTaskModels.test.cjs`, `rendererRuntime.test.cjs` | fait |
| Persistance des workers et interruption au redemarrage | `stateStore` | `rendererState.test.cjs` | fait |
| Telemetrie worker dans support bundle et dashboard qualite | `supportBundle.cjs`, `runtimeQualityDashboard` | `supportBundle.test.cjs`, `rendererRunTaskModels.test.cjs` | fait |
| Chargement renderer package et accessibilite conservee | `index.html` | `accessibilitySmoke.test.cjs` | fait |
| Installation non executee pendant cette vague | workflow local | app en cours conservee, aucun rebuild/install lance | fait |

## Vague 8 - Statut applique source-only

| Livraison | Zone | Verification | Statut |
| --- | --- | --- | --- |
| Workers visibles et actionnables dans l'inspecteur | `inspectorView`, `renderController` | `rendererRunTaskModels.test.cjs` | fait |
| Reprise, verification et interruption ciblees par worker | `agentWorkerRuntime`, `runRuntimeState`, `runController` | `rendererRunTaskModels.test.cjs`, `rendererRuntime.test.cjs` | fait |
| Auto-continue enrichi avec contexte worker | `runController`, `agentWorkerRuntime` | `rendererRuntime.test.cjs` | fait |
| Pont de preuves outils natives | `agentToolEvidence`, `agentToolRegistry`, `agentVerificationEngine` | `rendererRunTaskModels.test.cjs` | fait |
| Benchmark agentique local et scenarios worker | `agenticEvaluationScenarios` | `rendererRunTaskModels.test.cjs` | fait |
| Installation non executee pendant cette vague | workflow local | tests source uniquement, app en cours conservee | fait |

## Risques techniques a anticiper

### Migration SQLite

- Risque: perte ou duplication d'etat utilisateur.
- Mitigation: export avant migration, double-write, checksum, rollback JSON, tests sur snapshots reels anonymises.

### Refactor coeur CLI

- Risque: regression subtile dans les boucles agent, outils shell ou resume.
- Mitigation: caracterisation avant extraction, petits modules profonds, verification CLI packagee.

### Notarization macOS

- Risque: blocage par certificats, entitlements, hardened runtime ou CI secrets.
- Mitigation: prototype sur branche release, verification `spctl`, documentation des secrets CI.

### Virtualisation UI

- Risque: casse du scroll anchoring, selection texte, rendu markdown ou streaming.
- Mitigation: tests DOM-free + smoke visuel gros volume + regression selection/scroll.

### Observabilite

- Risque: logs trop bavards ou fuite de secrets.
- Mitigation: budget de logs, redaction recursive, tests anti-secrets sur support bundle.

### Sandbox et permissions

- Risque: des modes dev cassent si le sandbox est force.
- Mitigation: autoriser l'override seulement hors build package, log explicite, tests unitaires.

### Provider UX

- Risque: actions automatiques modifient des configs utilisateur.
- Mitigation: journal provider, seuil auto-router explicite, confirmation pour mutations destructives, rollback, tests de non-restauration des providers supprimes.

### Runtime agentique strict

- Risque: le mode strict peut bloquer une action critique pourtant volontaire.
- Mitigation: mode desactive par defaut, message actionnable, audit `permission-blocked`, outils read-only conserves pour analyser avant de relancer.

### CI plus stricte

- Risque: ralentissement pipeline ou flakes Electron.
- Mitigation: `verify:ci` sans smoke visuel, smoke local macOS conserve pour release gates.

## Release gates

Avant une release desktop:

1. `npm --prefix desktop run verify:ci`.
2. `npm --prefix desktop run verify` sur macOS avec support Electron UI.
3. `./script/build_and_run.sh --verify`.
4. Verification signature/notarization.
5. Export support bundle et controle absence de secrets.

## Refactoring gates

Avant tout refactor structurel:

1. Ajouter un test de caracterisation.
2. Garder les canaux IPC compatibles avec `desktop/test/ipcHandlers.test.cjs`.
3. Ne pas refactoriser `src/query.ts`, `src/bridge/bridgeMain.ts` ou shell safety sans couverture dediee.
4. Garder les fichiers locaux sensibles en `0600`.
5. Verifier chaque etape avant de passer a la suivante.
