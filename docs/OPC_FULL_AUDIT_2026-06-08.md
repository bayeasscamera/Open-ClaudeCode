# Audit complet OPC - 2026-06-08

## Verdict global

OPC est utilisable en environnement de developpement local et son application Electron dispose d'une base solide: sandbox Electron active, IPC structure, bridge provider local authentifie, redaction de secrets, tests desktop nombreux, smokes UI/visual disponibles.

Le projet n'est pas encore pret pour une stabilite production. Les principaux blocages sont l'architecture a deux verites (`package/cli.js` execute en production contre `src/` restaure mais non construit), la CI trop etroite, la distribution macOS non notarisee, la persistance de secrets en clair quand `safeStorage` est indisponible, et plusieurs ecarts de fiabilite/UX autour des providers, de SQLite et du renderer.

## Verifications executees

| Commande | Resultat |
| --- | --- |
| `node --version` | `v24.13.0` |
| `npm --version` | `11.6.2` |
| `node package/cli.js --version` | `2.1.88 (Claude Code)` |
| `npm run typecheck:refactor` | OK |
| `npm --prefix desktop test` | OK, `307` tests passent |
| `npm run verify:ci` | OK, audit + typecheck partiel + `307` tests |
| `npm audit --audit-level=moderate --omit=optional` | OK, `0` vulnerabilite |
| `npm --prefix desktop run audit:security` | OK, `0` vulnerabilite |
| `npm outdated --json` | `@types/node` `25.9.1 -> 25.9.2` |
| `npm --prefix desktop outdated --json` | `electron` `39.8.10 -> 42.3.3`, `electron-builder` `26.8.1 -> 26.15.2` |
| `npm --prefix desktop run test:ui` | OK apres `npm rebuild electron`; avant rebuild, binaire Electron absent dans `node_modules/electron/dist` |
| `npm --prefix desktop run test:visual` | OK apres `npm rebuild electron`; 8 captures, contraste >= seuil |

Note: les tests SQLite affichent `ExperimentalWarning: SQLite is an experimental feature`, ce qui confirme que la BDD durable depend d'une API Node encore experimentale dans ce runtime.

## Cartographie dossier par dossier

### Racine

- `package.json`: paquet prive `opc-desktop`, mais `main` pointe vers `electron/main.cjs` alors que l'application reelle vit dans `desktop/electron/main.cjs`. Les scripts racine ne font qu'un typecheck partiel et deleguent `verify:ci` a `desktop/`.
- `tsconfig.check.json`: ne couvre que `src/typecheck/**/*.d.ts`, `src/query/recoveryPolicy.ts` et quelques fichiers `src/bridge/*`. La majorite des ~1900 fichiers `src/` n'est pas typecheckee.
- `.github/workflows/desktop-verify.yml`: CI macOS limitee a `desktop/npm ci` puis `npm run verify:ci`.
- `.mcp.json`: configuration locale `http://localhost:49453/mcp` versionnee.
- `README.md`: documentation Open-ClaudeCode en chinois, pas documentation OPC Desktop.

### `package/`

- Contient le CLI reel execute par l'application: `package/cli.js`, version `2.1.88`.
- `package/package.json` declare `@anthropic-ai/claude-code`, pas OPC.
- `package/cli.js.map` fait 57 Mo et n'est pas embarque dans le build desktop, mais reste dans le repo.
- Fonctionnel en runtime, mais ce dossier est un artefact compile, pas une source maintenable.

### `src/`

- Source TypeScript restauree, large et partiellement modifiee.
- Plusieurs exports SDK sont explicitement non implementes, par exemple `src/entrypoints/agentSdkTypes.ts:73-121` et suivants.
- `src/entrypoints/mcp.ts:62`, `src/entrypoints/mcp.ts:103`, `src/entrypoints/mcp.ts:136` portent encore des TODO de surface MCP.
- Les tests `desktop/test/srcRefactorGates.test.cjs` et `desktop/test/srcBridgeRefactorGates.test.cjs` verifient surtout des extractions textuelles/refactor gates, pas un comportement runtime complet.

### `desktop/electron/`

