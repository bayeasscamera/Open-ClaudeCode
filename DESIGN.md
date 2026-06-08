# OPC DESIGN.md

## Intention

OPC est une application desktop d'agent CLI. Le design doit donner une impression d'outil professionnel, rapide et contrôlable: pas une landing page, pas un dashboard décoratif. L'interface doit prioriser le chat et masquer les fonctions secondaires tant qu'elles ne sont pas nécessaires.

## Atmosphère

- Premium sobre, orienté développeur.
- Interface sombre type workspace agent: sidebar graphite, conversation noir chaud, surfaces contrôle gris mat.
- Accent orange OPC utilisé pour guider l'attention et le branding, jamais comme décoration massive.
- Densité desktop calme: peu d'éléments visibles par défaut, avec les options avancées dans les réglages, l'inspecteur ou le contexte courant.
- Les animations doivent rester discrètes et non bloquantes.

## Tokens

### Couleurs

- `canvas`: `#1c1c1b`
- `canvas-raised`: `#242423`
- `surface`: `#2a2a29`
- `surface-soft`: `#30302f`
- `surface-warm`: `#352a25`
- `text`: `#ebe7df`
- `text-soft`: `#c9c4bb`
- `muted`: `#a19d95`
- `muted-soft`: `#77736c`
- `border`: `#454442`
- `border-strong`: `#5a5855`
- `accent`: `#d9774c`
- `accent-strong`: `#f09a6e`
- `accent-soft`: `rgba(217, 119, 76, 0.16)`
- `sidebar`: `#252524`
- `sidebar-raised`: `#30302f`
- `danger`: `#d06b63`
- `success`: `#79b88b`
- `info`: `#85a9c2`

### Typographie

- Interface: `Inter, ui-sans-serif, system-ui, -apple-system`.
- Chemins, commandes, code: `ui-monospace, SFMono-Regular, Menlo, Consolas`.
- Titres: 14-24px, poids 760-880, letter-spacing 0.
- Texte rapport: 15px, line-height 1.65.
- Labels chrome: 10-12px, uppercase, poids 780-880.

### Formes

- Rayon standard: 12px.
- Rayon panel: 18px.
- Rayon modal: 22px.
- Boutons compacts: 10-14px de rayon.
- Pills uniquement pour métadonnées, tags, status et actions secondaires.

### Espacement

- Grille compacte: 6px, 8px, 12px, 16px, 24px.
- Messages: contenu max 1160px.
- Panels runtime: padding 16-18px.
- Composer: stable en bas, padding interne 8px, contrôles 42px.

## Layout

### Shell

- Trois zones: sidebar sessions, conversation, inspecteur.
- Quand l'inspecteur est fermé, la conversation doit prendre toute la largeur restante.
- La topbar et le composer restent fixes; seul le flux conversation doit scroller.
- Les zones de drag fenêtre ne doivent pas interférer avec la sélection/copier du texte.

### Sidebar

- Fond graphite mat, contraste fort, statut CLI visible en bas.
- Navigation principale minimale: `Chat`, puis `Nouveau chat`, une action compacte `Projet` et la liste des sessions.
- `Projects`, `Artifacts` et `Customize` ne doivent pas apparaître comme entrées de navigation principales.
- Les projets restent disponibles via une action compacte `Projet`, le sélecteur et les réglages; les logs/artifacts via l'icône inspecteur; la personnalisation via l'icône réglages.
- Les sessions doivent être scannables.
- L'état actif utilise une barre accent à gauche et une surface sombre légèrement élevée.
- Recherche et boutons doivent rester compacts.

### Topbar

- Badge local/free discret centré. Les contrôles runtime détaillés restent dans le DOM et dans Settings, mais ne doivent pas encombrer l'écran principal.
- Les labels doivent rester courts et lisibles.
- Les actions rapides à droite doivent être iconiques/compactes.
- La poignée de déplacement doit rester visible mais ne pas voler l'espace de travail.
- `Think` doit refléter les capacités du modèle: actif seulement si supporté, désactivé avec un titre explicite sinon.
- Le test provider doit exposer aussi les limitations du modèle sélectionné: agent CLI, streaming, outils, Think, raffinage.
- Settings > Providers est limité aux providers runtime `NVIDIA` et `Ollama`; les anciens providers tiers doivent être nettoyés au démarrage plutôt que rester sélectionnables.
- Ollama doit être ajoutable en un clic avec `http://localhost:11434/v1`, sans authentification, en transport OpenAI-compatible.
- Chaque modèle/provider dans Settings doit exposer une action compacte `Supprimer`, confirmée avant écriture, qui retire le profil persistant et bascule le modèle par défaut si nécessaire.
- Settings > Providers doit permettre de déclarer ces capacités par modèle (`agent`, `streaming`, `tools`, `toolChoice`, `temperature`, `thinking`, `refine`, reasoning). OPC ne doit jamais supposer qu'un nouveau provider accepte `thinking`.

