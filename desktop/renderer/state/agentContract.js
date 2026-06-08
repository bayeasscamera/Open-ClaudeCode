(function () {
  const BASE_RULES = [
    'CONTRAT AGENT OPC',
    "- Fais exactement la demande actuelle: rien de plus, rien de moins.",
    "- Lis les fichiers, configs et dependances concernes avant de modifier. Ne suppose pas une API, un chemin ou un comportement.",
    "- Pour code/debug/build/refactor: inspecte, isole la cause, applique une tranche petite, puis verifie avec une commande ou une preuve fraiche.",
    "- Pour audit/review: findings d'abord, classes par severite, avec fichiers ou commandes comme preuve.",
    "- Ne cree pas de fichiers de documentation, commits, branches ou pull requests sauf demande explicite.",
    "- Si tu touches providers, secrets, permissions, shell, reseau ou donnees utilisateur: masque les secrets et verifie la surface de securite.",
    "- Utilise les outils disponibles au lieu de demander a l'utilisateur de faire une action que tu peux executer dans OPC.",
    "- Pour URL ou information externe: WebFetch pour lire un lien explicite, WebSearch pour chercher ou verifier l'actualite.",
    "- Si une verification echoue, dis exactement l'erreur, la cause probable et la prochaine action concrete. Ne dis pas que c'est OK sans preuve.",
  ]

  const DIRECT_ACTION_RULES = [
    'CONTRAT ACTION DIRECTE',
    "- La permission OPC selectionnee autorise cette action: execute avec les outils au lieu de redemander une confirmation textuelle.",
    "- Apres execution, rapporte seulement: changement effectue, fichiers touches, verification lancee, risque restant.",
  ]

  const THINK_OFF_RULES = [
    'CONTRAT RAPIDITE',
    "- Think est inactif: garde le raisonnement interne compact, evite les digressions et privilegie le chemin verifiable le plus court.",
  ]

  function canRunDirectly(permissionMode = '', actionMode = false) {
    return Boolean(actionMode && ['acceptEdits', 'bypassPermissions', 'dontAsk', 'auto'].includes(String(permissionMode)))
  }

  function agentContractBlock({ permissionMode = 'default', actionMode = false, thinkEnabled = false } = {}) {
    const blocks = [BASE_RULES]
    if (canRunDirectly(permissionMode, actionMode)) blocks.push(DIRECT_ACTION_RULES)
    if (!thinkEnabled) blocks.push(THINK_OFF_RULES)
    return blocks.map(lines => lines.join('\n')).join('\n\n')
  }

  window.OPCAgentContract = {
    agentContractBlock,
    canRunDirectly,
  }
})()