- Point d'entree reel: `desktop/electron/main.cjs`.
- Le runtime execute `package/cli.js` via `desktop/electron/main.cjs:76-83` et `desktop/electron/cliRunner.cjs:298-324`.
- Bonnes bases de securite: `desktop/electron/windowManager.cjs:23-40` active `sandbox`, `contextIsolation`, `nodeIntegration: false`, `webSecurity`.
- IPC decoupe par domaine, avec validations centrales dans `desktop/electron/ipcValidation.cjs`.
- Provider bridge local: `127.0.0.1`, token bearer aleatoire, limite de corps, rate limiter.
- Persistance: JSON prive + miroir SQLite/FTS.

### `desktop/renderer/`

- UI HTML/CSS/JS sans bundler, chargee par `desktop/renderer/index.html`.
- Beaucoup de logique applicative cote renderer: `desktop/renderer/controllers/runController.js` fait 1569 lignes, `settingsController.js` 880 lignes, `providerController.js` 785 lignes.
- Smokes UI/visual passent apres restauration locale du binaire Electron.
- UX globale fonctionnelle, mais plusieurs controles sont trompeurs ou fragiles: bouton Think visible mais desactive, permission dangereuse visible dans le topbar, panneaux longs.

### `desktop/test/`

- Couverture desktop importante: 307 tests passent.
- Couvre IPC, providers, persistence, renderer logic, permissions, support bundle, smokes accessibles.
- Limites: pas de compilation complete `src/`, pas de packaging/notarisation dans CI, smokes UI/visual hors `verify:ci`.

### `plugins/`

- 13 manifests `.claude-plugin/plugin.json`.
- Le desktop auto-charge seulement `gstack-workflows` via `desktop/electron/cliRunner.cjs:16` et `desktop/electron/cliRunner.cjs:50-54`.
- Le build embarque tous les plugins via `desktop/package.json:48-54`, ce qui augmente la surface distribuee.

### `docs/`

- Documentation technique presente (`OPC_SCALE_READINESS.md`, `OPC_SURGICAL_REFACTORING.md`, etc.), mais pas encore une documentation utilisateur/release coherente avec le produit.

## Fonctionnalites OK

- CLI embarque detecte et executable: `2.1.88`.
- Electron main window durcie: sandbox, isolation, no Node dans le renderer.
- IPC valide les payloads principaux, limite prompts, fichiers, services locaux, settings path.
- Bridge provider local authentifie par bearer token et non expose sur interface reseau externe.
- Providers: profils, import/export sans export de cle, journal provider sans secrets, retries et classifications d'erreurs couverts.
- Fichiers projet: selection explicite, realpath, exclusions `.env` et extensions de secrets, plafonds de taille.
- Etat durable: redaction avant persistence, JSON prive `0600`, SQLite mirror, support bundle redige.
- Tests desktop: `307/307` passent; smokes UI/visual passent apres rebuild Electron.
- Installation locale: `desktop/scripts/installApplications.cjs` copie dans `/Applications/OPC.app`, signe ad-hoc, verifie et lance smoke/visual.

## Fonctionnalites incompletes ou cassees

- Source `src/` non productisee: pas de build complet, pas de typecheck complet, SDK partiellement `not implemented`.
- Think non supporte: UI visible mais desactive globalement, capabilities forcees a `false`.
- Release macOS non production: target `dir`, signature ad-hoc locale, pas de notarisation.
- CI incomplete: pas de smokes UI/visual, pas de packaging, pas de signature/notarisation, pas de test source complet.
- Persistance secrets: fallback plaintext si Electron `safeStorage` est indisponible.
- Recherche SQLite: mauvaise tokenisation des accents (`réglages` devient `"r" "glages"`).
- Documentation produit incoherente: README parle Open-ClaudeCode, pas OPC Desktop.
- Installation locale actuelle avait un `node_modules/electron/dist` incomplet; `npm rebuild electron` a resolu, mais cela montre que les smokes dependent d'une installation native correcte.

## Problemes detailles

### 1. Source de verite runtime divisee

