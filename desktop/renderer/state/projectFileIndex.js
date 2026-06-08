(function () {
  const MAX_PREVIEW_CHARS = 4000
  const MAX_SUMMARY_CHARS = 900
  const MAX_INDEX_CHARS = 12000
  const MAX_KEYWORDS = 18
  const MAX_HEADINGS = 12
  const MAX_SNIPPETS = 4
  const STOPWORDS = new Set([
    'avec',
    'pour',
    'dans',
    'sans',
    'plus',
    'tout',
    'tous',
    'tres',
    'cette',
    'dont',
    'from',
    'that',
    'this',
    'with',
    'have',
    'will',
    'your',
    'vous',
    'nous',
    'leur',
    'leurs',
    'the',
    'and',
    'or',
    'it',
    'is',
    'not',
    'le',
    'la',
    'de',
    'du',
    'un',
    'au',
    'aux',
    'en',
    'et',
    'ou',
    'il',
    'je',
    'tu',
    'ce',
    'ca',
    'se',
    'sa',
    'son',
    'ses',
    'mon',
    'mes',
    'nos',
    'vos',
    'une',
    'des',
    'les',
    'sur',
    'par',
    'est',
    'are',
    'true',
    'false',
  ])

  function compactText(value, max) {
    const text = String(value || '').replace(/\s+/g, ' ').trim()
    if (!max || text.length <= max) return text
    return `${text.slice(0, Math.max(0, max - 3))}...`
  }

  function normalizeText(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
  }

  function termsFromQuery(query) {
    const seen = new Set()
    return normalizeText(query)
      .split(/[^a-z0-9_.-]+/i)
      .map(term => term.trim())
      .filter(term => term.length >= 2 && !STOPWORDS.has(term))
      .filter(term => {
        if (seen.has(term)) return false
        seen.add(term)
        return true
      })
      .slice(0, 12)
  }

  function safeList(value, limit, maxChars) {
    if (!Array.isArray(value)) return []
    const seen = new Set()
    const list = []
    for (const item of value) {
      const text = compactText(item, maxChars)
      if (!text || seen.has(text)) continue
      seen.add(text)
      list.push(text)
      if (list.length >= limit) break
    }
    return list
  }

  function extractHeadings(lines) {
    const headings = []
    for (const line of lines) {
      const trimmed = line.trim()
      const markdown = trimmed.match(/^#{1,6}\s+(.{2,160})$/)
      if (markdown) headings.push(markdown[1])
      else if (/^(class|function|const|let|var|def|async function)\s+[\w$.-]+/.test(trimmed)) headings.push(trimmed)
      else if (/^[A-Z][\w\s/:-]{6,80}:$/.test(trimmed)) headings.push(trimmed.replace(/:$/, ''))
      if (headings.length >= MAX_HEADINGS) break
    }
    return safeList(headings, MAX_HEADINGS, 180)
  }

  function extractKeywords(text) {
    const counts = new Map()
    for (const term of normalizeText(text).split(/[^a-z0-9_.-]+/i)) {
      if (term.length < 4 || STOPWORDS.has(term) || /^\d+$/.test(term)) continue
      counts.set(term, (counts.get(term) || 0) + 1)
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, MAX_KEYWORDS)
      .map(([term]) => term)
  }

  function buildProjectFileIndex(content, metadata = {}) {
    const text = String(content || '').replace(/\u0000/g, '').replace(/\r\n/g, '\n').trim()
    const lines = text ? text.split('\n') : []
    const meaningful = lines.map(line => line.trim()).filter(Boolean)
    const headings = extractHeadings(lines)
    const keywords = extractKeywords([metadata.name, metadata.path, text].filter(Boolean).join('\n'))
    const summarySeed = [
      ...headings.slice(0, 3),
      ...meaningful.filter(line => !/^[`*_#\-\s]+$/.test(line)).slice(0, 6),
    ]
    const summary = compactText(summarySeed.join(' '), MAX_SUMMARY_CHARS) || compactText(text, 420)
    const words = text.match(/\S+/g) || []
    const searchIndex = compactText(
      [
        metadata.name,
        metadata.path,
        headings.join('\n'),
        keywords.join(' '),
        text,
      ]
        .filter(Boolean)
        .join('\n'),
      MAX_INDEX_CHARS,
    )
    return {
      preview: text.slice(0, MAX_PREVIEW_CHARS),
      summary,
      lineCount: text ? lines.length : 0,
      wordCount: words.length,
      headings,
      keywords,
      searchIndex,
      indexedAt: new Date().toISOString(),
    }
  }

  function scoreProjectFile(file, query) {
    const terms = termsFromQuery(query)
    if (!terms.length) return { score: 0, terms: [] }
    const searchable = normalizeText([
      file?.name,
      file?.path,
      file?.summary,
      file?.preview,
      file?.searchIndex,
      ...(file?.headings || []),
      ...(file?.keywords || []),
    ].join('\n'))
    const normalizedName = normalizeText(file?.name || '')
    const normalizedPath = normalizeText(file?.path || '')
    const normalizedSummary = normalizeText(file?.summary || '')
    const normalizedKeywords = normalizeText((file?.keywords || []).join(' '))
    let score = 0
    for (const term of terms) {
      if (normalizedName.includes(term)) score += 18
      if (normalizedPath.includes(term)) score += 8
      if (normalizedKeywords.includes(term)) score += 14
      if (normalizedSummary.includes(term)) score += 10
      const matches = searchable.split(term).length - 1
      score += Math.min(matches, 12)
    }
    const fullQuery = compactText(normalizeText(query), 120)
    if (fullQuery && searchable.includes(fullQuery)) score += 24
    return { score, terms }
  }

  function matchedSnippets(file, query, max = MAX_SNIPPETS) {
    const { terms } = scoreProjectFile(file, query)
    if (!terms.length) return []
    const lines = String(file?.preview || file?.summary || file?.searchIndex || '')
      .replace(/\r\n/g, '\n')
      .split('\n')
    const snippets = []
    for (const line of lines) {
      const clean = line.trim()
      if (!clean) continue
      const normalized = normalizeText(clean)
      if (!terms.some(term => normalized.includes(term))) continue
      snippets.push(compactText(clean, 220))
      if (snippets.length >= max) break
    }
    if (!snippets.length && terms.some(term => normalizeText(file?.path || '').includes(term))) {
      snippets.push(compactText(file.path, 220))
    }
    return snippets
  }

  function searchProjectFiles(files, query, { limit = 0, minScore = 1 } = {}) {
    const source = Array.isArray(files) ? files : []
    const terms = termsFromQuery(query)
    if (!terms.length) return source.map(file => ({ file, score: 0, snippets: [] }))
    const ranked = source
      .map(file => {
        const { score } = scoreProjectFile(file, query)
        return { file, score, snippets: matchedSnippets(file, query) }
      })
      .filter(entry => entry.score >= minScore)
      .sort((a, b) => b.score - a.score || String(a.file?.name || '').localeCompare(String(b.file?.name || '')))
    return limit > 0 ? ranked.slice(0, limit) : ranked
  }

  window.OPCProjectFileIndex = {
    buildProjectFileIndex,
    compactText,
    matchedSnippets,
    normalizeText,
    scoreProjectFile,
    searchProjectFiles,
    termsFromQuery,
  }
})()
