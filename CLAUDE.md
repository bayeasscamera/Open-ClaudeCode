# OPC — Base de Connaissances Projet (Claude)

> Base de connaissances persistante lue par Claude à chaque session démarrée dans ce dépôt.
> Centralise le contexte vital pour être opérationnel immédiatement, sans ré-explication.
> Toute erreur ou préférence durable doit être consignée ici (apprentissage itératif).

**Dernière mise à jour :** 2026-06-22 — **v6.0.0** (ajout Index rapide, profil session, pièges P1-P10, règles numérotées 1-12, section Design & UX)

---

## Index rapide

| Besoin | Aller à |
|---|---|
| Démarrer une session | §18 |
| Comprendre l'architecture | §1, §3 |
| Connaître la stack | §2 |
| Coder dans le loop agent | §7 + §16 |
| Écrire un plugin | §1, §7 |
| Modifier le shell Electron / IPC | §9, §13, §16 |
| Committer proprement | §11 |
| Déboguer un bug | §6 |
| Éviter un piège connu | §7.4 (P1-P10) |
| Vérifier avant PR | §10 |
| Sécurité | §13 |
| Mémoire & sauvegardes | §17 |

---

## 1. Identité du projet

OPC (Open Project Cockpit) est une **application desktop Electron + CLI Node/TypeScript** qui pilote un agent de coding autonome. Elle combine :

- une **boucle agentique** (act → observe → reason → repeat) de type ReAct ;
- une couche **Human-in-the-Loop** via IPC Electron ;
- un **système de plugins** inspiré de Claude Code ;
- un bridge **CLI ↔ Electron** avec streaming d'événements JSON-lines.

La couche `src/` est principalement un **vendoring/fork de Claude Code upstream**. Toute la valeur ajoutée OPC vit dans `src/utils/` (loop), `desktop/electron/` (IPC) et `plugins/`.

---

## 2. Stack technique

Versions précises dans `package.json` (racine + `desktop/`). Spécificités à retenir :

- **TypeScript strict** côté `src/`, **CommonJS `.cjs`** côté `desktop/electron/` (mélanger ESM dans `desktop/` casse Electron).
- **Trois `tsconfig` distincts**, tous `noEmit` (pas de bundle, `tsx` exécute directement) :

| Fichier | Périmètre |
|---|---|
| `tsconfig.check.json` | Typecheck global du refactor |
| `tsconfig.utils.json` | Coeur loop (`src/utils/`) |
| `tsconfig.loop-tests.json` | Tests loop (`src/utils/__tests__/`) |

- **Tests** : `node:test` natif (pas de framework tiers), via `npm run verify:ci`.
- **Tooling** : Electron `^39.8.10`, electron-builder `^26.8.1`, Ink pour CLI React-like, `tsx ^4.22.4`.

---

## 3. Architecture des dossiers

| Dossier | Rôle |
|---|---|
| `src/utils/` | **Coeur OPC** : loop, budget, reasoner, context, humanGate, JSONL |
| `src/utils/__tests__/` | Tests node:test (82 cas) |
| `src/commands/`, `src/plugins/` | CLI + plugins utilisateur |
| `desktop/electron/` | Shell Electron CommonJS strict (main, IPC, cliRunner, sessionStore) |
| `desktop/test/`, `desktop/renderer/` | Tests Electron (310 cas) + UI navigateur |
| `plugins/` | 16 plugins utilisateur (agent-sdk-dev, hookify, ...) |
| `docs/` | Audits, specs, guides (référence clé : `docs/OPC_LOOP_ENGINEERING_AUDIT_2026-06-21.md`) |

---

## 4. Conventions de nommage

| Catégorie | Convention | Exemple |
|---|---|---|
| Fichiers TS | `kebab-case.ts` | `loopRunner.ts`, `contextBudget.ts` |
| Fichiers CJS Electron | `camelCase.cjs` | `cliRunner.cjs`, `humanGateIpc.cjs` |
| Composants JSX | `PascalCase.tsx` | `ConfirmationBanner.tsx` |
| Tests | `<module>.test.ts` / `<module>.test.cjs` | `loopBudget.test.ts` |
| Fonctions exportées | `camelCase` | `evaluateStop`, `dispatchReason` |
| Types/Interfaces | `PascalCase` | `LoopEvent`, `Reasoner`, `BudgetTracker` |
| Constantes globales | `UPPER_SNAKE` | `MAX_ITERS`, `DEFAULT_TIMEOUT_MS` |
| Variables privées | préfixe `_` ou `private` TS | `_abortController` |
| Branches git | `<type>-<scope>` en kebab-case | `opc-production-hardening` |