- Gravite: elevee
- Localisation: `desktop/electron/main.cjs:76-83`, `desktop/electron/cliRunner.cjs:298-324`, `package/package.json:1-22`, `tsconfig.check.json:22-37`
- Explication: l'application desktop lance `package/cli.js`, un artefact compile. Le dossier `src/` est restaure, massif, modifie, mais il n'est ni construit ni typechecke dans son ensemble. Une correction dans `src/` peut donc ne jamais atteindre le runtime desktop.
- Solution recommandee: choisir une source de verite. Soit produire `package/cli.js` depuis `src/`, soit declarer `src/` comme reference non runtime et isoler le code OPC actif dans `desktop/`.
- Exemple:
  ```json
  {
    "scripts": {
      "typecheck:src": "tsc -p tsconfig.src.json --noEmit",
      "build:cli": "tsc -p tsconfig.src.json && node scripts/build-cli.mjs"
    }
  }
  ```

### 2. CI insuffisante pour garantir la production

- Gravite: elevee
- Localisation: `.github/workflows/desktop-verify.yml:10-32`, `desktop/package.json:16-22`, `package.json:9-12`
- Explication: la CI execute audit, typecheck partiel et tests unitaires desktop. Elle ne lance pas `test:ui`, `test:visual`, packaging, install local, verification de signature, ni typecheck complet `src/`.
- Solution recommandee: separer CI rapide et release CI, mais faire tourner au moins smokes UI/visual et packaging sur les branches release.
- Exemple:
  ```yaml
  - run: npm --prefix desktop run test:ui
  - run: npm --prefix desktop run test:visual
  - run: npm --prefix desktop run package:mac
  - run: codesign --verify --deep --strict desktop/dist/mac-arm64/OPC.app
  ```

### 3. Distribution macOS non prete production

- Gravite: elevee
- Localisation: `desktop/package.json:28-69`, `desktop/scripts/installApplications.cjs:114-145`
- Explication: le build macOS cible uniquement `dir`. L'installation locale signe en ad-hoc avec `codesign --sign -`, puis verifie localement. Aucune configuration Developer ID, hardened runtime, entitlements, notarisation, DMG/ZIP release, ni validation Gatekeeper release.
- Solution recommandee: ajouter une pipeline release separee avec Developer ID, entitlements, notarisation Apple, artefact versionne et validation `spctl`.
- Exemple:
  ```json
  {
    "build": {
      "mac": {
        "target": ["dmg", "zip"],
        "hardenedRuntime": true,
        "gatekeeperAssess": false,
        "entitlements": "build/entitlements.mac.plist"
      },
      "afterSign": "scripts/notarize.cjs"
    }
  }
  ```

### 4. Secrets provider stockes en clair si `safeStorage` indisponible

- Gravite: elevee
- Localisation: `desktop/electron/providerSecretVault.cjs:18-23`, `desktop/electron/providerConfig.cjs:414-430`, `desktop/test/providerConfig.test.cjs:57-60`, `desktop/test/providerConfig.test.cjs:347`
- Explication: `seal()` retourne `{ apiKey: value }` quand `safeStorage` n'est pas disponible. Les tests l'enterrinent. Le fichier est prive `0600`, mais une cle API reste persistante en clair, et l'import de modeles peut dupliquer cette cle.
- Solution recommandee: fail-closed en production, ou exiger un backend secret fiable. Si le mode clair reste autorise en dev, afficher un avertissement bloquant et ne jamais l'utiliser pour une release.
- Exemple:
  ```js
  if (!canEncrypt() && app.isPackaged) {
    throw new Error('Stockage secret indisponible: configuration provider refusee en production.')
  }
  ```

### 5. Decouverte provider duplique la cle API dans chaque modele importe

- Gravite: moyenne
- Localisation: `desktop/electron/providerModelDiscovery.cjs:57-79`, `desktop/electron/providerModelDiscovery.cjs:171-177`
- Explication: chaque modele decouvert herite de `sourceProfile.apiKey`. Avec `safeStorage`, c'est chiffre par profil; sans `safeStorage`, la meme cle peut etre stockee en clair jusqu'a 80 fois.
- Solution recommandee: modeliser provider et modeles separement. Un profil modele devrait referencer un secret provider par id au lieu de recopier la cle.
- Exemple:
  ```js
  return {
    id: discovered.id,
    model: discovered.id,
    providerRef: sourceProfile.id,
    inheritAuth: true
  }
  ```

