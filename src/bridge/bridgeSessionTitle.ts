import { deriveSessionTitle } from './sessionTitle.js'

type SessionTitleLogger = {
  setSessionTitle(sessionId: string, title: string): void
}

type DebugLogger = (
  message: string,
  options?: { level?: 'error' | 'warn' | 'info' | 'debug' },
) => void

export type UpdateBridgeSessionTitle = (
  compatSessionId: string,
  title: string,
  options: { baseUrl: string },
) => Promise<unknown>

export type FetchBridgeSessionTitle = (
  compatSessionId: string,
  baseUrl: string,
) => Promise<string | undefined>

export function createFirstUserMessageTitleHandler(input: {
  compatSessionId: string
  titledSessions: Set<string>
  logger: SessionTitleLogger
  baseUrl: string
  updateBridgeSessionTitle: UpdateBridgeSessionTitle
  logForDebugging: DebugLogger
}): (text: string) => void {
  return (text: string): void => {
    // Server-set titles (--name, web rename) win. If a server title already
    // populated titledSessions, skip the first-message fallback.
    if (input.titledSessions.has(input.compatSessionId)) return
    input.titledSessions.add(input.compatSessionId)
    const title = deriveSessionTitle(text)
    input.logger.setSessionTitle(input.compatSessionId, title)
    input.logForDebugging(
      `[bridge:title] derived title for ${input.compatSessionId}: ${title}`,
    )
    void input
      .updateBridgeSessionTitle(input.compatSessionId, title, {
        baseUrl: input.baseUrl,
      })
      .catch(err =>
        input.logForDebugging(
          `[bridge:title] failed to update title for ${input.compatSessionId}: ${err}`,
          { level: 'error' },
        ),
      )
  }
}

export function fetchAndApplySessionTitle(input: {
  sessionId: string
  compatSessionId: string
  activeSessions: Map<string, unknown>
  titledSessions: Set<string>
  logger: SessionTitleLogger
  baseUrl: string
  fetchSessionTitle: FetchBridgeSessionTitle
  logForDebugging: DebugLogger
}): void {
  void input
    .fetchSessionTitle(input.compatSessionId, input.baseUrl)
    .then(title => {
      if (title && input.activeSessions.has(input.sessionId)) {
        input.titledSessions.add(input.compatSessionId)
        input.logger.setSessionTitle(input.compatSessionId, title)
        input.logForDebugging(
          `[bridge:title] server title for ${input.compatSessionId}: ${title}`,
        )
      }
    })
    .catch(err =>
      input.logForDebugging(
        `[bridge:title] failed to fetch title for ${input.compatSessionId}: ${err}`,
        { level: 'error' },
      ),
    )
}
