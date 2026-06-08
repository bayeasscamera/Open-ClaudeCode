const {
  anthropicMessageStart,
  mapStopReason,
  openaiMessageToAnthropic,
  writeSse,
} = require('./providerProtocol.cjs')

function streamOpenAIAsAnthropic(upstream, res, model, {
  waitStatusIntervalMs = 10000,
  initialChunk = null,
  onReasoningTrace = null,
} = {}) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })
  writeSse(res, 'message_start', anthropicMessageStart(model))

  let buffer = ''
  let textOpen = false
  let textIndex = 0
  let nextIndex = 0
  const toolBlocks = new Map()
  let finalReason = 'end_turn'
  let finished = false
  let sawText = false
  let reasoningFallback = ''
  let reasoningDetails = []
  const pingTimer = setInterval(() => {
    if (!finished && !res.destroyed) writeSse(res, 'ping', { type: 'ping' })
  }, waitStatusIntervalMs)

  function ensureTextBlock() {
    if (textOpen) return
    textIndex = nextIndex++
    textOpen = true
    writeSse(res, 'content_block_start', {
      type: 'content_block_start',
      index: textIndex,
      content_block: { type: 'text', text: '' },
    })
  }

  function ensureToolBlock(toolDelta) {
    const sourceIndex = toolDelta.index || 0
    if (toolBlocks.has(sourceIndex)) return toolBlocks.get(sourceIndex)
    const block = {
      index: nextIndex++,
      id: toolDelta.id || `toolu_${Date.now().toString(36)}_${sourceIndex}`,
      name: toolDelta.function?.name || 'tool',
    }
    toolBlocks.set(sourceIndex, block)
    writeSse(res, 'content_block_start', {
      type: 'content_block_start',
      index: block.index,
      content_block: { type: 'tool_use', id: block.id, name: block.name, input: {} },
    })
    return block
  }

  function ensureAnthropicToolBlock(sourceIndex, contentBlock = {}) {
    if (toolBlocks.has(sourceIndex)) return toolBlocks.get(sourceIndex)
    const block = {
      index: nextIndex++,
      id: contentBlock.id || `toolu_${Date.now().toString(36)}_${sourceIndex}`,
      name: contentBlock.name || 'tool',
    }
    toolBlocks.set(sourceIndex, block)
    writeSse(res, 'content_block_start', {
      type: 'content_block_start',
      index: block.index,
      content_block: { type: 'tool_use', id: block.id, name: block.name, input: {} },
    })
    return block
  }

  function writeTextDelta(text) {
    if (!text) return
    sawText = true
    ensureTextBlock()
    writeSse(res, 'content_block_delta', {
      type: 'content_block_delta',
      index: textIndex,
      delta: { type: 'text_delta', text },
    })
  }

  function closeBlocks() {
    if (textOpen) {
      writeSse(res, 'content_block_stop', { type: 'content_block_stop', index: textIndex })
      textOpen = false
    }
    for (const block of toolBlocks.values()) {
      writeSse(res, 'content_block_stop', { type: 'content_block_stop', index: block.index })
    }
    toolBlocks.clear()
  }

  function handleChunk(chunk) {
    if (chunk?.type) {
      handleAnthropicStreamEvent(chunk)
      return
    }
    const choice = chunk.choices?.[0]
    if (!choice) return
    const delta = choice.delta || {}
    if (delta.reasoning_content || delta.reasoning) {
      reasoningFallback += delta.reasoning_content || delta.reasoning || ''
    }
    if (Array.isArray(delta.reasoning_details)) {
      reasoningDetails = reasoningDetails.concat(delta.reasoning_details)
    }
    if (delta.content) writeTextDelta(delta.content)
    for (const toolDelta of delta.tool_calls || []) {
      const block = ensureToolBlock(toolDelta)
      const partial = toolDelta.function?.arguments || ''
      if (partial) {
        writeSse(res, 'content_block_delta', {
          type: 'content_block_delta',
          index: block.index,
          delta: { type: 'input_json_delta', partial_json: partial },
        })
      }
    }
    if (choice.finish_reason) finalReason = mapStopReason(choice.finish_reason)
  }

  function handleAnthropicStreamEvent(event) {
    if (event.type === 'content_block_start') {
      const block = event.content_block || {}
      if (block.type === 'text') writeTextDelta(block.text || '')
      if (block.type === 'thinking') reasoningFallback += block.thinking || ''
      if (block.type === 'tool_use') ensureAnthropicToolBlock(event.index || 0, block)
      return
    }
    if (event.type === 'content_block_delta') {
      const delta = event.delta || {}
      if (delta.type === 'thinking_delta' || delta.thinking) {
        reasoningFallback += delta.thinking || ''
        return
      }
      if (delta.type === 'text_delta' || delta.text) {
        writeTextDelta(delta.text || '')
        return
      }
      if (delta.type === 'input_json_delta') {
        const block = ensureAnthropicToolBlock(event.index || 0)
        const partial = delta.partial_json || ''
        if (partial) {
          writeSse(res, 'content_block_delta', {
            type: 'content_block_delta',
            index: block.index,
            delta: { type: 'input_json_delta', partial_json: partial },
          })
        }
      }
      return
    }
    if (event.type === 'message_delta' && event.delta?.stop_reason) {
      finalReason = event.delta.stop_reason
      return
    }
    if (event.type === 'message_stop') finish()
  }

  function finish() {
    if (finished) return
    finished = true
    clearInterval(pingTimer)
    if (!sawText && reasoningFallback.trim()) {
      ensureTextBlock()
      writeSse(res, 'content_block_delta', {
        type: 'content_block_delta',
        index: textIndex,
        delta: { type: 'text_delta', text: reasoningFallback.trim() },
      })
    }
    if (reasoningFallback.trim() || reasoningDetails.length) {
      onReasoningTrace?.({
        model,
        toolCallIds: Array.from(toolBlocks.values()).map(block => block.id).filter(Boolean),
        reasoningContent: reasoningFallback,
        reasoningDetails,
      })
    }
    closeBlocks()
    writeSse(res, 'message_delta', {
      type: 'message_delta',
      delta: { stop_reason: finalReason, stop_sequence: null },
      usage: { output_tokens: 0 },
    })
    writeSse(res, 'message_stop', { type: 'message_stop' })
    res.end()
  }

  function consumeStreamChunk(chunk) {
    buffer += String(chunk)
    const frames = buffer.split(/\n\n/)
    buffer = frames.pop() || ''
    for (const frame of frames) {
      for (const line of frame.split(/\r?\n/)) {
        if (!line.startsWith('data:')) continue
        const data = line.slice(5).trim()
        if (!data) continue
        if (data === '[DONE]') {
          finish()
          upstream.destroy()
          return
        }
        try {
          handleChunk(JSON.parse(data))
          if (finished) return
        } catch {
          // Ignore malformed upstream frames.
        }
      }
    }
  }

  upstream.on('data', consumeStreamChunk)
  upstream.on('error', finish)
  upstream.on('end', finish)
  res.once('close', () => {
    clearInterval(pingTimer)
    if (!finished) upstream.destroy()
  })
  if (initialChunk) consumeStreamChunk(initialChunk)
}