### 6. Versions Node/Electron/types incoherentes

- Gravite: moyenne
- Localisation: `.github/workflows/desktop-verify.yml:21-25`, `package.json:13-16`, `desktop/package.json:24-27`, `desktop/electron/persistence/sqliteStateStore.cjs:6-12`
- Explication: CI utilise Node 22, l'audit local a tourne sous Node 24, Electron 39 embarque Electron/Node 22, mais `@types/node` est en 25.x. Le typecheck peut accepter des APIs absentes du runtime. En plus `node:sqlite` est experimental.
- Solution recommandee: aligner `@types/node` sur le Node embarque par Electron/CI ou ajouter un test runtime qui interdit les APIs hors support.
- Exemple:
  ```json
  {
    "devDependencies": {
      "@types/node": "^22.18.0"
    }
  }
  ```

### 7. `node:sqlite` experimental et reconciliation d'etat fragile

- Gravite: moyenne
- Localisation: `desktop/electron/persistence/sqliteStateStore.cjs:6-12`, `desktop/electron/desktopStateStore.cjs:159-182`, `desktop/renderer/app.js:577-586`
- Explication: SQLite est utilise via `node:sqlite`, encore experimental. Le read prefere SQLite si lisible, sinon JSON. Le renderer charge d'abord `localStorage`, puis le disque seulement si aucun etat local exploitable n'existe. Il n'y a pas de reconciliation par `updatedAt` entre localStorage, JSON et SQLite.
- Solution recommandee: ajouter une version d'etat avec timestamp/source, choisir l'etat le plus recent valide, et rendre SQLite optionnel mais diagnostique clairement.
- Exemple:
  ```js
  const candidates = [localState, sqliteState, jsonState].filter(isValidState)
  const chosen = candidates.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0]
  ```

### 8. Reindexation SQLite complete a chaque sauvegarde

- Gravite: moyenne
- Localisation: `desktop/electron/persistence/sqliteStateStore.cjs:237-252`, `desktop/electron/persistence/sqliteStateStore.cjs:406-428`, `desktop/renderer/state/stateStore.js:197-217`
- Explication: chaque save supprime et reinserre toutes les tables structurees. Le renderer debounce a 250 ms. Les bornes limitent le dommage, mais les gros historiques/projets peuvent provoquer I/O inutile et jank.
- Solution recommandee: ecrire les snapshots complets moins souvent, et faire des upserts incrementaux pour chats/messages/projets modifies.
- Exemple:
  ```sql
  INSERT INTO messages (...) VALUES (...)
  ON CONFLICT(id) DO UPDATE SET json = excluded.json, createdAt = excluded.createdAt;
  ```

### 9. Recherche SQLite defaillante avec accents

- Gravite: moyenne
- Localisation: `desktop/electron/persistence/sqliteStateStore.cjs:84-89`
- Explication: `ftsQuery('réglages projet')` produit `"r" "glages" "projet"`. Les recherches durables en francais peuvent donc rater des messages/fichiers accentues, alors que la recherche renderer a une logique accent-insensible distincte.
- Solution recommandee: normaliser en NFD et retirer les diacritiques avant FTS, ou utiliser une tokenizer Unicode adaptee.
- Exemple:
  ```js
  const normalized = String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
  ```

### 10. Import d'etat/projet peu schema-valide cote main

- Gravite: moyenne
- Localisation: `desktop/electron/desktopStateStore.cjs:49-60`, `desktop/electron/ipc/projectIpc.cjs:88-106`
- Explication: l'import de state backup n'a pas de plafond de taille et retourne l'objet JSON parse. L'import projet a un plafond 2 Mo mais pas de schema strict. La normalisation renderer reduit le risque apres coup, mais le main process devrait rejeter les formes invalides plus tot.
- Solution recommandee: valider taille, version, champs, tableaux et compteurs dans le main process.
- Exemple:
  ```js
  if (stat.size > MAX_STATE_BACKUP_BYTES) throw new Error('Sauvegarde trop volumineuse.')
  if (!Array.isArray(state.chats) || !Array.isArray(state.projects)) throw new Error('Schema OPC invalide.')
  ```

