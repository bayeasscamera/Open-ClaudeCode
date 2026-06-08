import { BridgeFatalError, isSuppressible403 } from './bridgeFatalError.js'
import { addJitter, formatDelay } from './bridgeRetry.js'
import type { BridgeApiClient, BridgeLogger } from './types.js'

export type StopWorkRetryDeps = {
  logForDebugging: (message: string) => void
  logForDiagnosticsNoPII: (
    level: 'debug' | 'info' | 'warn' | 'error',
    event: string,
    data?: Record<string, unknown>,
  ) => void
  errorMessage: (err: unknown) => string
  sleep: (ms: number) => Promise<void>
}

/**
 * Retry stopWork with exponential backoff (3 attempts, 1s/2s/4s).
 * Ensures the server learns the work item ended, preventing server-side zombies.
 */
export async function stopWorkWithRetry(
  api: BridgeApiClient,
  environmentId: string,
  workId: string,
  logger: BridgeLogger,
  baseDelayMs = 1000,
  deps: StopWorkRetryDeps,
): Promise<void> {
  const MAX_ATTEMPTS = 3

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await api.stopWork(environmentId, workId, false)
      deps.logForDebugging(
        `[bridge:work] stopWork succeeded for workId=${workId} on attempt ${attempt}/${MAX_ATTEMPTS}`,
      )
      return
    } catch (err) {
      // Auth/permission errors won't be fixed by retrying
      if (err instanceof BridgeFatalError) {
        if (isSuppressible403(err)) {
          deps.logForDebugging(
            `[bridge:work] Suppressed stopWork 403 for ${workId}: ${err.message}`,
          )
        } else {
          logger.logError(`Failed to stop work ${workId}: ${err.message}`)
        }
        deps.logForDiagnosticsNoPII('error', 'bridge_stop_work_failed', {
          attempts: attempt,
          fatal: true,
        })
        return
      }
      const errMsg = deps.errorMessage(err)
      if (attempt < MAX_ATTEMPTS) {
        const delay = addJitter(baseDelayMs * Math.pow(2, attempt - 1))
        logger.logVerbose(
          `Failed to stop work ${workId} (attempt ${attempt}/${MAX_ATTEMPTS}), retrying in ${formatDelay(delay)}: ${errMsg}`,
        )
        await deps.sleep(delay)
      } else {
        logger.logError(
          `Failed to stop work ${workId} after ${MAX_ATTEMPTS} attempts: ${errMsg}`,
        )
        deps.logForDiagnosticsNoPII('error', 'bridge_stop_work_failed', {
          attempts: MAX_ATTEMPTS,
        })
      }
    }
  }
}
