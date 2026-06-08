function eachSseData(raw, visitor) {
  for (const frame of String(raw || '').split(/\n\n+/)) {
    const dataLines = frame.split(/\n/).filter(line => line.startsWith('data:'))
    for (const dataLine of dataLines) {
      const data = dataLine.slice(5).trim()
      if (!data || data === '[DONE]') continue
      try {
        visitor(JSON.parse(data))
      } catch {
        // Ignore malformed SSE frames from upstream providers.
      }
    }
  }
}

function anthropicDeltaText(delta = {}) {
  if (delta.type === 'text_delta') return delta.text || ''
  return delta.text || ''
}

function openAiDeltaText(parsed = {}) {
  const choice = parsed.choices?.[0]
  const delta = choice?.delta || {}
  return delta.content || choice?.message?.content || ''
}

function collectProviderStreamText(raw) {
  let text = ''
  eachSseData(raw, parsed => {
    if (parsed.choices) {
      text += openAiDeltaText(parsed)
      return
    }
    if (parsed.type === 'content_block_start' && parsed.content_block?.type === 'text') {
      text += parsed.content_block.text || ''
    }
    if (parsed.type === 'content_block_delta') text += anthropicDeltaText(parsed.delta)
  })
  return text
}

function collectAnthropicStreamText(raw) {
  let text = ''
  eachSseData(raw, parsed => {
    if (parsed.type === 'content_block_start' && parsed.content_block?.type === 'text') {
      text += parsed.content_block.text || ''
    }
    if (parsed.type === 'content_block_delta') text += anthropicDeltaText(parsed.delta)
  })
  return text
}

module.exports = {
  collectAnthropicStreamText,
  collectProviderStreamText,
}
