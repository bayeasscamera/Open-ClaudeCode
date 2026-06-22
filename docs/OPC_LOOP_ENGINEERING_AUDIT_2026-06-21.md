# OPC Loop Engineering Audit - 2026-06-21

Ce document consigne la recherche sur le concept de **Loop Engineering** et évalue si OPC implémente déjà, partiellement, ou pas du tout ce paradigme.

## TL;DR

- **Loop Engineering** = remplacer l'invite manuelle par des boucles itératives autonomes (Act → Observe → Reason → Repeat).
- OPC dispose déjà d'un **squelette de boucle** dans `src/utils/taskChecklist.ts`, `src/utils/memory.ts`, `src/commands/plan/plan.tsx`, `src/commands/resume/resume.tsx` et la couche session IPC (`desktop/electron/sessionStore.cjs`, `sessionIpc.cjs`).
- Mais il manque la **boucle autonome pilotée par modèle** : pas de ReAct explicite, pas d'auto-critique, pas de critères de terminaison vérifiables. Les artefacts actuels sont de la **mémoire de session**, pas une boucle agentique.
- Verdict : **pré-loop engineering**, prêt à recevoir la couche manquante.

---

## Définition du Loop Engineering

Le Loop Engineering désigne le passage d'un modèle piloté par invites ponctuelles à un système qui exécute des **cycles autonomes et vérifiables**. Chaque cycle enchaîne :

1. **Act** — appel d'outils ou exécution de code.
2. **Observe** — collecte des sorties (logs, tests, exit codes).
3. **Reason** — interprétation et décision de l'étape suivante.
4. **Repeat** — rebouclage jusqu'à satisfaction d'une condition de sortie.

Ce paradigme est porté par Boris Cherny (créateur de Claude Code) : « I don't prompt Claude anymore. I write loops and the loops do the prompting for me. »

---

## Composants clés d'une boucle agentique

| Composant | Rôle | Exemple |
|---|---|---|
| Objectif clair | Cible vérifiable | « Tous les tests passent, lint clean » |
| Jeu d'outils | Actions possibles | `run_tests`, `read_file`, `edit_file` |
| Contexte | Mémoire persistante | Notes de session, plan courant |
| Logique de terminaison | Condition d'arrêt | `MAX_ITERS`, critère de succès |
| Gestion d'erreurs | Reprise ou escalade | Retry, fallback, human-in-the-loop |

---

## Patterns courants

| Pattern | Usage |
|---|---|
| **ReAct** | Reason + Act entrelacés à chaque tour |
| **Retry** | Relance après échec transient |
| **Plan-Execute-Verify** | Plan → exécution → vérification |
| **Explore-Narrow** | Recherche large puis focalisation |
| **Human-in-the-Loop** | Escalade vers l'humain à seuil |

---

## Cartographie OPC vs Loop Engineering

### Actifs existants (pré-loop)

| Fichier | Rôle | Composant loop couvert |
|---|---|---|
| `src/utils/taskChecklist.ts` | Liste de tâches par session | Objectif clair (étapes) |
| `src/utils/memory.ts` | Mémoire projet persistante | Contexte |
| `src/utils/plans.ts` | Plans sérialisables | Objectif clair |
| `src/commands/plan/plan.tsx` | Commande `/plan` | Initialisation de boucle |
| `src/commands/resume/resume.tsx` | Commande `/resume` | Reprise de boucle |
| `desktop/electron/sessionStore.cjs` | Persistance session Electron | Mémoire |
| `desktop/electron/ipc/sessionIpc.cjs` | Bridge IPC session | Transport état |
| `desktop/renderer/services/sessionBanner.js` | Bandeau session UI | Observabilité humaine |

### Composants manquants

| Composant manquant | Impact |
|---|---|
| Boucle explicite (driver) | Pas d'itération autonome act→observe→reason |
| Critère de succès vérifiable | Pas de terminaison programmatique |
| ReAct / Plan-Execute-Verify | Pas de méta-raisonnement sur les étapes |
| Auto-critique / self-review | Pas de détection d'échec silencieux |
| Reprise après erreur | Échec = arrêt, pas retry |
| Limites d'itération | Risque de boucle infinie |

---

## Analyse par couche

### 1. Mémoire (couche la plus mature)

OPC a une vraie mémoire projet :

- `src/utils/memory.ts` : notes structurées.
- `desktop/electron/sessionStore.cjs` : persistance disque.
- `desktop/electron/ipc/sessionIpc.cjs` : transport IPC.

C'est l'**input** d'une boucle, mais sans boucle elle-même.

### 2. Planification

