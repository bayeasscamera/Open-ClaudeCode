function createProviderReasoningStore({ maxEntries = 200 } = {}) {
  const entries = new Map()

  function key(model, toolCallId) {
    return `${model || ''}:${toolCallId || ''}`
  }

  function compact() {
    while (entries.size > maxEntries) {
      const first = entries.keys().next().value
      if (!first) break
      entries.delete(first)
    }
  }

  function normalizeTrace(trace = {}) {
    const reasoningContent = String(trace.reasoningContent || trace.reasoning_content || trace.reasoning || '').trim()
    const reasoningDetails = Array.isArray(trace.reasoningDetails || trace.reasoning_details)
      ? trace.reasoningDetails || trace.reasoning_details
      : null
    if (!reasoningContent && !reasoningDetails?.length) return null
    return {
      reasoning_content: reasoningContent,
      reasoning: reasoningContent,
      ...(reasoningDetails?.length ? { reasoning_details: reasoningDetails } : {}),
    }
  }

  function record(profile, trace = {}) {
    const model = profile?.model || trace.model || ''
    const normalized = normalizeTrace(trace)
    const toolCallIds = Array.from(new Set((trace.toolCallIds || trace.tool_call_ids || []).filter(Boolean)))
    if (!model || !normalized || !toolCallIds.length) return false
    for (const toolCallId of toolCallIds) {
      entries.set(key(model, toolCallId), { ...normalized, model, toolCallId, createdAt: Date.now() })
    }
    compact()
    return true
  }

  function recordChoice(profile, choice) {
    const message = choice?.message || {}
    const toolCallIds = (message.tool_calls || []).map(tool => tool?.id).filter(Boolean)
    return record(profile, {
      model: profile?.model,
      toolCallIds,
      reasoningContent: message.reasoning_content || message.reasoning,
      reasoningDetails: message.reasoning_details,
    })
  }

  function find(profile, toolCallIds = []) {
    const model = profile?.model || ''
    for (const toolCallId of toolCallIds) {
      const found = entries.get(key(model, toolCallId))
      if (found) {
        return {
          reasoning_content: found.reasoning_content,
          reasoning: found.reasoning,
          ...(found.reasoning_details ? { reasoning_details: found.reasoning_details } : {}),
        }
      }
    }
    return null
  }

  return {
    find,
    record,
    recordChoice,
    size: () => entries.size,
  }
}

module.exports = { createProviderReasoningStore }
