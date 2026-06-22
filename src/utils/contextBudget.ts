/**
 * Context budget estimation for the OPC loop.
 *
 * Spec phase 2: before each LLM call, the loop MUST know how many tokens
 * the proposed context occupies so it can decide whether to compact,
 * truncate, or escalate.
 *
 * The estimator is intentionally lightweight — no SDK dependency, no
 * tokenizer download. It uses the standard chars/4 heuristic (OpenAI
 * cookbook, Claude docs) which is accurate to ~10 % on natural text and
 * overestimates slightly on code, which is exactly what we want for
 * "do I have room?" checks (better to over-budget than to crash mid-call).
 *
 * Pluggable: callers can inject `charsPerToken` and `toolOverheadTokens`
 * for tighter models (Anthropic Sonnet tends to be ~3.5 chars/token).
 */

export interface ContextBudgetConfig {
  /** Hard cap on input context tokens. */
  maxTokens: number
  /**
   * When usage ratio crosses this fraction (0..1), the budget is considered
   * breached for compaction purposes. Default: 0.85.
   */
  triggerRatio?: number
  /** Tokens reserved for the model's response. Default: 4096. */
  reservedForOutput?: number
  /** Heuristic: average characters per token. Default: 4. */
  charsPerToken?: number
  /** Per-tool overhead (schema wrapping, name, description). Default: 60. */
  toolOverheadTokens?: number
}

export interface ContextMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  /** Plain-text content. For multi-block content, pass joined text. */
  content: string
  /** Optional tool name — when present, a small overhead is added. */
  name?: string
  /**
   * Optional JSON-serializable tool input/output — counted separately so
   * large payloads don't slip under the chars/4 heuristic (JSON has high
   * punctuation density).
   */
  toolPayload?: unknown
}

export interface ContextTool {
  name: string
  description: string
  /** JSON Schema for tool arguments. */
  inputSchema: Record<string, unknown>
}

export interface ContextBreakdown {
  systemTokens: number
  messagesTokens: number
  toolsTokens: number
  reservedForOutput: number
  total: number
}

export interface ContextBudgetEstimate {
  breakdown: ContextBreakdown
  /** True when usage >= maxTokens * triggerRatio. */
  needsCompaction: boolean
  /** 0..100 — how much of the budget is consumed (capped at 999). */
  usagePercent: number
  /** True when total > maxTokens (no headroom even for reserved output). */
  exceedsMax: boolean
}

export const DEFAULT_CHARS_PER_TOKEN = 4
export const DEFAULT_TOOL_OVERHEAD_TOKENS = 60
export const DEFAULT_RESERVED_OUTPUT_TOKENS = 4_096
export const DEFAULT_TRIGGER_RATIO = 0.85
/** Per-message wrapper overhead (role tag, separators). */
export const MESSAGE_OVERHEAD_TOKENS = 4
/** Per-tool-call payload overhead (id, type tag, JSON wrapping). */
export const TOOL_PAYLOAD_OVERHEAD_TOKENS = 8

const DEFAULT_CONFIG: Required<ContextBudgetConfig> = {
  maxTokens: 200_000,
  triggerRatio: DEFAULT_TRIGGER_RATIO,
  reservedForOutput: DEFAULT_RESERVED_OUTPUT_TOKENS,
  charsPerToken: DEFAULT_CHARS_PER_TOKEN,
  toolOverheadTokens: DEFAULT_TOOL_OVERHEAD_TOKENS,
}

function normalize(config: ContextBudgetConfig): Required<ContextBudgetConfig> {
  return {
    maxTokens: Math.max(1, config.maxTokens | 0),
    triggerRatio: clampRatio(config.triggerRatio ?? DEFAULT_CONFIG.triggerRatio),
    reservedForOutput: Math.max(
      0,
      config.reservedForOutput ?? DEFAULT_CONFIG.reservedForOutput,
    ),
    charsPerToken: Math.max(
      0.5,
      config.charsPerToken ?? DEFAULT_CONFIG.charsPerToken,
    ),
    toolOverheadTokens: Math.max(
      0,
      config.toolOverheadTokens ?? DEFAULT_CONFIG.toolOverheadTokens,
    ),
  }
}

