# Audit complet OPC vs Codex

Date: 2026-06-04

## Résumé exécutif

OPC est déjà beaucoup plus solide qu'une simple interface autour d'un CLI: le projet possède une application Electron sandboxée, une couche provider locale, une validation IPC, des tests automatisés, un installateur macOS prudent et des mécanismes de redaction. Le dernier `verify:ci` local passe avec `0` vulnérabilité npm, typecheck OK et `244` tests réussis.

La limite principale n'est plus la stabilité de base. La limite est la maturité de plateforme: persistance encore centrée `localStorage` + JSON, surface IPC large, distribution macOS non notarizée, code historique très volumineux dans `src/`, observabilité surtout locale, et orchestration agent encore moins profonde que Codex.

Comparé à Codex, OPC est meilleur comme cockpit desktop local pour gérer des providers, projets, historiques, tests de modèles et workflows macOS. Codex reste supérieur comme runtime d'ingénierie agentique: outils intégrés, mémoire de travail, plugins, navigation web, orchestration de tâches, discipline de sandbox/permissions et capacité à intervenir sur de gros dépôts avec vérification.

Verdict CTO: OPC peut devenir un excellent "local agent control plane", mais il ne doit pas essayer de copier Codex tel quel. La meilleure trajectoire est de durcir OPC sur cinq axes: persistance scalable, contrats typés, provider intelligence, sécurité/distribution, et orchestration agentique vérifiable.

## Méthode et preuves

Sources inspectées:

- Manifests: `package.json`, `desktop/package.json`.
- Runtime Electron: `desktop/electron/main.cjs`, `windowManager.cjs`, `preload.cjs`, `ipcHandlers.cjs`, `ipcValidation.cjs`.
- Providers: `providerBridge.cjs`, `providerConfig.cjs`, `providerIssue.cjs`, `providerProfilePolicy.cjs`, `providerChecker.cjs`.
- Renderer: `desktop/renderer/app.js`, `state/stateRepository.js`, contrôleurs et services.
- Documentation existante: `docs/OPC_SCALE_READINESS.md`, `docs/OPC_SURGICAL_REFACTORING.md`, `docs/OPC_DOMAIN_GLOSSARY.md`.
- Tests: `desktop/test/*.test.cjs`.
- Environnement Codex courant: skills, hooks, outils disponibles, mémoire locale.

Vérification exécutée:

```bash
npm --prefix desktop run verify:ci
```

Résultat: `npm audit` sans vulnérabilité modérée+, typecheck OK, `244/244` tests passent.

## Cartographie rapide d'OPC

| Couche | Rôle | État actuel |
|---|---|---|
| Electron main | Fenêtre, IPC, bridge provider, runtime CLI | Robuste, déjà modulaire |
| Preload | API `window.opc` exposée au renderer | Fonctionnelle mais large |
| Renderer | Chat, projets, providers, long tasks, settings | UX riche mais state monolithique |
| Provider bridge | Adaptation Anthropic/OpenAI/GitLab/Ollama et modèles locaux | Atout majeur d'OPC |
| Persistence | `localStorage` renderer + JSON privé Electron | Correct pour local, limité pour scale |
| Tests | Node test, smoke UI, visual smoke | Bon socle |
| Packaging | Electron Builder `dir`, install `/Applications`, ad-hoc codesign | Bon pour local, insuffisant pour distribution large |

## Points forts actuels d'OPC

