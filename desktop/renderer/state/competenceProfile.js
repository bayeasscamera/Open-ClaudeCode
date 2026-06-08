(function () {
  const MAX_CAPABILITIES = 32
  const MAX_RELEVANT = 8
  const MAX_TEXT = 1200

  function compactText(value, max = MAX_TEXT) {
    const text = String(value || '').replace(/\s+/g, ' ').trim()
    if (!text || text.length <= max) return text
    return `${text.slice(0, Math.max(0, max - 3))}...`
  }

  function normalizeText(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
  }

  function termsFromQuery(query) {
    if (window.OPCProjectFileIndex?.termsFromQuery) return window.OPCProjectFileIndex.termsFromQuery(query)
    return normalizeText(query)
      .split(/[^a-z0-9_.-]+/i)
      .filter(term => term.length >= 3)
      .slice(0, 12)
  }

  function pathParts(filePath) {
    return String(filePath || '').split('/').filter(Boolean)
  }

  function domainFromPath(filePath) {
    const parts = pathParts(filePath)
    const skillsIndex = parts.lastIndexOf('skills')
    if (skillsIndex > 0) return parts[skillsIndex - 1]
    const name = parts[parts.length - 1]
    if (name === 'CLAUDE.md' && parts.length > 1) return parts[parts.length - 2]
    return ''
  }

  function skillFolderFromPath(filePath) {
    const parts = pathParts(filePath)
    const skillsIndex = parts.lastIndexOf('skills')
    if (skillsIndex >= 0 && parts[skillsIndex + 1]) return parts[skillsIndex + 1]
    return ''
  }

  function frontMatter(text) {
    const match = String(text || '').match(/^---\s*\n([\s\S]*?)\n---/)
    return match ? match[1] : ''
  }

  function frontMatterValue(header, key) {
    const lines = String(header || '').split('\n')
    const start = lines.findIndex(line => line.trim().startsWith(`${key}:`))
    if (start < 0) return ''
    const first = lines[start].replace(new RegExp(`^\\s*${key}:\\s*`), '').trim()
    if (first && first !== '>' && first !== '|') return first.replace(/^["']|["']$/g, '').trim()
    const collected = []
    for (let index = start + 1; index < lines.length; index += 1) {
      const line = lines[index]
      if (/^\w[\w.-]*:\s*/.test(line)) break
      if (!line.trim()) {
        collected.push('')
        continue
      }
      collected.push(line.replace(/^\s+/, ''))
    }
    return compactText(collected.join(' '), 900)
  }

  function sectionText(text, heading) {
    const source = String(text || '')
    const pattern = new RegExp(`(^|\\n)##\\s+${heading}\\s*\\n`, 'i')
    const match = source.match(pattern)
    if (!match) return ''
    const start = (match.index || 0) + match[0].length
    const rest = source.slice(start)
    const end = rest.search(/\n##\s+/)
    return compactText((end >= 0 ? rest.slice(0, end) : rest), 900)
  }

  function firstBodySummary(text) {
    const source = String(text || '').replace(/^---\s*\n[\s\S]*?\n---/, '').trim()
    const lines = source
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && !/^#{1,6}\s*/.test(line) && !/^[-*`_=\s]+$/.test(line))
      .slice(0, 8)
    return compactText(lines.join(' '), 900)
  }

  function triggerFromDescription(description) {
    const match = String(description || '').match(/\bUse when\b\s+(.+?)(?:\.|$)/i)
    return compactText(match ? match[1] : '', 500)
  }

  function sourceText(file) {
    return String(file?.preview || file?.searchIndex || file?.summary || '')
  }

  function parseSkillFile(file) {
    const filePath = String(file?.path || '')
    if (!/\/skills\/[^/]+\/SKILL\.md$/i.test(filePath)) return null
    const text = sourceText(file)
    const header = frontMatter(text)
    const name = frontMatterValue(header, 'name') || skillFolderFromPath(filePath) || String(file?.name || 'SKILL.md')
    const description = frontMatterValue(header, 'description')
    const summary = sectionText(text, 'Purpose') || sectionText(text, 'Instructions') || firstBodySummary(text)
    const domain = domainFromPath(filePath)
    const trigger = triggerFromDescription(description)
    return {
      id: `${domain || 'skill'}/${name}`,
      type: 'skill',
      name: compactText(name, 120),
      domain: compactText(domain || 'general', 120),
      path: compactText(filePath, 1000),
      description: compactText(description || summary, 700),
      summary: compactText(summary, 700),
      trigger: compactText(trigger, 500),
      keywords: Array.isArray(file?.keywords) ? file.keywords.slice(0, 8) : [],
    }
  }

  function parsePracticeProfile(file) {
    const filePath = String(file?.path || '')
    if (!/\/CLAUDE\.md$/i.test(filePath)) return null
    const text = sourceText(file)
    const title = (text.match(/^#\s+(.+)$/m) || [])[1] || `${domainFromPath(filePath)} profile`
    return {
      id: `${domainFromPath(filePath) || 'profile'}/CLAUDE.md`,
      type: 'practice-profile',
      name: compactText(title, 140),
      domain: compactText(domainFromPath(filePath) || 'general', 120),
      path: compactText(filePath, 1000),
      summary: compactText(sectionText(text, 'Who we are') || firstBodySummary(text), 700),
    }
  }

  function collectGuardrails(files) {
    const joined = files.map(file => sourceText(file)).join('\n').slice(0, 400000)
    const normalized = normalizeText(joined)
    const guardrails = []
    if (/attorney review|not legal advice|draft for attorney review|not a legal conclusion/i.test(joined)) {
      guardrails.push('Les sorties juridiques restent des brouillons a verifier par un professionnel qualifie.')
    }
    if (normalized.includes('placeholder') || normalized.includes('cold-start-interview') || normalized.includes('run setup')) {
      guardrails.push('Verifier le profil pratique avant un travail substantiel; si le profil contient des placeholders, signaler que la calibration manque.')
    }
    if (normalized.includes('citation') || normalized.includes('[verify') || normalized.includes('source attribution')) {
      guardrails.push('Marquer les citations incertaines et demander une verification sur source primaire pour les points juridiques ou dates.')
    }
    if (normalized.includes('jurisdiction')) {
      guardrails.push('Faire apparaitre la juridiction, les dates et les hypotheses au lieu de generaliser.')
    }
    if (normalized.includes('conflict')) {
      guardrails.push('Ne pas ignorer les controles de conflit, privilege, confidentialite ou gates d approbation quand un workflow les exige.')
    }
    return guardrails.slice(0, 6)
  }

  function buildProjectCompetenceProfile(project) {
    const files = Array.isArray(project?.files) ? project.files : []
    if (!files.length) return null
    const skills = []
    const practiceProfiles = []
    for (const file of files) {
      const skill = parseSkillFile(file)
      if (skill) skills.push(skill)
      const profile = parsePracticeProfile(file)
      if (profile) practiceProfiles.push(profile)
    }
    if (!skills.length && !practiceProfiles.length) return null
    const domainCounts = new Map()
    for (const item of [...skills, ...practiceProfiles]) {
      domainCounts.set(item.domain, (domainCounts.get(item.domain) || 0) + 1)
    }
    const domains = Array.from(domainCounts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([name, count]) => ({ name, count }))
    const capabilities = skills
      .sort((a, b) => a.domain.localeCompare(b.domain) || a.name.localeCompare(b.name))
      .slice(0, MAX_CAPABILITIES)
    return {
      version: 1,
      generatedAt: new Date().toISOString(),
      projectId: project?.id || '',
      projectName: project?.name || '',
      sourceFileCount: files.length,
      skillCount: skills.length,
      practiceProfileCount: practiceProfiles.length,
      domains,
      capabilities,
      practiceProfiles: practiceProfiles.slice(0, 16),
      guardrails: collectGuardrails(files),
      legalSkillPack: domains.some(domain => /legal|law|litigation|privacy|regulatory|governance|ip|corporate|employment/i.test(domain.name)),
    }
  }

  function scoreCapability(capability, query) {
    const terms = termsFromQuery(query)
    if (!terms.length) return 0
    const haystack = normalizeText([
      capability.id,
      capability.name,
      capability.domain,
      capability.description,
      capability.summary,
      capability.trigger,
      ...(capability.keywords || []),
    ].join('\n'))
    let score = 0
    for (const term of terms) {
      if (normalizeText(capability.name).includes(term)) score += 18
      if (normalizeText(capability.domain).includes(term)) score += 12
      if (normalizeText(capability.trigger).includes(term)) score += 10
      score += Math.min((haystack.split(term).length - 1) * 2, 14)
    }
    return score
  }

  function relevantCompetences(profile, query, limit = MAX_RELEVANT) {
    const capabilities = Array.isArray(profile?.capabilities) ? profile.capabilities : []
    if (!capabilities.length) return []
    const ranked = capabilities
      .map(capability => ({ capability, score: scoreCapability(capability, query) }))
      .sort((a, b) => b.score - a.score || a.capability.domain.localeCompare(b.capability.domain) || a.capability.name.localeCompare(b.capability.name))
    const hasMatch = ranked.some(entry => entry.score > 0)
    return ranked
      .filter(entry => hasMatch ? entry.score > 0 : true)
      .slice(0, limit)
      .map(entry => ({ ...entry.capability, score: entry.score }))
  }

  function profileSignature(profile) {
    if (!profile) return ''
    return JSON.stringify({
      skills: profile.skillCount || 0,
      profiles: profile.practiceProfileCount || 0,
      domains: profile.domains || [],
      capabilities: (profile.capabilities || []).map(item => [item.id, item.path, item.description]),
      guardrails: profile.guardrails || [],
    })
  }

  function competenceContextBlock(profile, currentPrompt = '') {
    if (!profile || (!profile.skillCount && !profile.practiceProfileCount)) return ''
    const relevant = relevantCompetences(profile, currentPrompt)
    const domains = (profile.domains || []).map(domain => `${domain.name} (${domain.count})`).join(', ')
    const guardrails = profile.guardrails?.length
      ? profile.guardrails.map(item => `- ${item}`).join('\n')
      : '- Lire les fichiers sources de competence avant d appliquer un workflow detaille.'
    const competenceLines = relevant.map(item => [
      `- ${item.domain}/${item.name}: ${compactText(item.description || item.summary, 520)}`,
      item.trigger ? `  Declencheur: ${compactText(item.trigger, 360)}` : '',
      `  Source a lire si pertinent: ${item.path}`,
    ].filter(Boolean).join('\n')).join('\n')
    return [
      'COMPETENCES OPC INJECTEES',
      `Sources detectees: ${profile.skillCount || 0} skill(s), ${profile.practiceProfileCount || 0} profil(s), ${profile.sourceFileCount || 0} fichier(s) projet.`,
      domains ? `Domaines: ${domains}` : '',
      'Competences les plus pertinentes pour cette demande:',
      competenceLines || '(aucune competence specifique detectee pour cette demande)',
      'Regles de competence:',
      "- Ces competences viennent des fichiers du projet; elles ne prouvent pas qu'un plugin externe est installe.",
      "- Si une competence correspond a la demande, lis le fichier Source avec Read avant d appliquer son workflow detaille.",
      "- Applique le workflow comme methode, mais respecte toujours les instructions/memoire du projet OPC et la demande actuelle.",
      profile.legalSkillPack
        ? "- Pour les sujets juridiques: indique juridiction/date/hypotheses, marque les citations a verifier et rappelle que le resultat est un brouillon a revue professionnelle."
        : '',
      guardrails,
      '',
    ].filter(Boolean).join('\n')
  }

  window.OPCCompetenceProfile = {
    buildProjectCompetenceProfile,
    competenceContextBlock,
    compactText,
    profileSignature,
    relevantCompetences,
  }
})()
