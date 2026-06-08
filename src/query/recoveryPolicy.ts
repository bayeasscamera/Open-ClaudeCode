export const MAX_OUTPUT_TOKENS_RECOVERY_LIMIT = 3

type AssistantMessageLike = {
  type: 'assistant'
  apiError?: string
}

type RecoverableMessageLike = {
  type?: string
  apiError?: string
}

/**
 * Keep transient max_output_tokens recovery errors inside the query loop until
 * the recovery policy decides whether the turn can continue.
 */
export function isWithheldMaxOutputTokens(
  msg: RecoverableMessageLike | undefined,
): msg is AssistantMessageLike {
  return msg?.type === 'assistant' && msg.apiError === 'max_output_tokens'
}