| Domaine | Preuve | Gain |
|---|---|---|
| Sandbox Electron | `contextIsolation`, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true` dans `desktop/electron/windowManager.cjs:22` | Réduit fortement l'impact d'une compromission renderer |
| IPC validé | limites et normalisation dans `desktop/electron/ipcValidation.cjs:4` puis `validateRunPayload` à `:215` | Empêche beaucoup d'entrées dangereuses ou non bornées |
| Installation prudente | refus de remplacer l'app si elle tourne dans `desktop/scripts/installApplications.cjs:63` | Évite pertes d'état et corruption pendant rebuild/install |
| Tests conséquents | `desktop/package.json:21` et `244` tests passants | Réduit le risque de régression |
| Provider bridge local | modèles exposés, auth locale, retries et adaptation multi-format | Différenciant fort face à une UI générique |
| Redaction et JSON privé | tests de redaction, `private JSON`, migration de clés | Bon début sécurité/secrets |
| UX provider | test, import, réparation, quarantine, support bundle | Très utile pour un produit multi-provider |

## Findings prioritaires

| Priorité | Problème actuel | Impact | Solution proposée | Effort | Gain attendu |
|---|---|---|---|---|---|
| Critique | Persistence encore basée sur `localStorage` dans `desktop/renderer/state/stateRepository.js:4` et JSON côté Electron | Historique, providers, projets et index deviennent fragiles avec gros volumes ou migrations | Migrer vers SQLite local avec migrations, WAL, tables `chats`, `messages`, `providers`, `projects`, `provider_checks`, `runtime_events`; garder JSON comme import/export | Élevé | Fiabilité, recherche, reprise, support multi-projet |
| Haute | Surface preload large dans `desktop/electron/preload.cjs:3` à `:57` | Plus de canaux signifie plus de surface d'abus et plus de contrats implicites | Définir un schéma typé unique par canal, générer validators + types renderer, réduire les méthodes publiques par domaines | Moyen | Sécurité, maintenabilité, refactors plus sûrs |
| Haute | Provider diagnostics encore parfois trop génériques: le classifieur mélange statut HTTP et texte dans `desktop/electron/providerIssue.cjs:1` à `:56` | L'utilisateur voit "à configurer" ou "auth" alors que le vrai problème peut être modèle non supporté, endpoint Anthropic, contexte ou modèle invalide | Prioriser certains textes métier avant statut, ajouter `model_invalid`, `endpoint_format`, `key_missing`, `key_rejected`; afficher la correction exacte | Faible à moyen | Moins de support, configuration plus rapide |
| Haute | Code source historique très volumineux: plusieurs fichiers `src/` dépassent 3000-5600 lignes | Toute modification CLI/core a un coût élevé et un risque de régression | Continuer le refactor chirurgical: extraire parsers, policies, services purs, tests de caractérisation | Élevé | Maintenabilité et performance de dev |
| Haute | Packaging macOS local seulement: `target: dir` dans `desktop/package.json:63`, signature ad-hoc dans `desktop/scripts/installApplications.cjs:120` | Pas prêt pour distribution publique, MDM ou utilisateurs non développeurs | Ajouter Developer ID, hardened runtime, notarization, DMG/ZIP, update channel et rollback | Moyen à élevé | Adoption entreprise et confiance |
| Moyenne | Cap IPC prompt à `500000` chars dans `desktop/electron/ipcValidation.cjs:4`, plus élevé que beaucoup de providers | Risque de "Prompt is too long", latence et coûts mémoire malgré les troncatures provider | Budget unique par provider avant CLI, estimation token, compactage automatique visible, dry-run "contexte envoyé" | Moyen | Moins d'échecs provider, meilleure UX petit contexte |
| Moyenne | Observabilité locale mais pas encore exploitable en production | Diagnostics post-incident encore manuels | Structurer logs runtime/provider avec correlation id, exporter support bundle versionné, option telemetry locale opt-in | Moyen | Support plus rapide, fiabilité mesurable |
| Moyenne | Accessibilité testée partiellement, surtout anchors et titres | Risque d'usage difficile clavier/lecteur d'écran | Tests automatisés focus order, contrast, reduced motion, roles ARIA, navigation clavier | Faible à moyen | Qualité UX, conformité |
| Moyenne | Recherche et timeline peuvent saturer visuellement et techniquement | Gros historiques difficiles à scanner | Virtualisation des listes, FTS SQLite, filtres par provider/projet/erreur, timeline compacte texte-first | Moyen | Performance UI et lisibilité |
| Faible | SEO non applicable au desktop | Aucun impact produit direct | Si site marketing/docs: pages statiques, metadata, OpenGraph, sitemap | Faible | Acquisition web uniquement |

## Comparaison OPC vs Codex

Notation: 1 faible, 5 excellent dans le contexte actuel.

| Domaine | OPC | Codex | Avantage | Lecture CTO |
|---|---:|---:|---|---|
| Objectif produit | 4 | 5 | Codex | OPC est un cockpit local spécialisé. Codex est un agent d'ingénierie complet déjà industrialisé. |
| UX desktop | 5 | 3 | OPC | OPC a une vraie interface locale avec providers, projets, timeline, settings. Codex est surtout conversation + outils. |
| Providers/modèles | 4 | 4 | Égalité | OPC donne le contrôle multi-provider local. Codex offre un backend plus mature et stable. |
| Validation provider | 3 | 5 | Codex | OPC progresse vite mais doit mieux classifier les endpoints, modèles, clés et limites contexte. |
| Orchestration agent | 3 | 5 | Codex | Codex dispose d'un modèle d'action plus éprouvé, outils spécialisés et persistance de session. |
| Exécution shell/projet | 4 | 5 | Codex | OPC sait piloter le CLI et long tasks, mais Codex a une intégration outil plus directe et vérifiée. |
| Gestion contexte | 3 | 5 | Codex | OPC indexe et compacte, mais Codex a mémoire, skills, hooks et discipline de contexte plus mature. |
| Mémoire durable | 3 | 5 | Codex | OPC stocke localement et redige; Codex a une mémoire exploitable par workflow et rappel inter-session. |
| Sécurité renderer | 4 | 4 | Égalité | OPC a de bons paramètres Electron. Codex a sandbox/processus/outils contrôlés au niveau plateforme. |
| Sécurité secrets | 4 | 4 | Égalité | OPC redige et migre les clés; Codex évite de persister beaucoup de secrets côté app utilisateur. |
| Surface d'attaque | 3 | 4 | Codex | OPC expose une API preload large; Codex cloisonne davantage par outils. |
| Performance locale | 3 | 4 | Codex | OPC dépend de localStorage/DOM/timeline; Codex externalise davantage l'orchestration. |
| Scalabilité data | 2 | 5 | Codex | OPC doit passer SQLite/FTS/virtualisation pour gros historiques. |
| Observabilité | 3 | 4 | Codex | OPC a runtime/status/support bundle. Codex expose mieux les étapes outil et erreurs de workflow. |
| Tests | 4 | 5 | Codex | OPC a un bon socle local. Codex bénéficie d'une plateforme et d'une validation produit plus large. |
| Packaging/distribution | 2 | 5 | Codex | OPC n'est pas encore signé/notarizé pour large diffusion. |
| Extensibilité plugins | 3 | 5 | Codex | OPC charge plugins/package, mais Codex a skills, MCP, plugins et connecteurs prêts. |
| Multi-agent | 2 | 4 | Codex | OPC est surtout single runtime. Codex peut déléguer via outils/plugins selon contexte. |
| Offline/local | 4 | 2 | OPC | OPC peut piloter Ollama/local providers. Codex dépend fortement du service et des outils disponibles. |
| Coût/contrôle utilisateur | 5 | 3 | OPC | OPC laisse choisir providers, clés, modèles, no-auth local. |
| Maintenabilité | 3 | 4 | Codex | OPC a encore des modules historiques massifs malgré de bons refactors récents. |
| Prêt grande échelle | 2 | 5 | Codex | OPC est prêt pour usage local avancé, pas encore pour parc large ou équipe enterprise. |

## Analyse par domaine

### 1. Fonctionnel

OPC couvre déjà les fonctions critiques: chat, projets, providers, tests provider, import/export, long tasks, support bundle, prompt refine, mémoire locale. Le point manquant face à Codex est l'orchestration de tâche fiable de bout en bout: plan, exécution, reprise, vérification, preuve et continuation automatique.

Recommandations:

- Ajouter un "Task Ledger" durable: chaque action agent devient une étape typée avec état `planned`, `running`, `blocked`, `verified`, `failed`.
- Afficher la preuve minimale par tâche: commande lancée, test passé, fichier modifié, erreur résolue.
- Ajouter reprise automatique contrôlée: continuer seulement si le dernier message promet une action et qu'aucun outil n'a été exécuté, avec limite stricte déjà testée côté completion guard.

### 2. Performance

Le risque principal est le coût UI/persistence avec gros historiques. `localStorage` force une sérialisation complète, peut bloquer le renderer et rend les migrations fragiles. Les caps actuels protègent l'app, mais masquent le problème de scale.

Recommandations:

- SQLite WAL pour messages et runtime events.
- FTS5 pour recherche conversations/projets.
- Virtualisation timeline et listes settings.
- Batching des écritures avec journal d'événements plutôt que sauvegarde complète.
- Budget contexte avant provider: compter/estimer tokens par provider, tronquer avant `opc:run`.

### 3. UX/UI

OPC est supérieur à Codex sur l'expérience desktop spécialisée: providers visibles, boutons de test, statuts, historique, projets. Les derniers retours utilisateur montrent toutefois deux irritants majeurs: panneaux trop volumineux dans la timeline et messages provider pas assez actionnables.

Recommandations:

- Timeline texte-first par défaut, panneaux seulement en détail repliable.
- Erreur provider en trois lignes: cause, correction, bouton direct.
- Sélecteur modèle validé par `/models` pour éviter que l'utilisateur colle un display name non accepté.
- Mode "petit contexte" visible pour Ollama et modèles free.

### 4. Architecture logicielle

L'architecture Electron récente est saine: IPC séparé par domaines, validation centrale, supervisor runtime, provider bridge. Le passif est dans `src/`, avec des fichiers historiques très volumineux et plusieurs responsabilités mélangées.

Recommandations:

- Garder les refactors "surgical" et test-first.
- Interdire les nouveaux fichiers > 800 lignes sauf exception documentée.
- Déplacer politiques provider/context/runtime dans des modules purs testables.
- Générer types IPC depuis un schéma source unique.

### 5. Base de données et persistence

OPC n'a pas encore de vraie base locale. Le modèle actuel est acceptable pour une app personnelle, insuffisant pour des milliers de messages, projets, checks provider et journaux runtime.

Recommandations:

- `opc.db` sous Application Support avec permissions strictes.
- Tables minimales: `conversations`, `messages`, `providers`, `provider_checks`, `projects`, `project_files`, `runtime_events`, `task_ledger`, `settings`.
- Migrations versionnées et testées.
- Export/import JSON compatible pour ne pas perdre les utilisateurs actuels.

### 6. Sécurité

Les bases sont bonnes: sandbox Electron, URLs externes restreintes, validation IPC, redaction, secrets migrés, installation qui refuse de remplacer une app ouverte. Les risques restants sont la surface preload, la distribution non notarizée et la complexité provider.

Recommandations:

- Réduire/typer `window.opc`.
- Journaliser les décisions de permission sans secrets.
- Ajouter secret vault obligatoire quand disponible, fallback explicite sinon.
- Hardened runtime + notarization pour release.
- Tests d'abus IPC: payloads énormes, chemins hors workspace, URLs non locales, pids non suivis.

### 7. Maintenabilité

Les tests récents donnent une bonne couverture desktop, mais le coût de compréhension reste élevé. Codex garde l'avantage parce que son modèle d'outils et de politiques est mieux factorisé côté plateforme.

Recommandations:

- Mesure CI de taille de fichier et complexité cyclomatique.
- Owners par domaine: providers, runtime, renderer state, project context, packaging.
- ADR courts pour chaque décision structurante.
- Tests de caractérisation avant toute extraction `src/`.

### 8. SEO

Non applicable au produit desktop. Si OPC reçoit un site ou une documentation publique, faire seulement le nécessaire: page statique rapide, titre clair, metadata, OpenGraph, sitemap, contenu docs indexable.

### 9. Accessibilité

OPC a déjà des tests sur titres/anchors. Il manque une validation plus réelle: focus clavier, contrastes, rôles, lecture des erreurs, taille responsive.

Recommandations:

- Test axe ou équivalent sur smoke UI.
- Snapshot clavier: ouvrir settings, provider panel, test provider, fermer modal sans souris.
- Contraste minimum AA sur badges et erreurs.
- `prefers-reduced-motion` pour animations.

### 10. Scalabilité et montée en charge

Pour un utilisateur local avancé, OPC est viable. Pour une équipe ou un parc large, il manque persistence transactionnelle, release signée, migrations, observabilité de parc, profils centralisables et politiques provider gouvernées.

Recommandations:

- Profils provider importables/exportables sans secrets.
- Policies d'équipe: providers autorisés, modèles par tâche, contexte max, outils autorisés.
- Support bundle versionné et redigé.
- Mécanisme update/rollback.

## Ce qu'OPC fait mieux que Codex

| Domaine | Pourquoi |
|---|---|
| Contrôle provider | L'utilisateur peut configurer OpenAI-compatible, Ollama, NVIDIA, OpenCode Zen, no-auth local, base URL et modèles. |
| UX locale | Tout est visible dans une app macOS: providers, projets, chats, tâches longues, tests. |
| Coût et souveraineté | OPC peut router vers modèles gratuits, locaux ou clés propres. |
| Debug provider | Les tests provider, imports `/models`, réparation, quarantine et support bundle sont très adaptés au problème réel de l'utilisateur. |
| Offline partiel | Avec Ollama/local, OPC peut continuer sans dépendre d'un service agent cloud. |
| Packaging local | Installation dans `/Applications` avec smoke/visual checks et refus si l'app tourne. |

## Ce que Codex fait mieux qu'OPC

| Domaine | Pourquoi |
|---|---|
| Agent engineering | Codex combine édition, terminal, web, plugins, MCP, mémoire, skills et vérification dans un runtime cohérent. |
| Orchestration de tâches | Codex sait maintenir un plan, reprendre après contexte compacté, relancer des commandes et livrer preuves. |
| Séparation outils/permissions | Les outils sont explicitement canalisés et observables par type d'action. |
| Écosystème | Plugins macOS/iOS/web/GitHub/Hugging Face, navigateur, computer use, recherches web. |
| Mémoire et workflows | Hooks, skills, memory summaries, règles durables et spécialisation par tâche. |
| Robustesse à grande échelle | Le modèle plateforme absorbe mieux les gros dépôts et workflows longs. |

## Classement impact / effort

| Rang | Initiative | Impact | Effort | Priorité |
|---:|---|---|---|---|
| 1 | SQLite + migrations + FTS | Très élevé | Élevé | Critique |
| 2 | Provider diagnostics actionnables + validation modèle | Très élevé | Moyen | Haute |
| 3 | Schéma IPC typé généré | Élevé | Moyen | Haute |
| 4 | Timeline virtualisée texte-first | Élevé | Moyen | Haute |
| 5 | Budget contexte par provider avant envoi | Élevé | Moyen | Haute |
| 6 | Notarization + hardened runtime + DMG | Élevé | Moyen | Haute |
| 7 | Task Ledger durable | Élevé | Élevé | Haute |
| 8 | Refactor chirurgical `src/` | Élevé | Élevé | Haute |
| 9 | Tests accessibilité clavier/contrast | Moyen | Faible | Moyenne |
| 10 | Observabilité support bundle v2 | Moyen | Moyen | Moyenne |
| 11 | Policies d'équipe/import sans secrets | Moyen | Moyen | Moyenne |
| 12 | SEO docs/site | Faible | Faible | Faible |

## Roadmap recommandée

### Sprint 0: stabilisation immédiate

- Ajouter classification provider plus précise: `model_invalid`, `endpoint_format`, `context_length`, `key_missing`, `key_rejected`.
- Ajouter un test spécifique pour un provider qui renvoie `not supported` avec statut auth ou request.
- Ajouter validation modèle depuis découverte `/models` avant sauvegarde ou test.
- Garder le rebuild/install bloqué si `/Applications/OPC.app` tourne.

### Sprint 1: scale local

- Introduire SQLite derrière une interface repository.
- Migrer conversations/messages en premier.
- Garder export/import JSON.
- Ajouter FTS pour recherche messages/projets.
- Mesurer temps de chargement avec 10k messages.

### Sprint 2: IPC contract

- Définir un fichier source de contrats IPC.
- Générer validators main + client renderer.
- Réduire `window.opc` par namespaces: `providers`, `runtime`, `projects`, `state`, `diagnostics`.
- Ajouter tests de payload invalides par canal.

### Sprint 3: UX provider et timeline

- Remplacer les grands panneaux timeline par lignes texte compactes.
- Ajouter détails repliables.
- Afficher corrections provider directes.
- Ajouter sélecteur de modèle découvert.
- Ajouter mode petit contexte par profil.

### Sprint 4: release professionnelle

- Developer ID signing.
- Hardened runtime.
- Notarization.
- DMG/ZIP.
- Smoke installé et vérification signature.
- Stratégie update/rollback.

### Sprint 5: orchestration agentique

- Task Ledger durable.
- État d'étape visible.
- Relance automatique bornée avec raison explicite.
- Vérification minimale obligatoire par tâche.
- Support bundle incluant le ledger.

## Quick wins

| Quick win | Effort | Gain |
|---|---|---|
| Corriger l'ordre et la granularité provider issue | Faible | Réduit immédiatement les faux "à configurer" |
| Afficher `model id` attendu vs nom affiché | Faible | Moins d'erreurs OpenCode/Ollama |
| Ajouter un bouton "Découvrir modèles" dans l'éditeur provider | Faible à moyen | Configuration plus fiable |
| Ajouter une prévisualisation "contexte envoyé" | Moyen | Réduit les erreurs `Prompt is too long` |
| Timeline compacte par défaut | Moyen | UX plus lisible |
| Test clavier settings/provider | Faible | Accessibilité et qualité |
| Gate CI taille de fichier | Faible | Stoppe la dette future |

## Risques techniques à anticiper

| Risque | Probabilité | Impact | Mitigation |
|---|---|---|---|
| Migration SQLite casse les historiques existants | Moyenne | Élevé | Migration idempotente, backup JSON automatique, tests fixtures réels |
| Refactor `src/` change le comportement CLI | Élevée | Élevé | Tests de caractérisation, extraction module par module |
| Provider free change format ou limite sans prévenir | Élevée | Moyen | Discovery dynamique, diagnostics précis, cooldown, fallback manuel |
| Notarization révèle problèmes entitlements/resources | Moyenne | Moyen | Pipeline dédié, vérifier bundle avant release |
| IPC typé ralentit les changements UX | Moyenne | Moyen | Génération automatique et tests snapshot contrats |
| Virtualisation casse sélection/copie de texte | Moyenne | Moyen | Tests selection controller et anchors visibles |
| Compactage contexte retire une information critique | Moyenne | Élevé | Afficher résumé envoyé, garder fichiers marqués "read next", permettre override |
| Multi-agent local consomme trop de ressources | Moyenne | Moyen | Queue, limites concurrentes, budget CPU/mémoire |

## Conclusion CTO

OPC ne doit pas être évalué comme un clone direct de Codex. Sa vraie valeur est d'être une app desktop locale qui donne à l'utilisateur le contrôle sur les providers, les projets et les workflows agentiques. Codex reste aujourd'hui supérieur comme runtime d'agent logiciel généraliste.

La trajectoire gagnante est donc hybride: OPC doit s'inspirer de Codex pour la discipline d'orchestration, de contrats, de mémoire et de vérification, tout en gardant son avantage local: provider cockpit, UX macOS, contrôle des clés, modèles locaux/free, et diagnostics visibles.

Priorité recommandée: commencer par provider diagnostics + validation modèle, puis SQLite/FTS, puis IPC typé, puis distribution signée/notarizée.
