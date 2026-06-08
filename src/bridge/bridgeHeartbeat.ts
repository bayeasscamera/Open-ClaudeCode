export type HeartbeatResult = 'ok' | 'auth_failed' | 'fatal' | 'failed'
export type HeartbeatErrorType = 'auth_failed' | 'fatal'

export function isHeartbeatAuthFailureStatus(status: number): boolean {
  return status === 401 || status === 403
}

export function classifyHeartbeatFatalErrorStatus(
  status: number,
): HeartbeatErrorType {
  return isHeartbeatAuthFailureStatus(status) ? 'auth_failed' : 'fatal'
}

export function resolveHeartbeatResult(input: {
  anySuccess: boolean
  anyFatal: boolean
  authFailedCount: number
}): HeartbeatResult {
  if (input.anyFatal) {
    return 'fatal'
  }
  if (input.authFailedCount > 0) {
    return 'auth_failed'
  }
  return input.anySuccess ? 'ok' : 'failed'
}
