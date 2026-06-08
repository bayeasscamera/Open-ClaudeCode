import type { SessionActivity } from './types.js'

export function shouldKeepCurrentSessionStatus(
  activity: SessionActivity | undefined,
): boolean {
  return !activity || activity.type === 'result' || activity.type === 'error'
}

export function buildSessionActivityTrail(
  activities: SessionActivity[],
  maxItems = 5,
): string[] {
  return activities
    .filter(activity => activity.type === 'tool_start')
    .slice(-maxItems)
    .map(activity => activity.summary)
}