function writeOpenAIChoiceAsAnthropicStream(res, choice, model) {
  const message = openaiMessageToAnthropic(choice, model)
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })
  writeSse(res, 'message_start', anthropicMessageStart(model))
  message.content.forEach((block, index) => {
    if (block.type === 'text') {
      writeSse(res, 'content_block_start', {
        type: 'content_block_start',
        index,
        content_block: { type: 'text', text: '' },
      })
      if (block.text) {
        writeSse(res, 'content_block_delta', {
          type: 'content_block_delta',
          index,
          delta: { type: 'text_delta', text: block.text },
        })
      }
      writeSse(res, 'content_block_stop', { type: 'content_block_stop', index })
      return
    }
    if (block.type === 'tool_use') {
      writeSse(res, 'content_block_start', {
        type: 'content_block_start',
        index,
        content_block: { type: 'tool_use', id: block.id, name: block.name, input: {} },
      })
      writeSse(res, 'content_block_delta', {
        type: 'content_block_delta',
        index,
        delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input || {}) },
      })
      writeSse(res, 'content_block_stop', { type: 'content_block_stop', index })
    }
  })
  writeSse(res, 'message_delta', {
    type: 'message_delta',
    delta: { stop_reason: message.stop_reason || 'end_turn', stop_sequence: null },
    usage: { output_tokens: 0 },
  })
  writeSse(res, 'message_stop', { type: 'message_stop' })
  res.end()
}

module.exports = {
  streamOpenAIAsAnthropic,
  writeOpenAIChoiceAsAnthropicStream,
}