`/plan` et `/resume` (`src/commands/plan/plan.tsx`, `src/commands/resume/resume.tsx`) permettent de poser un plan et de le reprendre. C'est l'**objectif clair** d'une boucle, mais l'exécution reste manuelle.

### 3. Exécution

Aucune boucle autonome ne fait « agir → observer → raisonner ». L'utilisateur doit relancer les commandes. C'est la **limite principale**.

### 4. Vérification

`verify:ci` (`package.json`), `test:visual` (`desktop/package.json`) existent mais ne sont pas câblés dans une boucle qui les rejoue après chaque action.

---

## Verdict

| Critère | Statut |
|---|---|
| Objectif clair | ✅ Partiel (plan + checklist) |
| Jeu d'outils | ✅ (CLI, IPC, providers) |
| Contexte | ✅ (memory, sessionStore) |
| Logique de terminaison | ❌ Absente |
| Gestion d'erreurs | ⚠️ Basique (pas de retry agentique) |
| Boucle autonome | ❌ Absente |

**Niveau actuel : pré-loop engineering.**
**Niveau cible : loop engineering supervisé avec human-in-the-loop.**

---

## Compléments ajoutés (mise à jour 2026-06-22)

Cette section consigne ce qui a été câblé pour passer du « pré-loop engineering » au « loop engineering supervisé ». Chaque ligne pointe vers un fichier et un rôle.

### Couche Reason (ReAct)

- `src/utils/loopReasoner.ts` — interface `Reason(ctx) → decision`, heuristique par défaut (`defaultReason`), classification transitoire vs déterministe (`isTransientFailure`), wrapper `createReasoner({ reason })` qui combine une raison LLM avec un fallback heuristique sûr.
- `loopRunner.ts` — appelle `dispatchReason(...)` après chaque `act-fail`, après chaque `verify-ok`, après chaque `verify-fail`, et au point « verify skipped ». Émet un step `reason` à chaque tour.
- Nouvelles actions : `reason`, `ask-human`, `human-approved`, `human-rejected`, `human-timeout`.

### Couche Human-in-the-Loop

