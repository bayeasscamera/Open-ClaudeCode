const { collectAnthropicStreamText } = require('./providerAnthropicProtocol.cjs')
const {
  anthropicMessagesToOpenAI,
  anthropicToolsToOpenAI,
  anthropicToolChoiceToOpenAI,
} = require('./providerProtocol.cjs')

const ESTIMATED_CHARS_PER_TOKEN = 4
const CONTEXT_TRUNCATION_NOTICE = 'OPC: contexte précédent tronqué pour respecter la fenêtre du provider.'

function openAIMessages(body, profile, providerConfig, reasoningStore) {
  const caps = providerConfig.capabilities?.(profile) || {}
  return anthropicMessagesToOpenAI(body, {
    reasoningForToolCalls: caps.reasoningPassThrough
      ? toolCallIds => reasoningStore?.find?.(profile, toolCallIds)
      : null,
  })
}

function openAIContentText(content) {
  if (typeof content === 'string') return content
  if (content === null || content === undefined) return ''
  if (Array.isArray(content)) return content.map(openAIContentText).filter(Boolean).join('\n')
  if (typeof content === 'object') {
    if (typeof content.text === 'string') return content.text
    try {
      return JSON.stringify(content)
    } catch {
      return String(content)
    }
  }
  return String(content)
}

function estimatedTextTokens(value) {
  return Math.ceil(String(value || '').length / ESTIMATED_CHARS_PER_TOKEN)
}

function estimatedMessageTokens(message = {}) {
  let tokens = 4 + estimatedTextTokens(message.role || '')
  tokens += estimatedTextTokens(openAIContentText(message.content))
  if (Array.isArray(message.tool_calls)) tokens += estimatedTextTokens(JSON.stringify(message.tool_calls))
  if (message.tool_call_id) tokens += estimatedTextTokens(message.tool_call_id)
  if (message.name) tokens += estimatedTextTokens(message.name)
  return tokens
}

function estimatedMessagesTokens(messages = []) {
  return messages.reduce((sum, message) => sum + estimatedMessageTokens(message), 0)
}

function truncateTextToTokenBudget(value, budgetTokens) {
  const text = String(value || '')
  const maxChars = Math.max(0, Math.floor(Number(budgetTokens || 0) * ESTIMATED_CHARS_PER_TOKEN))
  if (!text || text.length <= maxChars) return text
  if (maxChars <= 32) return text.slice(0, maxChars)
  return `${text.slice(0, Math.max(0, maxChars - 28)).trimEnd()}\n[...contexte tronqué...]`
}

function truncateOpenAIMessage(message = {}, budgetTokens = 0) {
  const content = truncateTextToTokenBudget(openAIContentText(message.content), Math.max(1, budgetTokens - 4))
  if (!content) return null
  const next = {
    ...message,
    content,
  }
  delete next.tool_calls
  delete next.tool_call_id
  return next
}

function trimOpenAIMessagesToInputBudget(messages = [], inputTokenLimit = 0) {
  const limit = Number(inputTokenLimit)
  if (!Number.isFinite(limit) || limit <= 0) return messages
  if (estimatedMessagesTokens(messages) <= limit) return messages

  const leadingSystem = []
  let cursor = 0
  while (messages[cursor]?.role === 'system') {
    leadingSystem.push(messages[cursor])
    cursor += 1
  }

  const notice = { role: 'system', content: CONTEXT_TRUNCATION_NOTICE }
  const tail = messages.slice(cursor)
  const fixed = [...leadingSystem, notice]
  const kept = []
  let remaining = limit - estimatedMessagesTokens(fixed)

  for (let index = tail.length - 1; index >= 0; index -= 1) {
    const message = tail[index]
    const cost = estimatedMessageTokens(message)
    if (cost <= remaining) {
      kept.unshift(message)
      remaining -= cost
      continue
    }
    if (!kept.length) {
      const truncated = truncateOpenAIMessage(message, Math.max(32, remaining))
      if (truncated) kept.unshift(truncated)
    }
    break
  }

  return [...fixed, ...kept]
}

function openAIToolCallsText(toolCalls = []) {
  return toolCalls
    .map(call => {
      const name = call?.function?.name || call?.name || 'outil'
      const args = call?.function?.arguments || call?.arguments || ''
      return args ? `- ${name}: ${args}` : `- ${name}`
    })
    .filter(Boolean)
    .join('\n')
}