---

## 5. Skill actif : Fabuleux

**Obligatoire** pour toute tâche de livraison. Choisir le type :

| Type | Quand l'utiliser |
|---|---|
| Artefact | Code, composant, plugin, refactor |
| Prose | Documentation, rédaction, README, CLAUDE.md |
| Analyse | Recherche, comparaison, exploration |
| Audit | Revue, diagnostic, post-mortem |

### 5.1 Boucle d'apprentissage (explicite)

```
Produire     → 1ère passe du livrable (code, doc, analyse)
   ↓
Observer     → relire, vérifier la sortie réelle (lint/test/diff), comparer au but
   ↓
Capturer     → noter l'écart : bug, dérive, décision non documentée
   ↓
Corriger     → patcher + vérifier que le fix tient + mettre à jour CLAUDE.md si durable
   ↓
(rebouclage si écart restant)
```

Règles absolues :

1. Pensée dense — réfléchir avant d'agir.
2. Livrable fini — pas de placeholder, TODO, ni "à compléter".
3. Auto-correction — relire systématiquement avant de répondre.
4. Vérité objective — citer le résultat réel, pas l'espéré.
5. **Note de confiance finale** obligatoire (haute / moyenne / basse) sur toute analyse ou audit.

---

## 6. Workflow standard

Pour chaque tâche de code :

1. **ORIENTER** — lire les fichiers concernés, `git status`, branche courante.
2. **LIRE** — `read_file` sur TOUT ce qui sera modifié (jamais de mémoire).
3. **PLANIFIER** — lister les changements AVANT de commencer.
4. **EXÉCUTER** — changements ciblés, empreintes minimales.
5. **VÉRIFIER** — `npm run verify:ci` (racine) + `npm --prefix desktop run verify:ci`.
6. **COMMITTER** — Conventional Commits en français, scope explicite.

Pour les tâches ≥ 3 étapes : utiliser TodoWrite pour suivre l'avancement.

Pour le débogage : reproduire → chercher le message → cause racine → fix → chercher bugs similaires.

---

## 7. Coeur agent loop

Référence clé : `docs/OPC_LOOP_ENGINEERING_AUDIT_2026-06-21.md`.

Boucle principale : **Act → Observe → Verify → Reason → Repeat** avec bornes budgets.

### 7.1 Modules fondamentaux

| Fichier | Rôle | Exports clés |
|---|---|---|
| `src/utils/loopRunner.ts` | Orchestrateur principal | `runLoop`, `dispatchReason` |
| `src/utils/loopBudget.ts` | BudgetTracker + sterile-action | `BudgetTracker`, `actionKey` |
| `src/utils/loopStop.ts` | Critère d'arrêt central | `evaluateStop()` |
| `src/utils/loopReasoner.ts` | ReAct pluggable (LLM ou heuristique) | `defaultReason`, `isTransientFailure` |
| `src/utils/humanInTheLoop.ts` | Interface `HumanGate` | `noHumanGate`, `createIpcHumanGate` |
| `src/utils/loopEvents.ts` | Union typée + emitter | `LoopEvent`, `LoopEventEmitter` |

Autres modules de support (events JSONL, context budget, vérification, criteria, tool registry, task checklist, memory) : voir arborescence `src/utils/` et `__tests__/`.

### 7.2 Décisions du reasoner (table de vérité)

| Cas | Décision | Effet |
|---|---|---|
| `act-fail` transient, attempt < 2 | `retry` | Compteur incrémenté |
| `act-fail` déterminist (TypeError, ENOENT) | `escalate` | Sortie immédiate |
| `act-fail` transient, confidence basse | `ask-human` | Prompt IPC |
| `verify-ok` | `continue` (done) | Tâche marquée `done` |
| `verify-fail` attempt ≤ 2 | `refine` | Texte tâche mis à jour |
| `verify-fail` attempt > 2 | `ask-human` ou `escalate` | Selon confidence |
| `human-approved` | `continue` | Override verify-fail |
| `human-rejected` | `escalate` | Sortie immédiate |
| `human-timeout` | `retry` | Compteur préservé |

