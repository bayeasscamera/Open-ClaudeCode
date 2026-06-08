const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.join(__dirname, '..', '..')

function readSource(...segments) {
  return fs.readFileSync(path.join(root, ...segments), 'utf8')
}

test('bridge refactor gates keep CLI parsing, error classification, and title derivation extracted', () => {
  const bridgeMain = readSource('src', 'bridge', 'bridgeMain.ts')
  const bridgeArgs = readSource('src', 'bridge', 'bridgeArgs.ts')
  const bridgeErrors = readSource('src', 'bridge', 'bridgeErrors.ts')
  const bridgeFatalError = readSource('src', 'bridge', 'bridgeFatalError.ts')
  const bridgeHeartbeat = readSource('src', 'bridge', 'bridgeHeartbeat.ts')
  const bridgePollBackoff = readSource('src', 'bridge', 'bridgePollBackoff.ts')
  const sessionTitle = readSource('src', 'bridge', 'sessionTitle.ts')
  const bridgeRetry = readSource('src', 'bridge', 'bridgeRetry.ts')
  const bridgeSessionLifecycle = readSource('src', 'bridge', 'bridgeSessionLifecycle.ts')
  const bridgeSessionSpawn = readSource('src', 'bridge', 'bridgeSessionSpawn.ts')
  const bridgeSessionStatus = readSource('src', 'bridge', 'bridgeSessionStatus.ts')
  const bridgeSessionTitle = readSource('src', 'bridge', 'bridgeSessionTitle.ts')
  const bridgeStopWork = readSource('src', 'bridge', 'bridgeStopWork.ts')
  const tsconfig = JSON.parse(readSource('tsconfig.check.json'))

  assert.match(bridgeMain, /from '\.\/bridgeArgs\.js'/)
  assert.match(bridgeMain, /from '\.\/bridgeErrors\.js'/)
  assert.match(bridgeMain, /from '\.\/bridgeHeartbeat\.js'/)
  assert.match(bridgeMain, /from '\.\/bridgePollBackoff\.js'/)
  assert.match(bridgeMain, /from '\.\/bridgeRetry\.js'/)
  assert.match(bridgeMain, /from '\.\/bridgeSessionLifecycle\.js'/)
  assert.match(bridgeMain, /from '\.\/bridgeSessionSpawn\.js'/)
  assert.match(bridgeMain, /from '\.\/bridgeSessionStatus\.js'/)
  assert.match(bridgeMain, /from '\.\/bridgeSessionTitle\.js'/)
  assert.match(bridgeMain, /from '\.\/bridgeStopWork\.js'/)
  assert.match(bridgeSessionTitle, /from '\.\/sessionTitle\.js'/)

  assert.doesNotMatch(bridgeMain, /export function parseArgs\(/)
  assert.doesNotMatch(bridgeMain, /function parseSpawnValue\(/)
  assert.doesNotMatch(bridgeMain, /export function isConnectionError\(/)
  assert.doesNotMatch(bridgeMain, /function deriveSessionTitle\(/)
  assert.doesNotMatch(bridgeMain, /function createFirstUserMessageTitleHandler\(/)
  assert.doesNotMatch(bridgeMain, /function fetchAndApplySessionTitle\(/)
  assert.doesNotMatch(bridgeMain, /function stopWorkWithRetry\(/)

  assert.match(bridgeArgs, /export function parseArgs\(args: string\[\]\): ParsedArgs/)
  assert.match(bridgeArgs, /if \(raw === 'session'\) return 'single-session'/)
  assert.match(bridgeArgs, /--capacity requires a positive integer/)

  assert.match(bridgeErrors, /export function isConnectionError\(err: unknown\): boolean/)
  assert.match(bridgeErrors, /ERR_BAD_RESPONSE/)

  assert.match(bridgeFatalError, /export class BridgeFatalError extends Error/)
  assert.match(bridgeFatalError, /export function isSuppressible403/)

  assert.match(bridgeHeartbeat, /export type HeartbeatResult/)
  assert.match(bridgeHeartbeat, /export function isHeartbeatAuthFailureStatus/)
  assert.match(bridgeHeartbeat, /export function classifyHeartbeatFatalErrorStatus/)
  assert.match(bridgeHeartbeat, /export function resolveHeartbeatResult/)

  assert.match(
    bridgePollBackoff,
    /export function pollSleepDetectionThresholdMs/,
  )
  assert.match(bridgePollBackoff, /export function shouldResetPollErrorBudget/)
  assert.match(bridgePollBackoff, /export function nextBackoffMs/)

  assert.match(bridgeRetry, /export function addJitter\(ms: number\): number/)
  assert.match(bridgeRetry, /export function formatDelay\(ms: number\): string/)

  assert.match(bridgeSessionLifecycle, /export type SessionLifecycleAction/)
  assert.match(bridgeSessionLifecycle, /export function normalizeSessionDoneStatus/)
  assert.match(bridgeSessionLifecycle, /export function shouldLogSessionFailure/)
  assert.match(bridgeSessionLifecycle, /export function shouldStopWorkAfterSessionDone/)
  assert.match(bridgeSessionLifecycle, /export function sessionLifecycleAction/)

  assert.match(bridgeSessionSpawn, /export function shouldUseCcrV2Session/)
  assert.match(bridgeSessionSpawn, /export function shouldCreateSessionWorktree/)
  assert.match(bridgeSessionSpawn, /export function sessionWorktreeName/)
  assert.match(bridgeSessionSpawn, /export function sessionDebugFilePath/)

  assert.match(bridgeSessionStatus, /export function shouldKeepCurrentSessionStatus/)
  assert.match(bridgeSessionStatus, /export function buildSessionActivityTrail/)

  assert.match(bridgeSessionTitle, /export function createFirstUserMessageTitleHandler/)
  assert.match(bridgeSessionTitle, /export function fetchAndApplySessionTitle/)

  assert.match(bridgeStopWork, /export async function stopWorkWithRetry/)
  assert.match(bridgeStopWork, /api\.stopWork\(environmentId, workId, false\)/)
  assert.match(bridgeStopWork, /bridge_stop_work_failed/)

  assert.match(sessionTitle, /export function deriveSessionTitle\(text: string\): string/)
  assert.match(sessionTitle, /truncateToWidth\(flat, TITLE_MAX_LEN\)/)

  assert.equal(tsconfig.include.includes('src/bridge/bridgeArgs.ts'), true)
  assert.equal(tsconfig.include.includes('src/bridge/bridgeErrors.ts'), true)
  assert.equal(tsconfig.include.includes('src/bridge/bridgeFatalError.ts'), true)
  assert.equal(tsconfig.include.includes('src/bridge/bridgeHeartbeat.ts'), true)
  assert.equal(tsconfig.include.includes('src/bridge/bridgePollBackoff.ts'), true)
  assert.equal(tsconfig.include.includes('src/bridge/bridgeRetry.ts'), true)
  assert.equal(tsconfig.include.includes('src/bridge/bridgeSessionLifecycle.ts'), true)
  assert.equal(tsconfig.include.includes('src/bridge/bridgeSessionSpawn.ts'), true)
  assert.equal(tsconfig.include.includes('src/bridge/bridgeSessionStatus.ts'), true)
  assert.equal(tsconfig.include.includes('src/bridge/bridgeSessionTitle.ts'), true)
  assert.equal(tsconfig.include.includes('src/bridge/bridgeStopWork.ts'), true)
  assert.equal(tsconfig.include.includes('src/bridge/sessionTitle.ts'), true)
})