function orphanToolMessageAsUser(message = {}) {
  const label = message.tool_call_id || message.name || 'outil'
  const content = openAIContentText(message.content).trim()
  return {
    role: 'user',
    content: `[Résultat outil ${label}]\n${content}`.trim(),
  }
}

function normalizeOpenAIToolSequence(messages = [], caps = {}) {
  if (caps.tools === false || caps.toolResultRole === false) {
    return messages
      .map(message => {
        if (!message || typeof message !== 'object' || Array.isArray(message)) return null
        if (message.role === 'tool') return orphanToolMessageAsUser(message)
        if (message.role !== 'assistant' || !Array.isArray(message.tool_calls) || !message.tool_calls.length) {
          const next = { ...message }
          delete next.tool_calls
          delete next.tool_call_id
          return next
        }
        const toolText = openAIToolCallsText(message.tool_calls)
        const content = openAIContentText(message.content).trim()
        const next = { ...message }
        delete next.tool_calls
        delete next.tool_call_id
        next.content = [
          content,
          toolText ? `[Appel outil demandé]\n${toolText}` : '',
        ].filter(Boolean).join('\n\n') || null
        return next
      })
      .filter(Boolean)
  }

  const normalized = []
  let pendingToolCallIds = new Set()

  for (const message of messages) {
    if (!message || typeof message !== 'object' || Array.isArray(message)) continue

    if (message.role === 'assistant') {
      const next = { ...message }
      const toolCalls = Array.isArray(next.tool_calls) ? next.tool_calls : []
      pendingToolCallIds = new Set()

      if (caps.tools === false && toolCalls.length) {
        delete next.tool_calls
        if (next.content === null || next.content === undefined || next.content === '') {
          next.content = `[Appel outil demandé]\n${openAIToolCallsText(toolCalls)}`.trim()
        }
        normalized.push(next)
        continue
      }

      for (const call of toolCalls) {
        if (call?.id) pendingToolCallIds.add(String(call.id))
      }
      normalized.push(next)
      continue
    }

    if (message.role === 'tool') {
      const toolCallId = String(message.tool_call_id || '')
      if (caps.tools !== false && toolCallId && pendingToolCallIds.has(toolCallId)) {
        pendingToolCallIds.delete(toolCallId)
        normalized.push({ ...message, content: openAIContentText(message.content) })
      } else {
        pendingToolCallIds = new Set()
        normalized.push(orphanToolMessageAsUser(message))
      }
      continue
    }

    pendingToolCallIds = new Set()
    const next = { ...message }
    if (caps.tools === false) delete next.tool_calls
    normalized.push(next)
  }

  return normalized
}

function buildOpenAIRequest(body, profile, providerConfig, { reasoningStore = null } = {}) {
  const caps = providerConfig.capabilities?.(profile) || {}
  const messages = providerConfig.withSystemPrefix(openAIMessages(body, profile, providerConfig, reasoningStore), profile)
  const outputTokens = providerConfig.maxTokens(profile, body.max_tokens)
  const normalizedMessages = normalizeOpenAIToolSequence(messages, caps)
  const inputTokenLimit = providerConfig.maxInputTokens?.(profile, outputTokens)
  const request = {
    model: profile.model,
    messages: normalizeOpenAIToolSequence(trimOpenAIMessagesToInputBudget(normalizedMessages, inputTokenLimit), caps),
    max_tokens: outputTokens,
    stream: Boolean(body.stream),
    ...providerConfig.extraBody(profile),
  }
  if (caps.temperature !== false && body.temperature !== undefined) request.temperature = body.temperature
  const tools = anthropicToolsToOpenAI(body.tools)
  if (caps.tools !== false && tools?.length) request.tools = tools
  const toolChoice = anthropicToolChoiceToOpenAI(body.tool_choice)
  if (caps.toolChoice !== false && toolChoice) request.tool_choice = toolChoice
  return request
}

function withAnthropicSystemPrefix(body, profile) {
  const prefix = String(profile?.systemPrefix || '').trim()
  if (!prefix) return body
  if (!body.system) return { ...body, system: prefix }
  if (typeof body.system === 'string') return { ...body, system: `${prefix}\n\n${body.system}` }
  if (Array.isArray(body.system)) {
    return { ...body, system: [{ type: 'text', text: prefix }, ...body.system] }
  }
  return body
}