- `src/utils/humanInTheLoop.ts` — interface `HumanGate.ask(payload) → 'approved' | 'rejected' | 'timeout'`. Implémentations : `noHumanGate` (safe default), `createCliHumanGate` (readline + timeout), `createIpcHumanGate` (délègue à l'IPC), `createScriptedHumanGate` (tests + démo).
- `desktop/electron/ipc/humanGateIpc.cjs` — bridge IPC main ↔ renderer. Canal `opc:human-gate-ask` (invoke) + `opc:human-gate-prompt` (event) + `opc:human-gate-respond` (main reçoit la décision). File d'attente bornée, timeout côté main, jamais de blocage UI.
- `desktop/renderer/services/confirmationBanner.js` — bannière générique indépendante de `sessionBanner.js`. S'abonne à `onHumanGatePrompt`, envoie la décision via `humanGateAsk`.
- `desktop/electron/ipcContract.cjs` + `desktop/electron/preload.cjs` + `desktop/electron/ipcHandlers.cjs` — exposition du nouveau canal.
- `desktop/renderer/app.js` + `desktop/renderer/index.html` — instanciation et abonnement au nouveau banner.

### Décisions du reasoner

| Cas | Décision | Effet |
|---|---|---|
| `act-fail` transient, attempt < 2 | `retry` | Re-tentative avec compteur incrémenté |
| `act-fail` déterminist (TypeError, ENOENT…) | `escalate` | Sortie immédiate avec reason |
| `act-fail` transient, confidence < seuil | `ask-human` | Prompt IPC, comportement dépend de la décision humaine |
| `verify-ok` | `continue` | Marqué `done` |
| `verify-fail` attempt ≤ 2 | `refine` | Texte de tâche mis à jour + retry |
| `verify-fail` attempt > 2, confidence < seuil | `ask-human` | Idem |
| `verify-fail` attempt > max | `escalate` | Sortie immédiate |
| `human-approved` | `continue` | Tâche marquée `done` (override du verify-fail éventuel) |
| `human-rejected` | `escalate` | Sortie immédiate |
| `human-timeout` | `retry` | Reprise avec le compteur existant |

### Garanties

- La boucle ne reste jamais bloquée : `timeout` est toujours le pire cas borné.
- Le fallback `defaultReason` est toujours disponible même si un reasoner LLM lève.
- L'IPC ne lève jamais vers le runner : toute erreur résout `'timeout'`.
- `refine` met à jour `tasks[]` et appelle `saveTasks` — la tâche vue par le prochain tour a déjà le nouveau texte.
- Le padding `formatLoopReport` est passé de 11 à 15 colonnes pour accommoder `human-approved` / `human-rejected` / `human-timeout`.

### Exécution de la démo

```bash
npx tsx src/utils/loopRunner.example.ts
```

La démo seed trois tâches vérifiables, câble un reasoner custom qui force `ask-human` après 2 échecs, et un `humanGate` scripté qui approuve / rejette / time-out. La sortie liste tous les steps via `onStep`, puis imprime `formatLoopReport(outcome)`.

### Niveau après ces compléments

| Critère | Statut |
|---|---|
| Objectif clair | ✅ (plan + checklist + criteria DSL) |
| Jeu d'outils | ✅ (CLI, IPC, providers, editFile…) |
| Contexte | ✅ (memory, sessionStore, plan) |
| Logique de terminaison | ✅ (verify:ci + criteria + reasoner) |
| Gestion d'erreurs | ✅ (transient vs deterministic, retry borné, refine, ask-human) |
| Boucle autonome | ✅ (act → observe → reason → ask-human → continue) |

**Niveau actuel : loop engineering supervisé avec human-in-the-loop.** L'ReAct LLM-driven complet (raisonnement à chaque tour via SDK Anthropic) est branché comme `reason` pluggable ; l'implémentation par défaut reste heuristique pour la stabilité.

---

## Recommandations

### Court terme (sans changement de modèle)

1. **Ajouter un runner de boucle** dans `src/utils/` qui :
   - Lit une checklist (`taskChecklist.ts`).
   - Exécute chaque étape via les outils existants.
   - Collecte les observations (exit codes, logs).
   - Décide de l'étape suivante (succès / retry / escalade).

2. **Critère de succès vérifiable** par tâche :
   - Tests qui doivent passer.
   - Fichiers qui doivent exister.
   - Métriques à atteindre.

3. **Limites d'itération** explicites (`MAX_ITERS`, `MAX_TOKENS`).

### Moyen terme

4. **Pattern Plan-Execute-Verify** câblé sur `verify:ci` :
   - `/plan` génère un plan.
   - Runner exécute étape par étape.
   - Après chaque étape critique → `verify:ci` partiel.
   - Sur échec → rollback ou retry borné.

5. **Self-review** : après chaque action, le système génère un diagnostic (« est-ce que cela avance vers l'objectif ? ») et décide de continuer, ajuster, ou escalader.

### Long terme

6. **Human-in-the-loop** : seuil d'incertitude → demande de validation humaine via IPC existant.

7. **Boucles spécialisées** : une boucle par type de tâche (refactor, test, audit, doc).

---

## Boucle vertueuse recommandée

```text
[Goal] → [Plan] → [Act] → [Observe] → [Verify] → [Reason]
                           ↑                              ↓
                           └──────── retry / refine ──────┘
                                          ↓
                                   [Terminated?]
                                    ↙        ↘
                              [Yes: OK]   [No / Escalate]
```

Chaque case mappe à un actif OPC existant ou à créer :

| Case | Actif OPC |
|---|---|
| Goal | `plans.ts`, `taskChecklist.ts` |
| Plan | `commands/plan/plan.tsx` |
| Act | CLI runner, IPC handlers |
| Observe | logs IPC, `sessionBanner.js` |
| Verify | `verify:ci`, `test:visual` |
| Reason | **à créer** (méta-couche) |

---

## Sources

- [The New Stack — Loop Engineering](https://thenewstack.io/loop-engineering/)
- [MindStudio — What Is Loop Engineering?](https://www.mindstudio.ai/blog/what-is-loop-engineering-ai-coding-agents)
- [Lushbinary — Loop Engineering Guide](https://lushbinary.com/blog/loop-engineering-ai-coding-agents-guide/)
- [ExplainX — Loop Engineering 2026](https://explainx.ai/blog/what-is-loop-engineering-ai-agents-2026)
- [GitHub — cobusgreyling/loop-engineering](https://github.com/cobusgreyling/loop-engineering)

---

## Annexe : fichiers OPC inspectés

```text
src/utils/taskChecklist.ts          (nouveau, untracked)
src/utils/memory.ts                 (nouveau, untracked)
src/utils/plans.ts                  (modifié)
src/commands/plan/plan.tsx          (modifié)
src/commands/resume/resume.tsx      (modifié)
src/context.ts                      (modifié)
desktop/electron/sessionStore.cjs   (nouveau, untracked)
desktop/electron/ipc/sessionIpc.cjs (nouveau, untracked)
desktop/electron/ipcHandlers.cjs    (modifié)
desktop/renderer/services/sessionBanner.js (nouveau, untracked)
```

Note de confiance : **haute** pour la cartographie des actifs, **moyenne** pour la projection des composants manquants (dépend des hypothèses de design futures).