### 7.3 Garanties boucle

Boucle **jamais bloquée** (timeout = pire cas borné), `defaultReason` toujours dispo en fallback, IPC safe (erreur résout `'timeout'`), `refine` commit immédiat avant le tour suivant.

### 7.4 Pièges connus (P1-P10)

> Lecture obligatoire avant toute modification loop ou IPC. Chaque piège cite la conséquence d'ignorance.

| # | Piège | Conséquence si ignoré |
|---|---|---|
| **P1** | **Émettre `loop_finished`** en fin de boucle, sans exception | Renderer reste sur "running" indéfiniment, l'utilisateur ne voit jamais l'état terminal |
| **P2** | **`actionKey` du BudgetTracker** doit inclure un identifiant sémantique (tool + target + argsHash), pas juste le tool name | Les retries légitimes ne déclenchent pas la détection de boucle stérile → escalade absente |
| **P3** | **Mettre à jour `tsconfig.utils.json` ET `tsconfig.loop-tests.json`** pour tout nouveau fichier `src/utils/*.ts` | Le nouveau module n'est pas typechecké ; les tests ne le voient pas ; CI silencieusement verte mais fausse |
| **P4** | **Conserver le préfixe `opc:`** sur tous les canaux IPC `cliRunner.cjs` ↔ `loopEventIpc.cjs` | Renommer un canal casse le bridge CLI↔Electron silencieusement (événement jamais reçu côté renderer) |
| **P5** | **Tests Electron en `.cjs`** : exécution via `node --test`, **pas via Electron** | Importer `electron` dans un test unit `.cjs` casse le runner ; les helpers doivent être neutres |
| **P6** | **Boucle `while (true)` interdite** : utiliser `evaluateStop()` systématiquement | Risque de boucle infinie, dépassement budget, deadlock IPC |
| **P7** | **Reasoner qui throw** : wrapper systématiquement dans try/catch + fallback `defaultReason` | Une exception LLM remonte jusqu'au renderer et casse la session |
| **P8** | **IPC handler qui throw** : retourner `{ ok: false, error }`, ne jamais propager | Le renderer reçoit une exception non gérée ; état UI incohérent, pas de recovery |
| **P9** | **Tests qui mockent le système de fichiers entier** : préférer `os.tmpdir()` + cleanup explicite | Tests qui passent en mock mais échouent en intégration ; pollution du repo |
| **P10** | **Validation IPC obligatoire** via `desktop/electron/ipcValidation.cjs` : ne JAMAIS bypasser | Canal non validé = faille XSS, command injection ou path traversal exploitable depuis le renderer |

---

## 8. Profil d'une session réussie & indicateur de dérive

### 8.1 Profil d'une session bien conduite

Une session OPC conforme à ce baseline présente ces signaux :

| Signal | Indicateur |
|---|---|
| Lecture initiale | `CLAUDE.md` + fichiers touchés lus avant toute édition |
| Plan | TodoWrite activé pour ≥ 3 étapes ; tâches marquées `in_progress` puis `completed` sans skip |
| Vérification | `npm run verify:ci` ET `npm --prefix desktop run verify:ci` verts après chaque modification |
| Livrable | Code complet (pas de `TODO`, pas de placeholder), note de confiance finale |
| Mémoire | Pièges nouveaux capturés dans §7.4 (P1-P10) si récurrents |
| Commit | Conventional Commits FR, scope explicite, tests verts en local |
| Style | Réponses concises, pyramide inversée, chiffres plutôt qu'adjectifs |

### 8.2 Indicateur de dérive

Si **2 de ces signaux** sont absents, **stop & corriger** avant de continuer :

- ❌ Modification sans lecture préalable du fichier
- ❌ Tests non lancés après changement de comportement
- ❌ Livrable avec placeholder ou "à compléter"
- ❌ Commit sans message conventionnel ou avec secrets en dur
- ❌ Boucle d'apprentissage §5.1 non appliquée (pas d'observation, pas de correction)
- ❌ Piège connu P1-P10 ignoré malgré rappel
- ❌ Note de confiance absente sur analyse/audit
- ❌ `console.log` laissé en production

---

## 9. Design & UX

