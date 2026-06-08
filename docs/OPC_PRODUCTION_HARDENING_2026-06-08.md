# OPC Production Hardening - 2026-06-08

Ce document trace l'application du plan de stabilisation issu de `docs/OPC_FULL_AUDIT_2026-06-08.md`.

## Changements appliqués

- Secrets providers:
  - L'application packagée refuse par défaut l'enregistrement de clés API en clair si `safeStorage` est indisponible.
  - Les modèles découverts/importés héritent du profil source via `authProfileId` au lieu de dupliquer la clé.
  - Les timeouts provider sont configurables avec une borne basse à 5 secondes et une borne haute à 30 minutes.

- Validations runtime:
  - La confiance workspace repose sur `realpath`, ce qui bloque les échappements par lien symbolique.
  - Les imports de sauvegarde d'état et de projet rejettent les fichiers trop volumineux ou mal formés.
  - Les liens Markdown rendus dans les messages n'acceptent que `https:` et `http:` local.
  - La lecture de fichiers projet ferme toujours son descripteur.

- Persistence:
  - La recherche SQLite FTS normalise les accents avant de construire la requête.
  - Les sauvegardes d'état importées sont limitées à 5 Mo et validées avant exposition au renderer.

- CI:
  - Le workflow desktop exécute désormais `test:ui` et `test:visual` après `verify:ci`.

## Garde-fous ajoutés

- Tests provider: refus de secrets en clair en mode strict, héritage d'auth sans duplication, import de modèles découverts sans clé copiée.
- Tests IPC/persistence: workspace symlink, imports invalides, sauvegarde trop volumineuse, FTS accent-insensitive.
- Tests renderer: neutralisation des liens Markdown dangereux.

## Verification attendue

```bash
npm run typecheck:refactor
npm --prefix desktop test
npm run verify:ci
npm --prefix desktop run test:ui
npm --prefix desktop run test:visual
```
