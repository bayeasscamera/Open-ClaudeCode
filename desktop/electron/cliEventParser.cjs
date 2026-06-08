function contentToText(content) {
  if (!content) return ''
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map(block => {
      if (!block || typeof block !== 'object') return ''
      if (block.type === 'text') return block.text || ''
      return ''
    })
    .filter(Boolean)
    .join('\n')
}

function textFromCliEvent(event) {
  if (!event || typeof event !== 'object') return ''
  if (event.type === 'result') return event.result || event.text || ''
  if (event.type === 'assistant') return contentToText(event.message?.content || event.content)
  if (event.type === 'stdout') return event.text || ''
  return ''
}

function extractRunResult(stdout) {
  let result = ''
  for (const line of String(stdout || '').split(/\r?\n/)) {
    if (!line.trim()) continue
    try {
      const text = textFromCliEvent(JSON.parse(line))
      if (text) result = text
    } catch {
      if (!result) result = line
    }
  }
  return result
}

function compactEvent(event) {
  if (!event || typeof event !== 'object') return event
  if (event.type !== 'system' || event.subtype !== 'init') return event
  return {
    type: 'system',
    subtype: 'init',
    cwd: event.cwd,
    session_id: event.session_id,
    model: event.model,
    permissionMode: event.permissionMode,
    tools: Array.isArray(event.tools) ? event.tools : [],
  }
}

module.exports = {
  compactEvent,
  contentToText,
  extractRunResult,
  textFromCliEvent,
}