### 11. Garde workspace trust sans realpath

- Gravite: moyenne
- Localisation: `desktop/electron/ipcValidation.cjs:190-207`, `desktop/electron/ipcValidation.cjs:209-245`
- Explication: `workspaceTrustAllowed()` compare des chemins resolus par `path.resolve`, mais pas par `fs.realpathSync`. Une racine ou un cwd via symlink peut fausser la relation "inside workspace". `validateSettingsPath()` utilise bien realpath, donc la correction est connue.
- Solution recommandee: realpath sur `cwd` et `trustedWorkspaceRoot` quand ils existent; refuser le bypass si le realpath echoue.
- Exemple:
  ```js
  const root = fs.realpathSync(trustedWorkspaceRoot)
  const target = fs.realpathSync(cwd)
  const relative = path.relative(root, target)
  ```

### 12. Mode Think visible mais desactive dans toute la pile

- Gravite: moyenne
- Localisation: `desktop/renderer/index.html:97-99`, `desktop/renderer/app.js:87-128`, `desktop/electron/providerProfilePolicy.cjs:25-37`, `desktop/electron/providerProfilePolicy.cjs:190-223`, `desktop/electron/providerConfig.cjs:126-139`
- Explication: le bouton Think existe dans l'UI, mais `state.settings.thinkEnabled` est force a `false`; les capabilities provider forcent `thinking:false`; les extra bodies Think sont retires. C'est une fonctionnalite inachevee/trompeuse.
- Solution recommandee: soit retirer le bouton et les textes Think, soit l'implementer par modele avec validation de capabilities et tests provider.
- Exemple:
  ```js
  const supported = providerController.selectedCapabilities().thinking === true
  els.think.disabled = !supported
  ```

### 13. Timeout provider minimum trop long

- Gravite: moyenne
- Localisation: `desktop/electron/providerConfig.cjs:589-590`, `desktop/electron/providerProfilePolicy.cjs:276-288`
- Explication: `sanitizeProfilePayload()` force `timeoutMs >= 300000`; `requestTimeout()` retourne au moins le fallback 300s. Les providers morts peuvent donc bloquer longtemps et donner l'impression d'un spinner infini.
- Solution recommandee: accepter des timeouts courts pour checks et runtime, avec bornes separees et UI explicite.
- Exemple:
  ```js
  timeoutMs: number(payload.timeoutMs, 60000, { min: 5000, max: 1800000 })
  ```

### 14. CSP locale et liens Markdown a resserrer

- Gravite: moyenne
- Localisation: `desktop/renderer/index.html:5-8`, `desktop/electron/cspInterceptor.cjs:16-23`, `desktop/renderer/services/markdownRenderer.js:9-16`, `desktop/electron/windowManager.cjs:43-46`
- Explication: la CSP initiale autorise `connect-src http://127.0.0.1:*` avant remplacement par le port exact du bridge. Les liens Markdown assignent `href` sans liste blanche de scheme. `setWindowOpenHandler` bloque deja les fenetres non sures, mais mieux vaut bloquer au rendu.
- Solution recommandee: charger avec un CSP exact des le premier rendu, ou utiliser un protocol custom; filtrer les liens a `https:` et http local autorise.
- Exemple:
  ```js
  const url = new URL(raw, 'https://invalid.local')
  if (!['https:', 'http:'].includes(url.protocol)) return '#'
  ```

### 15. Descripteur fichier non ferme si lecture projet echoue

- Gravite: faible
- Localisation: `desktop/electron/projectFiles.cjs:282-305`
- Explication: `fs.openSync()` est suivi de `fs.readSync()` puis `fs.closeSync()`, sans `finally`. Si `readSync()` jette une exception, le fd reste ouvert.
- Solution recommandee: fermer dans `finally`.
- Exemple:
  ```js
  const fd = fs.openSync(safePath, 'r')
  try {
    const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, 0)
  } finally {
    fs.closeSync(fd)
  }
  ```

### 16. Modules morts ou dupliques avec comportement divergent

