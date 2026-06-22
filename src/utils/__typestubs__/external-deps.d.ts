// Stubs ambient pour les modules tirés transitivement par src/bootstrap/state.ts
// lorsque l'on type-check uniquement les utils nouveaux (tsconfig.utils.json).
//
// Portée : utilisé seulement par tsconfig.utils.json (pas par le bundle ni le runtime).
// On déclare les exports nommés requis en `any` pour satisfaire TS2307/TS2305/TS2709
// sans installer les vraies typings d'OpenTelemetry/Anthropic SDK/etc.

// --- Anthropic SDK ---
declare module '@anthropic-ai/sdk/resources/beta/messages/messages.mjs' {
  export type BetaMessageStreamParams = any
}
declare module '@anthropic-ai/sdk' {
  const sdk: any
  export = sdk
}
declare module '@anthropic-ai/sdk/*' {
  const x: any
  export = x
}

// --- OpenTelemetry ---
declare module '@opentelemetry/api' {
  export type Attributes = any
  export type Meter = any
  export type MetricOptions = any
}
declare module '@opentelemetry/api-logs' {
  export type LoggerProvider = any
  export const logs: any
}
declare module '@opentelemetry/sdk-logs' {
  export type LoggerProvider = any
}
declare module '@opentelemetry/sdk-metrics' {
  export type MeterProvider = any
}
declare module '@opentelemetry/sdk-trace-base' {
  export type BasicTracerProvider = any
}
declare module '@opentelemetry/*' {
  const x: any
  export = x
}

// --- lodash-es ---
declare module 'lodash-es/sumBy.js' {
  const sumBy: <T = any>(arr: readonly T[], iter: any) => number
  export default sumBy
}
declare module 'lodash-es/*' {
  const x: any
  export default x
}

// --- src/* (modules internes que l'on ne veut PAS type-checker dans ce passage) ---
declare module 'src/entrypoints/agentSdkTypes.js' {
  export type HookEvent = any
  export type ModelUsage = any
  const x: any
  export default x
}
declare module 'src/tools/AgentTool/agentColorManager.js' {
  export type AgentColorName = any
  const x: any
  export default x
}
declare module 'src/types/hooks.js' {
  export type HookCallbackMatcher = any
  export type PluginHookMatcher = any
  export type HookEvent = any
}
declare module 'src/types/ids.js' {
  export type SessionId = string
}
declare module 'src/utils/crypto.js' {
  export function randomUUID(): string
  const x: any
  export default x
}
declare module 'src/utils/model/model.js' {
  export type ModelSetting = any
  export type ModelUsage = any
}
declare module 'src/utils/model/modelStrings.js' {
  export type ModelStrings = any
}
declare module 'src/utils/settings/constants.js' {
  export type SettingSource = any
  const x: any
  export default x
}
declare module 'src/utils/settings/settingsCache.js' {
  export function resetSettingsCache(): void
  const x: any
  export default x
}
declare module 'src/utils/settings/types.js' {
  export type SettingSource = any
  export type PluginHookMatcher = any
}
declare module 'src/utils/signal.js' {
  export function createSignal<T = any>(initial?: T): any
  const x: any
  export default x
}
declare module 'src/*' {
  const x: any
  export = x
}
