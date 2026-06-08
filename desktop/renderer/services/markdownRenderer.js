(function () {
  const LOCAL_LINK_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]'])

  function safeMarkdownHref(value) {
    try {
      const url = new URL(String(value || ''), window.location?.href || 'http://localhost/')
      if (url.protocol === 'https:') return url.href
      if (url.protocol === 'http:' && LOCAL_LINK_HOSTS.has(url.hostname)) return url.href
    } catch {
      // Invalid Markdown links are rendered inert.
    }
    return '#'
  }

  function appendInlineText(parent, value) {
    const text = String(value || '')
    const pattern = /(\[[^\]]+\]\([^)]+\)|`[^`]+`|\*\*[^*]+\*\*)/g
    let cursor = 0
    for (const match of text.matchAll(pattern)) {
      if (match.index > cursor) parent.appendChild(document.createTextNode(text.slice(cursor, match.index)))
      const token = match[0]
      if (token.startsWith('[')) {
        const linkMatch = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
        const link = document.createElement('a')
        link.textContent = linkMatch?.[1] || token
        link.href = safeMarkdownHref(linkMatch?.[2])
        link.target = '_blank'
        link.rel = 'noreferrer noopener'
        parent.appendChild(link)
      } else if (token.startsWith('`')) {
        const code = document.createElement('code')
        code.textContent = token.slice(1, -1)
        parent.appendChild(code)
      } else {
        const strong = document.createElement('strong')
        strong.textContent = token.slice(2, -2)
        parent.appendChild(strong)
      }
      cursor = match.index + token.length
    }
    if (cursor < text.length) parent.appendChild(document.createTextNode(text.slice(cursor)))
  }

  function appendParagraph(parent, lines) {
    const text = lines.join(' ').trim()
    if (!text) return
    const paragraph = document.createElement('p')
    appendInlineText(paragraph, text)
    parent.appendChild(paragraph)
  }

  function renderMessageContent(parent, content) {
    const text = String(content || '')
    parent.innerHTML = ''
    parent.classList.toggle('reportRich', /^(#{2,4})\s+/m.test(text) || /```/.test(text) || /^\|.+\|$/m.test(text))
    if (!text.trim()) return

    const lines = text.split(/\r?\n/)
    let paragraph = []
    let list = null
    let orderedList = null
    let codeBlock = null
    let codeLanguage = ''
    let tableRows = []

    function flushParagraph() {
      appendParagraph(parent, paragraph)
      paragraph = []
    }

    function closeList() {
      list = null
      orderedList = null
    }

    function closeCodeBlock() {
      if (!codeBlock) return
      const source = codeBlock.join('\n')
      const pre = document.createElement('pre')
      if (codeLanguage) pre.dataset.language = codeLanguage
      const copy = document.createElement('button')
      copy.type = 'button'
      copy.className = 'codeCopy'
      copy.textContent = 'Copier'
      copy.addEventListener('click', event => {
        event.preventDefault()
        event.stopPropagation()
        Promise.resolve(window.opc?.copyText?.(source) || navigator.clipboard?.writeText(source)).then(() => {
          copy.textContent = 'Copié'
          setTimeout(() => {
            copy.textContent = 'Copier'
          }, 1200)
        }).catch(() => {})
      })
      const code = document.createElement('code')
      code.textContent = source
      pre.appendChild(copy)
      pre.appendChild(code)
      parent.appendChild(pre)
      codeBlock = null
      codeLanguage = ''
    }

    function tableCells(line) {
      return line
        .trim()
        .replace(/^\||\|$/g, '')
        .split('|')
        .map(cell => cell.trim())
    }

    function isTableSeparator(line) {
      return tableCells(line).every(cell => /^:?-{3,}:?$/.test(cell))
    }

    function flushTable() {
      if (!tableRows.length) return
      const rows = tableRows
      tableRows = []
      const table = document.createElement('table')
      const body = document.createElement('tbody')
      const hasHeader = rows.length > 1 && isTableSeparator(rows[1])
      rows.forEach((line, index) => {
        if (hasHeader && index === 1) return
        const row = document.createElement('tr')
        tableCells(line).forEach(cell => {
          const node = document.createElement(hasHeader && index === 0 ? 'th' : 'td')
          appendInlineText(node, cell)
          row.appendChild(node)
        })
        if (row.children.length) body.appendChild(row)
      })
      if (body.children.length) {
        table.appendChild(body)
        parent.appendChild(table)
      }
    }

    for (const line of lines) {
      if (line.trim().startsWith('```')) {
        flushParagraph()
        flushTable()
        closeList()
        if (codeBlock) closeCodeBlock()
        else {
          codeLanguage = line.trim().replace(/^```/, '').trim()
          codeBlock = []
        }
        continue
      }
      if (codeBlock) {
        codeBlock.push(line)
        continue
      }
      if (!line.trim()) {
        flushParagraph()
        flushTable()
        closeList()
        continue
      }
      if (/^-{3,}$/.test(line.trim())) {
        flushParagraph()
        flushTable()
        closeList()
        parent.appendChild(document.createElement('hr'))
        continue
      }
      if (/^\|.+\|$/.test(line.trim()) && line.includes('|')) {
        flushParagraph()
        closeList()
        tableRows.push(line)
        continue
      }
      flushTable()
      const heading = line.match(/^(#{1,4})\s+(.+)$/)
      if (heading) {
        flushParagraph()
        closeList()
        const level = Math.min(4, Math.max(2, heading[1].length))
        const node = document.createElement(`h${level}`)
        appendInlineText(node, heading[2].trim())
        parent.appendChild(node)
        continue
      }
      const bullet = line.match(/^\s*[-*]\s+(.+)$/)
      if (bullet) {
        flushParagraph()
        orderedList = null
        if (!list) {
          list = document.createElement('ul')
          parent.appendChild(list)
        }
        const item = document.createElement('li')
        appendInlineText(item, bullet[1])
        list.appendChild(item)
        continue
      }
      const ordered = line.match(/^\s*\d+\.\s+(.+)$/)
      if (ordered) {
        flushParagraph()
        list = null
        if (!orderedList) {
          orderedList = document.createElement('ol')
          parent.appendChild(orderedList)
        }
        const item = document.createElement('li')
        appendInlineText(item, ordered[1])
        orderedList.appendChild(item)
        continue
      }
      closeList()
      paragraph.push(line.trim())
    }
    flushParagraph()
    flushTable()
    closeList()
    closeCodeBlock()
  }

  window.OPCMarkdown = {
    appendInlineText,
    renderMessageContent,
    safeMarkdownHref,
  }
})()
