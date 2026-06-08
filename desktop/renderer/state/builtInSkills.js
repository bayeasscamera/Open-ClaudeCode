(function () {
  const CLAUDE_CODE_TERMS = [
    'claude',
    'claude code',
    'hook',
    'hooks',
    'mcp',
    'permission',
    'permissions',
    'allowed-tools',
    'sub-agent',
    'subagent',
    'memory',
    'mémoire',
    'claude.md',
    'agents.md',
    'settings.json',
    'slash command',
    'status',
  ]

  const SUPER_EXPERT_TERMS = [
    ...CLAUDE_CODE_TERMS,
    'audit',
    'review',
    'code review',
    'pre-push',
    'debug',
    'debugging',
    'traceback',
    'stack trace',
    'root cause',
    'refactor',
    'refactoring',
    'cleanup',
    'technical debt',
    'dette technique',
    'dependency',
    'dependencies',
    'vulnerability',
    'vulnerabilite',
    'onboarding',
    'architecture',
    'skill',
    'skills',
    'install skill',
    'create skill',
  ]

  const KARPATHY_TERMS = [
    'code',
    'coding',
    'coder',
    'implementation',
    'implémentation',
    'implemente',
    'implémente',
    'patch',
    'fix',
    'bug',
    'corrige',
    'correction',
    'audit',
    'review',
    'code review',
    'refactor',
    'refactoring',
    'refactoring profond',
    'test',
    'tests',
    'verify',
    'vérifie',
    'verification',
    'vérification',
    'simplifie',
    'overengineering',
    'surgical',
    'chirurgical',
    'karpathy',
    'karpathy-guidelines',
    'andrej',
  ]

  const MERCURY_TERMS = [
    'mercury',
    'coder.md',
    'coder',
    'implement',
    'implementation',
    'implémente',
    'feature',
    'create',
    'build',
    'fix',
    'bug',
    'debug',
    'debugging',
    'root cause',
    'cause racine',
    'refactor',
    'refactoring',
    'plan',
    'review',
    'code-review',
    'design',
    'architecture',
    'tdd',
    'test-first',
    'rouge-vert-refactor',
    'verify',
    'verification',
    'vérification',
    'quality gate',
    'quality-gate',
    'security review',
    'security-review',
    'owasp',
    'e2e',
    'build-fix',
    'checkpoint',
    'save-session',
    'resume-session',
    'mode coder',
    'mode debugger',
    'mode architect',
    'mode reviewer',
    'mode orchestrator',
    '/plan',
    '/tdd',
    '/debug',
    '/code-review',
    '/e2e',
    '/build-fix',
    '/verify',
    '/quality-gate',
    '/security-review',
    '/docs',
    '/checkpoint',
  ]

  const DESIGN_MD_TERMS = [
    'awesome-design-md',
    'design.md',
    'design system',
    'systeme design',
    'système design',
    'ui',
    'ux',
    'interface',
    'design',
    'redesign',
    'refonte',
    'style',
    'styles',
    'visuel',
    'visual',
    'premium',
    'layout',
    'mise en page',
    'agencement',
    'tokens',
    'palette',
    'couleur',
    'colors',
    'typographie',
    'typography',
    'spacing',
    'radius',
    'radii',
    'composant',
    'component',
    'responsive',
    'accessibilite',
    'accessibilité',
    'figma',
    'linear',
    'raycast',
    'opencode',
    'vercel',
    'claude design',
    'design premium',
    '/design',
    '/ui',
    '/redesign',
  ]

  const BUILT_IN_SKILLS = [
    {
      id: 'awesome-design-md',
      summaryKey: 'awesomeDesignMd',
      title: 'awesome-design-md',
      description: 'Design system agentique: DESIGN.md, tokens, style cible, composants, responsive, accessibilité et QA visuelle.',
      terms: DESIGN_MD_TERMS,
      contextLines: [
        'COMPETENCE INTEGREE OPC: awesome-design-md',
        'Applique cette competence quand la demande touche UI, UX, design, interface, style premium, layout, composants, responsive, accessibilite ou creation/mise a jour d un DESIGN.md.',
        'Principe DESIGN.md:',
        '- Traite DESIGN.md comme le contrat visuel du projet, complementaire de AGENTS.md/CLAUDE.md: il decrit comment l interface doit paraitre, se comporter et rester coherente.',
        '- Si un DESIGN.md existe, le lire avant toute modification UI; sinon extraire les conventions depuis CSS, composants, captures et produit existant avant de proposer une cible.',
        '- Ne copie pas aveuglement les references awesome-design-md; utilise les comme inspiration selon le domaine: outil developpeur -> OpenCode/Raycast/Linear/Vercel, workspace/projets -> Notion/Linear, IA/agent -> Claude/OpenCode/Ollama.',
        'Checklist design a appliquer:',
        '- Definir ou respecter tokens: palette, typographie, spacing, radius, border, ombres, surfaces, etats hover/focus/disabled/error/loading/empty.',
        '- Organiser les couches UI: navigation, header sticky, contenu scrollable, panneaux outils, composer, rapports, cartes et listes sans cartes imbriquees inutiles.',
        '- Garantir lisibilite et ergonomie: densite adaptee desktop, alignements nets, contrastes suffisants, textes qui ne debordent pas, selection/copie de texte stable.',
        '- Verifier responsive et runtime: aucun overlap, scroll conserve, zones sticky stables, code blocks copiables, erreurs lisibles, flux/progression visibles.',
        '- Pour OPC: garder fluidite et rapidite; eviter animations lourdes, gradients decoratifs excessifs, hero marketing et refactors visuels non lies au workflow agentique.',
        '- Quand le design devient durable, creer ou mettre a jour DESIGN.md avec les decisions reelles et les tokens utilises.',
      ],
    },
    {
      id: 'mercury-coder',
      summaryKey: 'mercuryCoder',
      title: 'mercury-coder',
      description: 'Agent de développement fusionné: modes coder/debugger/architect/reviewer, TDD, quality gate, sécurité et workflows structurés.',
      terms: MERCURY_TERMS,
      contextLines: [
        'COMPETENCE INTEGREE OPC: mercury-coder',
        'Applique cette competence comme version compacte de coder.md quand la demande concerne implementer, creer, build, fix, debug, refactor, plan, review, design, architecture ou une commande /tdd /debug /code-review /quality-gate.',
        'Modes Mercury:',
        '- CODER: analyser, planifier, implementer, tester, valider pour composants, features et scripts.',
        '- DEBUGGER: reproduire, isoler, diagnostiquer, corriger, verifier; aucune correction sans cause racine probable.',
        '- ARCHITECT: analyser les contraintes, modeliser les trade-offs, proposer une cible, valider par increments.',
        '- REVIEWER: verifier d abord la conformite a la demande/spec, puis la qualite code, securite, performance et tests.',
        '- ORCHESTRATOR: pour plans multi-etapes, decomposer en taches explicites, limiter le contexte, verifier chaque tranche avant integration.',
        'Gates Mercury:',
        '- Anti-scope-creep: chaque changement doit etre lie a la demande; ne pas ajouter de fonctionnalite non demandee.',
        '- TDD pragmatique: pour bug/feature testable, creer ou ajuster un test qui reproduit avant le patch; si non viable, expliquer et choisir une verification concrete.',
        '- Verification before completion: ne pas annoncer succes, fin, build OK ou bug corrige sans preuve fraiche dans ce tour.',
        '- Debug systematique: lire erreur, reproduire, comparer avec une implementation similaire, tester une seule hypothese, puis patch minimal.',
        '- Security gate: si auth, secrets, provider keys, API, donnees utilisateur ou input externe sont touches, verifier fuite de secrets, validation entree, injection, XSS, permissions et messages d erreur.',
        '- Quality gate: tests/build/lint disponibles, diff relu contre la demande, risques restants signales.',
        'Commandes d intention supportees par OPC:',
        '- /plan, /tdd, /debug, /code-review, /e2e, /build-fix, /verify, /quality-gate, /security-review, /docs, /checkpoint.',
      ],
    },
    {
      id: 'karpathy-guidelines',
      summaryKey: 'karpathyGuidelines',
      title: 'karpathy-guidelines',
      description: 'Discipline de codage: réduire overengineering, diffs larges, hypothèses cachées et vérification faible.',
      terms: KARPATHY_TERMS,
      contextLines: [
        'COMPETENCE INTEGREE OPC: karpathy-guidelines',
        'Applique cette competence quand la demande implique ecriture, correction, audit, review, refactor ou verification de code.',
        'Regles configurees pour OPC:',
        '- Avant de modifier: expliciter les hypotheses utiles, lire les fichiers concernes et choisir le plus petit changement robuste.',
        '- Pendant la modification: toucher uniquement les lignes liees a la demande, suivre le style local et eviter les abstractions speculatives.',
        '- Refactor: conserver le comportement, avancer par tranches testables et nettoyer seulement ce que le changement rend inutile.',
        '- Audit/review: classer les problemes prouves avant les idees de refonte; citer fichiers, fonctions ou commandes quand possible.',
        '- Verification: definir un critere de succes concret, lancer le test/build/check le plus pertinent, puis signaler clairement les limites restantes.',
      ],
    },
    {
      id: 'claude-code-super-expert',
      summaryKey: 'claudeCodeSuperExpert',
      title: 'claude-code-super-expert',
      description: 'Orchestrateur Claude Code: configuration, audit, debug, refactor, review, onboarding, dépendances et création de skills.',
      terms: SUPER_EXPERT_TERMS,
      contextLines: [
        'COMPETENCE INTEGREE OPC: claude-code-super-expert',
        'Applique cette competence comme orchestrateur expert pour Claude Code et workflows agentiques: configuration, audit, debug, refactor, review, onboarding, dependances et creation de skills.',
        'Routage configure pour OPC:',
        '- Configuration agent: lire CLAUDE.md, AGENTS.md, .claude/settings.json, .mcp.json et verifier permissions/hooks/MCP avant de conclure.',
        '- Debug: reproduire, isoler, tester une hypothese a la fois, corriger minimalement, ajouter regression et verifier runtime.',
        '- Audit/review: prioriser bugs, securite, pertes de donnees, lifecycle runtime, performance, tests et maintenabilite.',
        '- Refactor: garder le comportement stable, extraire par responsabilite, avancer en tranches testables.',
        '- Onboarding: detecter stack, configs, entrypoints, scripts et conventions depuis le code reel.',
        '- Dependances: separer direct/transitif, runtime/dev-only, severite et risque upgrade.',
        '- Skills: privilegier SKILL.md court, references modulaires et scripts deterministes; ne jamais inclure de secrets.',
      ],
    },
    {
      id: 'claude-code-expert',
      summaryKey: 'claudeCodeExpert',
      title: 'claude-code-expert',
      description: 'Contexte Claude Code, CLAUDE.md/AGENTS.md, hooks, MCP, permissions, mémoire, workflows et diagnostic CLI.',
      terms: CLAUDE_CODE_TERMS,
      contextLines: [
        'COMPETENCE INTEGREE OPC: claude-code-expert',
        'Applique cette competence quand la demande touche Claude Code, CLI agentique, hooks, MCP, permissions, memoire, CLAUDE.md/AGENTS.md, slash commands ou workflows autonomes.',
        'Regles configurees pour OPC:',
        '- Detecte et lis en priorite CLAUDE.md, AGENTS.md, .claude/settings.json, .mcp.json, GEMINI.md, QWEN.md et CODEX.md si presents dans le projet.',
        '- Pour les permissions: preferer une politique allow/deny par projet, eviter les confirmations textuelles repetitives, mais ne hardcode jamais de secret dans le code source versionne.',
        '- Pour les hooks: proposer des hooks PostToolUse/Stop/erreur comme automatisations OPC, puis verifier avec un test ou un log.',
        '- Pour MCP: distinguer serveur installe, serveur configure et serveur fonctionnel; verifier le statut avant de conclure.',
        '- Pour workflows longs: decouper en plan, implementation, tests, review; utiliser chemins absolus et contexte complet.',
        '- Pour erreurs CLI: diagnostiquer version, cwd, modele, provider, permissions, max-turns, contexte trop gros et logs avant de refactorer.',
      ],
    },
    {
      id: 'claude-speed-reader',
      summaryKey: 'speedReader',
      title: 'claude-speed-reader',
      description: 'Lecture rapide des longues réponses avec affichage mot par mot et rythme réglable.',
      passive: true,
      terms: [],
      contextLines: [],
    },
  ]

  function normalize(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
  }

  function signalSource(project, prompt = '') {
    const files = Array.isArray(project?.files) ? project.files : []
    return normalize([
      prompt,
      project?.instructions,
      project?.memory,
      ...files.map(file => `${file.name} ${file.path} ${file.summary} ${file.keywords?.join(' ') || ''}`),
    ].join('\n'))
  }

  function hasSignal(project, prompt = '', terms = []) {
    const text = signalSource(project, prompt)
    return terms.some(term => text.includes(normalize(term)))
  }

  function skillById(id) {
    return BUILT_IN_SKILLS.find(skill => skill.id === id)
  }

  function hasSkillSignal(id, project, prompt = '') {
    const skill = skillById(id)
    if (!skill) return false
    if (skill.passive) return true
    return hasSignal(project, prompt, skill.terms)
  }

  function contextBlockForSkill(skill, project, prompt = '') {
    if (!skill || skill.passive || !hasSkillSignal(skill.id, project, prompt)) return ''
    return `${skill.contextLines.join('\n')}\n`
  }

  function activeSkills(project, prompt = '', { includePassive = true } = {}) {
    return BUILT_IN_SKILLS.filter(skill => {
      if (skill.passive) return includePassive
      return hasSkillSignal(skill.id, project, prompt)
    }).map(skill => ({ id: skill.id, title: skill.title, description: skill.description, passive: Boolean(skill.passive) }))
  }

  function list() {
    return BUILT_IN_SKILLS.map(skill => ({
      id: skill.id,
      title: skill.title,
      description: skill.description,
      passive: Boolean(skill.passive),
    }))
  }

  function claudeCodeExpertBlock(project, prompt = '') {
    return contextBlockForSkill(skillById('claude-code-expert'), project, prompt)
  }

  function superExpertBlock(project, prompt = '') {
    return contextBlockForSkill(skillById('claude-code-super-expert'), project, prompt)
  }

  function karpathyGuidelinesBlock(project, prompt = '') {
    return contextBlockForSkill(skillById('karpathy-guidelines'), project, prompt)
  }

  function mercuryCoderBlock(project, prompt = '') {
    return contextBlockForSkill(skillById('mercury-coder'), project, prompt)
  }

  function awesomeDesignMdBlock(project, prompt = '') {
    return contextBlockForSkill(skillById('awesome-design-md'), project, prompt)
  }

  function projectContextBlock(project, prompt = '') {
    return BUILT_IN_SKILLS
      .map(skill => contextBlockForSkill(skill, project, prompt))
      .filter(Boolean)
      .join('\n')
  }

  function profileSummary(project, prompt = '') {
    return BUILT_IN_SKILLS.reduce((summary, skill) => {
      summary[skill.summaryKey] = skill.passive ? true : hasSkillSignal(skill.id, project, prompt)
      return summary
    }, {})
  }

  window.OPCBuiltInSkills = {
    activeSkills,
    awesomeDesignMdBlock,
    claudeCodeExpertBlock,
    hasAwesomeDesignMdSignal: (project, prompt = '') => hasSkillSignal('awesome-design-md', project, prompt),
    hasClaudeCodeSignal: (project, prompt = '') => hasSkillSignal('claude-code-expert', project, prompt),
    hasKarpathyGuidelinesSignal: (project, prompt = '') => hasSkillSignal('karpathy-guidelines', project, prompt),
    hasMercuryCoderSignal: (project, prompt = '') => hasSkillSignal('mercury-coder', project, prompt),
    hasSkillSignal,
    hasSuperExpertSignal: (project, prompt = '') => hasSkillSignal('claude-code-super-expert', project, prompt),
    karpathyGuidelinesBlock,
    list,
    mercuryCoderBlock,
    profileSummary,
    projectContextBlock,
    superExpertBlock,
  }
})()