Principes directeurs pour le shell Electron et le renderer OPC :

- **Latence perceptible** : tout délai > 200 ms doit être signalé (état transitoire visible).
- **Confirmations destructrices** : suppression de session, kill de loop, reset budget → toujours via bannière (`ConfirmationBanner.js`) avec raison explicite.
- **Stream JSONL** : le renderer doit afficher les événements au fil de l'eau, pas en bloc en fin de boucle.
- **Couleurs sémantiques** : rouge = erreur/timeout, jaune = ask-human/en attente, vert = done, gris = idle.
- **Accessibilité** : contrastes WCAG AA, navigation clavier pour les actions critiques (Enter = confirmer, Esc = annuler).
- **Pas de blocking modal** : les bannières sont non-bloquantes ; le user peut continuer à lire le stream.

Référence : `desktop/renderer/services/confirmationBanner.js`, `desktop/renderer/services/sessionBanner.js`.

---

## 10. Système de vérification

### 10.1 Chaînes de vérif

| Commande | Périmètre |
|---|---|
| `npm run verify:ci` | `typecheck:refactor` + `typecheck:utils` + `typecheck:loop-tests` + `test:loop` + chaîne desktop |
| `npm --prefix desktop run verify:ci` | `audit:security` (npm audit --audit-level=moderate --omit=optional) + `typecheck:refactor` + `test` (node --test test/*.test.cjs) |

### 10.2 Baselines à préserver

- **Tests loop** : `82/82` doivent rester verts (`src/utils/__tests__/`).
- **Tests Electron** : `310/310` doivent rester verts (`desktop/test/*.test.cjs`).
- **Typecheck** : `0 erreur` sur les 3 tsconfig.

Tout PR qui régresse l'un de ces seuils est **rejeté** sauf raison documentée.

---

## 11. Conventions de commit (Conventional Commits FR)

Format : `<type>(<scope>): <sujet>` + corps optionnel en français.

| Type | Usage |
|---|---|
| `feat` | Nouvelle fonctionnalité utilisateur |
| `fix` | Correction de bug |
| `refactor` | Refacto sans changement de comportement |
| `docs` | Documentation seule |
| `chore` | Maintenance (deps, config, CI) |
| `perf` | Optimisation mesurable |
| `test` | Ajout ou correction de tests |
| `style` | Formatage seul |

---

## 12. Règles numérotées (1-12)

> Toutes les règles s'appliquent sans exception. Une règle enfreinte = livrable refusé.

### Senior génériques (R1-R5)

1. **Pas de catch silencieux** (`except: pass`, `catch(e) {}`) — toujours logger ou propager.
2. **Pas d'`eval()`** avec des données utilisateur — risque d'injection.
3. **Pas de `var`** — utiliser `const` par défaut, `let` si mutation nécessaire.
4. **Pas de secrets hardcodés** — variables d'environnement, jamais en dur dans le code.
5. **Pas de `rm -rf`** sans confirmation explicite — risque de destruction irréversible.

### Garde-fous VCS (R6)

6. **Pas de push vers `main`/`master`** sans tests verts en local + revue si branche partagée.

### Spécifiques OPC (R7-R11)

7. **Pas de `console.log` en production** — utiliser `loopEvents` ou `console.error`.
8. **Pas de `any` TypeScript** — utiliser `unknown` + narrow (TS strict).
9. **Toujours documenter les side-effects IPC** dans `preload.cjs` ET `ipcContract.cjs`.
10. **Toujours émettre un `LoopEvent`** pour chaque transition d'état de la boucle.
11. **Toujours valider les inputs aux frontières** (user input, IPC, API).

### Règle meta (R12)

12. **Ne jamais modifier CLAUDE.md en spéculation** — un ajout (règle, piège, décision) n'est consigné qu'**après validation explicite** par l'utilisateur ou après **deux occurrences confirmées** du même problème. Avant cela, le brouillon vit dans `.claude/MEMORY.md` ou dans le worklog de session.

---

## 13. Sécurité (revue systématique)

- **IPC validation** : `desktop/electron/ipcValidation.cjs` valide chaque canal. Ne JAMAIS bypasser (= piège P10).
- **Path traversal** : résoudre tous les chemins via `path.resolve` puis vérifier préfixe autorisé.
- **Command injection** : `cliRunner.cjs` doit passer par `execa`/`spawn` avec args en array, JAMAIS de `exec(string)`.
- **Render XSS** : tout HTML injecté dans le renderer doit passer par un sanitizer (DOMPurify si dispo).
- **Dependencies** : `audit:security` (moderate) doit rester clean avant tout PR.

---

## 14. Apprentissage itératif & décisions durables

> Cette section consigne les **décisions architecturales durables**. Les pièges récurrents sont centralisés en §7.4 (P1-P10) — ne pas dupliquer ici.

- `src/utils/` est en **TypeScript strict** avec `noEmit`. Pas de webpack/esbuild, **tsx** exécute directement. Toute tentative d'ajouter un bundler doit être justifiée.
- **CommonJS strict** dans `desktop/electron/` (suffixe `.cjs`). Mélanger ESM dans `desktop/` casse Electron.
- Les modules loop sont **sans dépendance externe runtime** : ils n'importent que des types Node natifs. C'est ce qui permet `tsconfig.utils.json` de typer sans `node_modules` complets.
- `humanGateIpc.cjs` est **fail-safe par construction** : toute erreur résout `'timeout'`, jamais d'exception.

---

## 15. Glossaire

| Terme | Signification |
|---|---|
| ReAct | Pattern Reason + Act entrelacés à chaque tour |
| HumanGate | Interface d'escalade humaine (`ask(payload) → approved/rejected/timeout`) |
| BudgetTracker | Compteur tokens/USD/wall-time + détection de boucle stérile |
| Sterile action | Action répétée sans progrès (≥ 3 fois) → escalade automatique |
| `actionKey` | Clé sémantique pour détecter les repeats (`tool + target + argsHash`) |
| `evaluateStop` | Fonction centrale de décision d'arrêt (abort / budget / fatal / done) |

---

## 16. Index des fichiers critiques

Pour toute intervention loop, **toujours lire ces fichiers en premier** :

```
src/utils/loopRunner.ts                # orchestrateur
src/utils/loopBudget.ts                # budget + sterile detection
src/utils/loopStop.ts                  # evaluateStop
src/utils/loopEvents.ts                # types d'événements
src/utils/loopReasoner.ts              # ReAct
src/utils/humanInTheLoop.ts            # interface HumanGate
desktop/electron/ipc/humanGateIpc.cjs  # bridge IPC human
desktop/electron/ipc/loopEventIpc.cjs  # bridge IPC events
desktop/electron/cliRunner.cjs         # spawn CLI + stream JSONL
docs/OPC_LOOP_ENGINEERING_AUDIT_2026-06-21.md  # état de l'art loop
```

---

## 17. Mémoire de session

- **Mémoire projet long terme** : `.claude/MEMORY.md` (journal auto-généré, ne pas éditer à la main sauf décision durable).
- **Mémoire personnelle utilisateur** : `~/.claude/CLAUDE.md` (chargée globalement, **priorité basse** par rapport à ce fichier).
- **Mémoire globale projet** : `~/.claude/projects/-Users-bayeasssene-Documents-ProjetsGithub-OPC/memory/` (faits, feedback, references).

Pour une préférence durable (ex. "toujours valider avant commit"), demander **explicitement** "ajoute ça au CLAUDE.md" pour qu'elle soit consignée (cf. R12).

---

## 18. Démarrage rapide

```bash
git status              # 1. État du repo
npm run verify:ci       # 2. Référence : tout doit être vert
```

Identifier le scope : `src/utils/*` (loop) | `desktop/electron/*` (IPC) | `plugins/*` (extension) | `docs/*` (audit/spec). Puis suivre §6.

### Workflow premier contact (5 min)

1. Lire §Index rapide → identifier les 2-3 sections pertinentes.
2. Si intervention loop : §16 (fichiers critiques) → §7 (boucle) → §7.4 (pièges P1-P10).
3. Si intervention IPC : §13 (sécurité) + §16 + piège P10.
4. Lancer `verify:ci` (§10.1) pour baseline avant toute modification.
5. Au moindre doute : §8.2 (indicateur de dérive) pour auto-évaluer.

---

*Confiance globale sur ce fichier : haute sur stack/architecture/baselines/pièges P1-P10 ; moyenne sur conventions de nommage et Design & UX (à confirmer sur l'ensemble du repo après 2-3 sessions d'usage).*