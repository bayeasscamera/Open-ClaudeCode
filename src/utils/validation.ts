import { z } from 'zod/v4'
import {
  HARD_MAX_MESSAGES,
  MAX_ARRAY_LENGTH,
  MAX_FILE_READ_BYTES,
  MAX_STRING_LENGTH,
} from './sanitization.js'

// ---------------------------------------------------------------------------
// Shared Zod schemas for runtime validation
// ---------------------------------------------------------------------------

export const IPCMessageSchema = z.object({
  channel: z.string().min(1).max(256),
  payload: z.record(z.unknown()).optional(),
})

export type IPCMessage = z.infer<typeof IPCMessageSchema>

export const ConfigSchema = z.object({
  theme: z.enum(['dark', 'light']).optional(),
  verbose: z.boolean().optional(),
  editorMode: z.enum(['normal', 'emacs', 'vim']).optional().default('normal'),
  autoCompactEnabled: z.boolean().optional(),
  showTurnDuration: z.boolean().optional(),
  todoFeatureEnabled: z.boolean().optional(),
  showExpandedTodos: z.boolean().optional(),
  messageIdleNotifThresholdMs: z.number().int().min(0).optional(),
  fileCheckpointingEnabled: z.boolean().optional(),
  terminalProgressBarEnabled: z.boolean().optional(),
  showStatusInTerminalTab: z.boolean().optional(),
  taskCompleteNotifEnabled: z.boolean().optional(),
  inputNeededNotifEnabled: z.boolean().optional(),
  agentPushNotifEnabled: z.boolean().optional(),
  respectGitignore: z.boolean().optional(),
  copyFullResponse: z.boolean().optional(),
  permissionExplainerEnabled: z.boolean().optional(),
  prStatusFooterEnabled: z.boolean().optional(),
  remoteControlAtStartup: z.boolean().optional(),
  remoteDialogSeen: z.boolean().optional(),
  lspRecommendationDisabled: z.boolean().optional(),
  lspRecommendationNeverPlugins: z.array(z.string()).optional(),
  lspRecommendationIgnoredCount: z.number().int().min(0).optional(),
  hasCompletedClaudeInChromeOnboarding: z.boolean().optional(),
  claudeInChromeDefaultEnabled: z.boolean().optional(),
})

export type Config = z.infer<typeof ConfigSchema>

export const UserInputSchema = z.object({
  input: z.string().max(MAX_STRING_LENGTH),
  isMeta: z.boolean().optional(),
  uuid: z.string().uuid().optional(),
})

export type UserInput = z.infer<typeof UserInputSchema>

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

/**
 * Safe parse a value against a Zod schema, returning the parsed data on success
 * or the provided fallback on failure.
 */
export function safeParseWithFallback<T>(
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  data: unknown,
  fallback: T,
): T {
  const result = schema.safeParse(data)
  if (result.success) {
    return result.data
  }
  return fallback
}

/**
 * Validate an object against a schema, logging errors but never throwing.
 * Returns the parsed value or fallback.
 */
export function validateOrFallback<T>(
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  data: unknown,
  fallback: T,
  label?: string,
): T {
  const result = schema.safeParse(data)
  if (result.success) {
    return result.data
  }
  if (label && typeof console !== 'undefined') {
    console.warn(`[validation] ${label} failed:`, result.error.issues.map(i => i.message).join('; '))
  }
  return fallback
}

// Re-export sanitization constants for convenience
export { HARD_MAX_MESSAGES, MAX_ARRAY_LENGTH, MAX_FILE_READ_BYTES, MAX_STRING_LENGTH }
