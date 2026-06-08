import { join } from 'path'
import type { BridgeConfig, SpawnMode, WorkSecret } from './types.js'

function safeSessionFileId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_')
}

function sessionIdUuidPart(id: string): string {
  const parts = id.split('_')
  return parts.length > 1 ? parts.slice(1).join('_') : id
}

function isSameSessionId(left: string, right: string): boolean {
  return sessionIdUuidPart(left) === sessionIdUuidPart(right)
}

export function shouldUseCcrV2Session(
  secret: Pick<WorkSecret, 'use_code_sessions'>,
  forceCcrV2: boolean,
): boolean {
  return secret.use_code_sessions === true || forceCcrV2
}

export function shouldCreateSessionWorktree(input: {
  spawnMode: SpawnMode
  sessionId: string
  initialSessionId?: string
}): boolean {
  return (
    input.spawnMode === 'worktree' &&
    (input.initialSessionId === undefined ||
      !isSameSessionId(input.sessionId, input.initialSessionId))
  )
}

export function sessionWorktreeName(sessionId: string): string {
  return `bridge-${safeSessionFileId(sessionId)}`
}

export function sessionDebugFilePath(input: {
  sessionId: string
  debugFile?: string
  verbose: boolean
  userType?: string
  tmpDir: string
}): string | undefined {
  const safeId = safeSessionFileId(input.sessionId)
  if (input.debugFile) {
    const ext = input.debugFile.lastIndexOf('.')
    return ext > 0
      ? `${input.debugFile.slice(0, ext)}-${safeId}${input.debugFile.slice(ext)}`
      : `${input.debugFile}-${safeId}`
  }
  if (input.verbose || input.userType === 'ant') {
    return join(input.tmpDir, 'claude', `bridge-session-${safeId}.log`)
  }
  return undefined
}

export function captureSpawnModeForSession(config: BridgeConfig): SpawnMode {
  return config.spawnMode
}
