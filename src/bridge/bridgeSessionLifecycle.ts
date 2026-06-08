import type { SessionDoneStatus, SpawnMode } from './types.js'

export type SessionLifecycleAction = 'none' | 'archive' | 'abort'

export function normalizeSessionDoneStatus(
  rawStatus: SessionDoneStatus,
  wasTimedOut: boolean,
): SessionDoneStatus {
  return wasTimedOut && rawStatus === 'interrupted' ? 'failed' : rawStatus
}

export function shouldLogSessionFailure(input: {
  status: SessionDoneStatus
  wasTimedOut: boolean
  loopAborted: boolean
}): boolean {
  return input.status === 'failed' && !input.wasTimedOut && !input.loopAborted
}

export function shouldStopWorkAfterSessionDone(input: {
  status: SessionDoneStatus
  hasWorkId: boolean
}): boolean {
  return input.status !== 'interrupted' && input.hasWorkId
}

export function sessionLifecycleAction(input: {
  status: SessionDoneStatus
  loopAborted: boolean
  spawnMode: SpawnMode
}): SessionLifecycleAction {
  if (input.status === 'interrupted' || input.loopAborted) {
    return 'none'
  }
  return input.spawnMode === 'single-session' ? 'abort' : 'archive'
}
