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

function toolResultText(block) {
  if (!block || typeof block !== 'object') return ''
  const content = block.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return contentToText(content)
  return JSON.stringify(content ?? '')
}

function anthropicMessagesToOpenAI(body, { reasoningForToolCalls = null } = {}) {
  const messages = []
  if (body.system) {
    messages.push({ role: 'system', content: contentToText(body.system) || String(body.system) })
  }

  for (const message of body.messages || []) {
    const content = message.content
    if (typeof content === 'string') {
      messages.push({ role: message.role, content })
      continue
    }
    if (!Array.isArray(content)) {
      messages.push({ role: message.role, content: String(content || '') })
      continue
    }

    const text = contentToText(content)
    const toolUses = content.filter(block => block?.type === 'tool_use')
    const toolResults = content.filter(block => block?.type === 'tool_result')

    if (message.role === 'assistant' && toolUses.length) {
      const toolCallIds = toolUses.map(block => block.id).filter(Boolean)
      const openaiMessage = {
        role: 'assistant',
        content: text || null,
        tool_calls: toolUses.map(block => ({
          id: block.id,
          type: 'function',
          function: {
            name: block.name,
            arguments: JSON.stringify(block.input || {}),
          },
        })),
      }
      const reasoning = reasoningForToolCalls?.(toolCallIds)
      if (reasoning?.reasoning_content) openaiMessage.reasoning_content = reasoning.reasoning_content
      if (reasoning?.reasoning) openaiMessage.reasoning = reasoning.reasoning
      if (Array.isArray(reasoning?.reasoning_details)) openaiMessage.reasoning_details = reasoning.reasoning_details
      messages.push(openaiMessage)
      continue
    }

    if (message.role === 'user' && toolResults.length) {
      for (const block of toolResults) {
        messages.push({
          role: 'tool',
          tool_call_id: block.tool_use_id,
          content: toolResultText(block),
        })
      }
      if (text) messages.push({ role: message.role, content: text })
      continue
    }

    if (text) messages.push({ role: message.role, content: text })
    for (const block of toolResults) {
      messages.push({
        role: 'tool',
        tool_call_id: block.tool_use_id,
        content: toolResultText(block),
      })
    }
  }
  return messages
}

function anthropicToolsToOpenAI(tools) {
  if (!Array.isArray(tools)) return undefined
  return tools.map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description || '',
      parameters: tool.input_schema || { type: 'object', properties: {} },
    },
  }))
}

function anthropicToolChoiceToOpenAI(toolChoice) {
  if (!toolChoice) return undefined
  if (toolChoice.type === 'auto') return 'auto'
  if (toolChoice.type === 'any') return 'required'
  if (toolChoice.type === 'tool' && toolChoice.name) {
    return { type: 'function', function: { name: toolChoice.name } }
  }
  return undefined
}

function writeSse(res, event, data) {
  res.write(`event: ${event}\n`)
  res.write(`data: ${JSON.stringify(data)}\n\n`)
}

function anthropicMessageStart(model) {
  return {
    type: 'message_start',
    message: {
      id: `msg_${Date.now().toString(36)}`,
      type: 'message',
      role: 'assistant',
      model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    },
  }
}

function mapStopReason(reason) {
  if (reason === 'tool_calls') return 'tool_use'
  if (reason === 'length') return 'max_tokens'
  return 'end_turn'
}

function openaiMessageToAnthropic(choice, model) {
  const message = choice?.message || {}
  const content = []
  const fallbackText = message.content || message.reasoning_content
  if (fallbackText) content.push({ type: 'text', text: fallbackText })
  for (const tool of message.tool_calls || []) {
    let input = {}
    try {
      input = JSON.parse(tool.function?.arguments || '{}')
    } catch {
      input = {}
    }
    content.push({
      type: 'tool_use',
      id: tool.id,
      name: tool.function?.name,
      input,
    })
  }
  return {
    id: `msg_${Date.now().toString(36)}`,
    type: 'message',
    role: 'assistant',
    model,
    content,
    stop_reason: mapStopReason(choice?.finish_reason),
    stop_sequence: null,
    usage: { input_tokens: 0, output_tokens: 0 },
  }
}

module.exports = {
  anthropicMessageStart,
  anthropicMessagesToOpenAI,
  anthropicToolsToOpenAI,
  anthropicToolChoiceToOpenAI,
  mapStopReason,
  openaiMessageToAnthropic,
  writeSse,
}
