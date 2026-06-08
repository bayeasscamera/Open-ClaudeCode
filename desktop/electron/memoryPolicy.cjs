const MEMORY_MAX_CHARS = 16000
const MEMORY_RECENT_LIMIT = 12
const MEMORY_STORED_RUNS = 80
const { redactSecrets } = require('./redaction.cjs')

function defaultMemoryText() {
  return [
    '# OPC durable memory',
    '',
    'Ce fichier est injecté dans chaque exécution OPC Desktop via --append-system-prompt.',
    "Il est indépendant de l'historique visible de l'interface.",
    '',
    '## Règles stables',
    '- Respecter le modèle sélectionné par l’utilisateur. Ne pas basculer silencieusement vers un autre modèle.',
    "- Répondre en français quand l'utilisateur écrit en français.",
    '- Lire le code et les fichiers concernés avant de modifier.',
    '',
    '## Notes persistantes',
    '- Ajouter ici les faits durables qui doivent survivre à un effacement de l’historique.',
    '',
  ].join('\n')
}

function truncateText(value, max) {
  const text = redactSecrets(value).replace(/\s+/g, ' ').trim()
  if (text.length <= max) return text
  return `${text.slice(0, max - 3)}...`
}

function parseRecentEntries(text, limit = MEMORY_RECENT_LIMIT) {
  return String(text || '')
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-limit)
    .map(line => {
      try {
        return JSON.parse(line)
      } catch {
        return null
      }
    })
    .filter(Boolean)
}

function formatRecentPrompt(entries = []) {
  return entries
    .map(entry => {
      const result = entry.result ? ` | résultat: ${entry.result}` : ''
      return `- ${entry.timestamp} | cwd: ${entry.cwd || 'n/a'} | modèle: ${entry.model || 'n/a'} | demande: ${entry.prompt || ''}${result}`
    })
    .join('\n')
}

function buildMemoryPrompt({ cwd, model, notes, recentEntries, maxChars = MEMORY_MAX_CHARS }) {
  const prompt = [
    'MÉMOIRE DURE OPC',
    'Utilise ce bloc comme contexte durable. Il ne remplace pas la demande utilisateur actuelle.',
    `Dossier courant: ${cwd}`,
    `Modèle sélectionné: ${model || 'n/a'}`,
    '',
    'NOTES PERSISTANTES',
    notes || '(aucune note persistante)',
    '',
    'RÉCENTES SESSIONS OPC',
    formatRecentPrompt(recentEntries) || '(aucune session récente)',
  ].join('\n')
  return prompt.length > maxChars ? prompt.slice(prompt.length - maxChars) : prompt
}

function runMemoryEntry(run, code, durationMs, result) {
  return {
    timestamp: new Date().toISOString(),
    cwd: run.cwd,
    model: run.model,
    status: code === 0 ? 'success' : 'error',
    durationMs,
    prompt: truncateText(run.prompt, 800),
    result: truncateText(result, 1200),
  }
}

function serializeRecentEntries(entries, entry, limit = MEMORY_STORED_RUNS) {
  return `${[...entries, entry].slice(-limit).map(item => JSON.stringify(item)).join('\n')}\n`
}

module.exports = {
  MEMORY_RECENT_LIMIT,
  MEMORY_STORED_RUNS,
  buildMemoryPrompt,
  defaultMemoryText,
  parseRecentEntries,
  runMemoryEntry,
  serializeRecentEntries,
  truncateText,
}