function clampRatio(r: number): number {
  if (!Number.isFinite(r)) return DEFAULT_TRIGGER_RATIO
  return Math.min(1, Math.max(0, r))
}

/**
 * Estimate tokens from a raw string. Returns 0 for empty/nullish input.
 * Always rounds UP so the budget is conservative.
 */
export function estimateTokens(text: string | null | undefined, charsPerToken = DEFAULT_CHARS_PER_TOKEN): number {
  if (!text) return 0
  const len = text.length
  if (len === 0) return 0
  return Math.ceil(len / Math.max(0.5, charsPerToken))
}

/**
 * Estimate tokens for a JSON-serializable payload. JSON strings have
 * higher punctuation density than prose, so we apply a 1.15× inflation
 * factor on top of the chars/4 heuristic.
 */
export function estimatePayloadTokens(
  payload: unknown,
  charsPerToken = DEFAULT_CHARS_PER_TOKEN,
): number {
  if (payload === undefined) return 0
  let serialized: string
  try {
    serialized = JSON.stringify(payload)
  } catch {
    serialized = '[unserializable]'
  }
  if (!serialized) return 0
  const raw = Math.ceil(serialized.length / Math.max(0.5, charsPerToken))
  return Math.ceil(raw * 1.15) + TOOL_PAYLOAD_OVERHEAD_TOKENS
}

/**
 * Estimate tokens for a single message.
 */
export function estimateMessageTokens(
  msg: ContextMessage,
  charsPerToken = DEFAULT_CHARS_PER_TOKEN,
): number {
  const textTokens = estimateTokens(msg.content, charsPerToken)
  const payloadTokens =
    msg.toolPayload !== undefined
      ? estimatePayloadTokens(msg.toolPayload, charsPerToken)
      : 0
  const nameTokens = msg.name ? estimateTokens(msg.name, charsPerToken) + 2 : 0
  return textTokens + payloadTokens + nameTokens + MESSAGE_OVERHEAD_TOKENS
}

/**
 * Estimate tokens for a single tool declaration (system overhead + schema).
 */
export function estimateToolDefinitionTokens(
  tool: ContextTool,
  toolOverheadTokens = DEFAULT_TOOL_OVERHEAD_TOKENS,
  charsPerToken = DEFAULT_CHARS_PER_TOKEN,
): number {
  const desc = estimateTokens(tool.description, charsPerToken)
  const schema = estimatePayloadTokens(tool.inputSchema, charsPerToken)
  const name = estimateTokens(tool.name, charsPerToken) + 2
  return name + desc + schema + toolOverheadTokens
}

/**
 * Estimate tokens for the full context the loop intends to send to the
 * provider. Returns a stable breakdown so UIs can render "system vs
 * history vs tools" and the compactor can target the heaviest slice.
 */
export function estimateContext(args: {
  system?: string
  messages: ContextMessage[]
  tools: ContextTool[]
  config: ContextBudgetConfig
}): ContextBudgetEstimate {
  const cfg = normalize(args.config)

  const systemTokens = estimateTokens(args.system, cfg.charsPerToken)
  let messagesTokens = 0
  for (const msg of args.messages) {
    messagesTokens += estimateMessageTokens(msg, cfg.charsPerToken)
  }
  let toolsTokens = 0
  for (const tool of args.tools) {
    toolsTokens += estimateToolDefinitionTokens(
      tool,
      cfg.toolOverheadTokens,
      cfg.charsPerToken,
    )
  }
  const reservedForOutput = cfg.reservedForOutput
  const total = systemTokens + messagesTokens + toolsTokens + reservedForOutput

  const threshold = cfg.maxTokens * cfg.triggerRatio
  const needsCompaction = total >= threshold
  const exceedsMax = total > cfg.maxTokens
  const usagePercent = Math.min(
    999,
    Math.round((total / cfg.maxTokens) * 100),
  )

  return {
    breakdown: {
      systemTokens,
      messagesTokens,
      toolsTokens,
      reservedForOutput,
      total,
    },
    needsCompaction,
    usagePercent,
    exceedsMax,
  }
}

/**
 * Predicate form for the runner's hot path.
 */
export function shouldCompact(estimate: ContextBudgetEstimate): boolean {
  return estimate.needsCompaction
}