function buildAnthropicRequest(body, profile, providerConfig, { forceStream = null } = {}) {
  return withAnthropicSystemPrefix({
    ...body,
    model: profile.model,
    max_tokens: providerConfig.maxTokens(profile, body.max_tokens),
    stream: forceStream === null ? Boolean(body.stream) : Boolean(forceStream),
    ...providerConfig.extraBody(profile),
  }, profile)
}

function textFromAnthropicContent(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map(block => {
      if (typeof block === 'string') return block
      if (block?.type === 'text') return block.text || ''
      if (block?.type === 'tool_result') return typeof block.content === 'string' ? block.content : textFromAnthropicContent(block.content)
      return ''
    })
    .filter(Boolean)
    .join('\n')
}

function anthropicSystemText(system) {
  if (typeof system === 'string') return system
  return textFromAnthropicContent(system)
}

function anthropicPromptText(body = {}) {
  const parts = []
  const system = anthropicSystemText(body.system)
  if (system) parts.push(system)
  for (const message of Array.isArray(body.messages) ? body.messages : []) {
    const text = textFromAnthropicContent(message.content)
    if (text) parts.push(`${message.role || 'message'}:\n${text}`)
  }
  return parts.join('\n\n').trim()
}

function lastAnthropicUserText(body = {}) {
  const messages = Array.isArray(body.messages) ? body.messages : []
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role !== 'user') continue
    const text = textFromAnthropicContent(messages[index].content).trim()
    if (text) return text
  }
  return ''
}

function withoutGitLabReservedExtraBody(extra = {}) {
  const {
    file_name: fileNameSnake,
    fileName,
    intent,
    project_path: projectPathSnake,
    projectPath,
    content_above_cursor: contentAboveCursor,
    contentBelowCursor,
    content_below_cursor: contentBelowCursorSnake,
    user_instruction: userInstruction,
    stream,
    current_file: currentFile,
    ...rest
  } = extra
  void fileNameSnake
  void fileName
  void intent
  void projectPathSnake
  void projectPath
  void contentAboveCursor
  void contentBelowCursor
  void contentBelowCursorSnake
  void userInstruction
  void stream
  void currentFile
  return rest
}

function buildGitLabCodeSuggestionsRequest(body, profile, providerConfig) {
  const extra = providerConfig.extraBody(profile) || {}
  const prompt = anthropicPromptText(body)
  const lastUser = lastAnthropicUserText(body)
  const instruction = lastUser || prompt || 'Réponds avec une suggestion utile.'
  const contentAboveCursor = String(prompt || instruction).slice(-120000)
  const fileName = extra.file_name || extra.fileName || profile.fileName || profile.file_name || 'opc_request.py'
  const request = {
    ...withoutGitLabReservedExtraBody(extra),
    current_file: {
      file_name: fileName,
      content_above_cursor: contentAboveCursor,
      content_below_cursor: extra.content_below_cursor || extra.contentBelowCursor || '',
    },
    intent: extra.intent || profile.intent || 'generation',
    stream: false,
    user_instruction: instruction,
  }
  const projectPath = extra.project_path || extra.projectPath || profile.project_path || profile.projectPath
  if (projectPath) request.project_path = projectPath
  return request
}

function gitLabCodeSuggestionsText(parsed) {
  const choice = parsed?.choices?.[0]
  return choice?.text || choice?.message?.content || parsed?.completion || parsed?.text || ''
}

function anthropicTextMessagePayload(text, model) {
  return {
    id: `msg_opc_${Date.now()}`,
    type: 'message',
    role: 'assistant',
    model,
    content: text ? [{ type: 'text', text }] : [],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 0, output_tokens: 0 },
  }
}

function writeAnthropicTextMessage(res, text, model) {
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(anthropicTextMessagePayload(text, model)))
}

function writeAnthropicStreamTextMessage(res, raw, model) {
  writeAnthropicTextMessage(res, collectAnthropicStreamText(raw), model)
}

module.exports = {
  anthropicTextMessagePayload,
  buildAnthropicRequest,
  buildGitLabCodeSuggestionsRequest,
  buildOpenAIRequest,
  gitLabCodeSuggestionsText,
  lastAnthropicUserText,
  normalizeOpenAIToolSequence,
  textFromAnthropicContent,
  withAnthropicSystemPrefix,
  writeAnthropicStreamTextMessage,
  writeAnthropicTextMessage,
}