- Gravite: moyenne
- Localisation: `desktop/stateRules.js:36-51`, `desktop/renderer/state/stateRules.js:36-61`, `desktop/providerProfilePolicy.cjs`, `desktop/electron/providerProfilePolicy.cjs`
- Explication: `desktop/stateRules.js` n'est pas charge par `index.html`, mais contient une logique ancienne qui peut remettre `bypassPermissions`. `desktop/providerProfilePolicy.cjs` est un doublon ancien non importe; le module actif est `desktop/electron/providerProfilePolicy.cjs`.
- Solution recommandee: supprimer les doublons morts ou les deplacer sous `archive/` non embarque; ajouter un test qui interdit les copies divergentes.
- Exemple:
  ```js
  assert.equal(require.resolve('../electron/providerProfilePolicy.cjs').includes('/electron/'), true)
  ```

### 17. Observabilite crash reporter trompeuse

- Gravite: faible
- Localisation: `desktop/electron/crashReporter.cjs:12-27`, `desktop/electron/main.cjs:47`
- Explication: le code calcule et logge `/tmp/opc-desktop-crashes`, mais ne configure pas explicitement ce chemin. Les uploads sont desactives, donc une release n'a pas de collecte centralisee ni de chemin garanti.
- Solution recommandee: configurer `app.setPath('crashDumps', crashDir)` avant `crashReporter.start()` et exposer le chemin reel via doctor/support bundle.

### 18. Maintenabilite renderer trop concentree

- Gravite: moyenne
- Localisation: `desktop/renderer/controllers/runController.js` (1569 lignes), `desktop/renderer/controllers/settingsController.js` (880 lignes), `desktop/renderer/controllers/providerController.js` (785 lignes), `desktop/renderer/css/settings.css` (1916 lignes)
- Explication: les tests sont nombreux, mais la logique d'execution, queue, permissions, provider preflight, auto-continue et checkpoints cohabitent dans un seul controleur. Les regressions deviennent difficiles a isoler.
- Solution recommandee: extraire progressivement en services purs deja testes: queue, permission decision, provider preflight, completion guard, checkpoint/retry, UI adapters.

### 19. Documentation produit incoherente

- Gravite: faible
- Localisation: `README.md:1-29`, `README.md:33-80`, `package.json:2-8`, `desktop/package.json:2-8`
- Explication: le README presente Open-ClaudeCode et le CLI Anthropic restaure. Le produit livre est OPC Desktop. Les deux paquets racine et desktop portent le meme nom, et le `main` racine pointe vers un chemin inexistant.
- Solution recommandee: creer un README OPC Desktop, separer documentation source restauree, et corriger le `main` racine ou le retirer.

### 20. Configuration MCP locale versionnee

- Gravite: faible
- Localisation: `.mcp.json:1-7`
- Explication: le repo contient un endpoint local machine-specific `http://localhost:49453/mcp`. Cela peut generer des erreurs chez d'autres developpeurs et documente un port local fixe.
- Solution recommandee: remplacer par `.mcp.example.json` ou ignorer `.mcp.json`.

### 21. Dependances depassees

- Gravite: faible a moyenne
- Localisation: `package.json:13-16`, `desktop/package.json:24-27`
- Explication: `electron` est en `39.8.10` alors que npm indique `42.3.3`; `electron-builder` `26.8.1` peut monter en `26.15.2`; `@types/node` a un patch `25.9.2`. L'ecart Electron majeur peut contenir correctifs Chromium/Electron importants.
- Solution recommandee: faire une branche de mise a jour Electron avec smokes UI/visual, verifier breakages Electron 40-42, puis monter `electron-builder`.

### 22. Bridge provider renvoie 500 pour configuration manquante

- Gravite: faible
- Localisation: `desktop/electron/providerBridge.cjs:79-85`
- Explication: un provider sans cle renvoie HTTP 500, alors que c'est une erreur de configuration locale. Cela rend les diagnostics externes moins clairs.
- Solution recommandee: retourner 401 ou 400 avec code machine-readable `provider_not_configured`.

### 23. Build embarque tous les plugins mais n'en auto-charge qu'un