### Conversation

- Messages utilisateur alignés à droite dans une bulle sombre légèrement élevée.
- Réponses assistant: rapport lisible dans une surface sombre, avec typographie markdown propre.
- Les actions `Copier`, `Relancer`, `Modifier`, test modèle et dossier restent sous le message concerné, sous forme d'icônes discrètes avec libellé en `title`, jamais comme gros boutons texte.
- Conversation vide: accueil centré `Bonsoir, Asse.` et composer compact, sans micro ni audio, sans texte explicatif supplémentaire.
- Le sélecteur de modèle doit être visible dans la barre de chat, compact, transparent, tronqué proprement et synchronisé avec le modèle runtime; il reste sur la ligne d'actions inférieure et ne réduit jamais la largeur du texte saisi.
- Le `+` du composer est le point d'entrée unique des actions ajoutées à la barre de chat; les nouvelles fonctions doivent vivre dans ce menu plutôt que s'empiler dans la barre.
- `Ajouter un dossier` ouvre un sélecteur système, définit ce dossier comme répertoire de travail OPC et, si un projet est actif, indexe les fichiers scannés sans demander à l'utilisateur de coller un chemin.
- Suggestions sous composer: Écrire, Apprendre, Code, Cowork. Elles sont visuelles et ne doivent pas détourner les actions runtime principales.
- Le champ chat contient un bouton `✦` de raffinage: il améliore le brouillon avec le modèle de raffinage configuré sans l'envoyer.
- Après raffinage, une action `↶` doit restaurer le brouillon précédent.
- Le modèle de raffinage se règle dans Settings > Runtime et doit rester indépendant du modèle de conversation.
- Les modèles proposés pour le raffinage doivent exclure les profils non chat/agent, comme GitLab Code Suggestions.
- Le bouton `✦` ne doit utiliser que des profils dont la capacité `refine` est vraie.
- Settings > Interface expose `Taille du texte` (`Small`, `Medium`, `Large`) et applique ce choix aux bulles de conversation, au markdown et au composer sans agrandir la navigation.
- Activité runtime au-dessus du rapport, structurée en:
  - état actuel,
  - progression,
  - diagnostics,
  - étapes,
  - outils.
- L'activité runtime est détaillée seulement pendant `queued`/`running` ou en erreur; après succès elle se réduit à une ligne compacte `Terminé`, sans panneau `Dernière activité` persistant.
- Les rapports longs doivent permettre la sélection partielle et la copie stable.

### Outils

- Chaque outil doit afficher son type, sa cible et son contenu utile.
- Shell/Edit/Web sont développés par défaut.
- Commandes et patches doivent utiliser une surface code sombre lisible.
- Les champs de détails sont en deux colonnes desktop, une colonne mobile.

### Projets & mémoire

- Le contexte projet doit afficher immédiatement ce qui sera injecté: mémoire, instructions, fichiers indexés, fichiers à lire, compétences, sessions et runtime isolé.
- Mémoire et instructions sont des surfaces éditables locales, lisibles comme des ressources projet, pas comme de simples champs cachés.
- Les fichiers doivent expliciter leur état: attaché, indexé, erreur, ou marqué "lire prochain prompt".
- Chaque projet doit rendre visible que ses données restent locales à OPC.

### Environnement local

- Settings doit exposer un centre de contrôle local: CLI, bridge provider, mémoire, données, providers locaux et outils agent.
- Les erreurs provider doivent rester actionnables: modèle sélectionné, état du test, cause probable, action suivante.
- Le mode local doit être une garantie UX: pas de dépendance implicite à un service externe pour les projets, mémoire, historique ou configuration.

## Etats

- Running: accent orange.
- Done: vert discret.
- Warning/error: rouge, avec message lisible.
- Empty: surface douce avec action claire.
- Disabled: opacité réduite sans perdre la forme.
- Focus: contour accent doux, jamais suppression complète de feedback.

## Règles

- Pas de cartes imbriquées inutiles.
- Pas de hero marketing.
- Pas de gradient décoratif lourd dans la zone conversation.
- Pas de texte qui déborde de son conteneur.
- Pas de refresh visuel qui casse la sélection ou remonte le scroll.
- Chaque refonte UI doit préserver la rapidité et les tests visuels.

## Vérification visuelle

Avant de livrer un changement UI:

1. Lancer les tests renderer et smoke UI.
2. Lancer le smoke visuel.
3. Inspecter au moins l'écran principal, le contexte projet, l'inspecteur et les réglages.
4. Vérifier: overflow, contraste, sticky topbar/composer, scroll conversation, sélection/copie, états erreur/running/done.
