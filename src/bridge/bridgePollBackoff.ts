export type PollSleepDetectionConfig = {
  connCapMs: number
}

/**
 * Returns the threshold for detecting system sleep/wake in the poll loop.
 * Must exceed the max backoff cap — otherwise normal backoff delays trigger
 * false sleep detection (resetting the error budget indefinitely).
 */
export function pollSleepDetectionThresholdMs(
  backoff: PollSleepDetectionConfig,
): number {
  return backoff.connCapMs * 2
}

export function shouldResetPollErrorBudget(
  lastPollErrorTime: number | null,
  now: number,
  sleepDetectionThresholdMs: number,
): boolean {
  return (
    lastPollErrorTime !== null &&
    now - lastPollErrorTime > sleepDetectionThresholdMs
  )
}

export function nextBackoffMs(
  currentMs: number,
  initialMs: number,
  capMs: number,
): number {
  return currentMs ? Math.min(currentMs * 2, capMs) : initialMs
}