- Gravite: faible
- Localisation: `desktop/package.json:48-54`, `desktop/electron/cliRunner.cjs:16`, `desktop/electron/cliRunner.cjs:50-54`
- Explication: tous les plugins sont copies dans les resources, mais seul `gstack-workflows` est passe au CLI par defaut. Cela gonfle le bundle et augmente la surface auditee sans valeur runtime claire.
- Solution recommandee: embarquer uniquement les plugins utilises par defaut, ou documenter un mecanisme d'activation explicite.

## Priorites classees

1. Stabiliser la source de verite: decider si `src/` produit le CLI ou si `package/cli.js` reste l'artefact officiel.
2. Fermer les risques secrets: interdire le plaintext en release et eviter la duplication de cles par modele.
3. Ajouter une vraie CI release: typecheck complet ou source ignoree clairement, smokes UI/visual, packaging, codesign, notarisation.
4. Corriger le pipeline macOS production: Developer ID, hardened runtime, entitlements, notarisation, validation Gatekeeper.
5. Aligner Node/Electron/@types et encadrer `node:sqlite` experimental.
6. Rendre les providers plus robustes: timeout configurable, codes d'erreurs semantiques, diagnostic de configuration clair.
7. Nettoyer les doublons morts et la documentation produit.
8. Refactorer le renderer par extraction de services purs autour de `runController`.
9. Ameliorer la recherche durable et la reconciliation localStorage/SQLite/JSON.
10. Finaliser UX: Think retire ou implemente, permissions dangereuses mieux encadrees, docs utilisateur.

## Plan d'action production

### Phase 1 - Stabilisation critique

- Definir une ADR: `src` source de build ou source restauree non runtime.
- Ajuster `package.json` racine: retirer/corriger `main`, nommer clairement les packages.
- Ajouter un job CI `desktop-smoke` avec `test:ui` et `test:visual`.
- Ajouter un job CI `package-mac` qui produit `OPC.app` et lance au minimum `codesign --verify`.
- Changer `providerSecretVault`: fail-closed en app packagée si encryption indisponible.
- Modifier `providerModelDiscovery` pour ne plus recopier les cles API dans chaque modele.

### Phase 2 - Fiabilite runtime

- Aligner runtime Node: CI, Electron, `@types/node`, documentation dev.
- Encapsuler SQLite derriere une interface stable; ajouter test de fallback sans `node:sqlite`.
- Ajouter reconciliation `localStorage`/JSON/SQLite par `updatedAt`.
- Remplacer la reindexation SQLite globale par upserts incrementaux.
- Corriger FTS accent-insensitive.
- Ajouter schemas d'import state/projet avec plafonds de taille.

### Phase 3 - UX et providers

- Retirer le bouton Think ou activer le support par provider avec test de capability.
- Permettre timeouts provider courts et visibles dans l'UI.
- Remplacer les erreurs provider 500 locales par codes config explicites.
- Reserrer CSP et sanitization des liens Markdown.
- Ameliorer l'affichage permission `bypassPermissions`: confirmation persistante, avertissement plus visible, et audit dans support bundle.

### Phase 4 - Release macOS

- Ajouter entitlements, hardened runtime, Developer ID signing.
- Ajouter notarisation Apple dans `electron-builder`.
- Produire DMG/ZIP versionnes.
- Verifier `spctl -a -vv -t exec OPC.app` en CI release.
- Ajouter support bundle/crash dumps avec chemin reel et collecte locale documentee.

### Phase 5 - Maintenance durable

- Supprimer `desktop/stateRules.js` et `desktop/providerProfilePolicy.cjs` s'ils sont morts.
- Scinder `runController.js` en modules purs testes.
- Reduire `settings.css` et les controles settings en composants/sections testables.
- Remplacer le README racine par une documentation OPC Desktop en francais/anglais, avec une section separee sur l'origine Open-ClaudeCode.
- Documenter les commandes de verification: `verify:ci`, `test:ui`, `test:visual`, `release:local`, notarisation.

## Etat final de l'audit

Le projet a une base locale solide et testee, mais la stabilite production depend d'abord de decisions d'architecture et de distribution. Les corrections prioritaires ne sont pas des micro-bugs: elles concernent la chaine source -> build -> test -> release -> secrets. Une fois ces points verrouilles, les risques restants deviennent principalement des refactors de maintenabilite et des ameliorations UX/provider.
