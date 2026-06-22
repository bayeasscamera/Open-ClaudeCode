/**
 * Smoke test for the OPC loop wired with a deterministic mock provider.
 *
 * Verifies:
 *   - successful path (act → verify-ok → done)
 *   - retry path (transient failure → reasoner retry → act-ok → done)
 *   - escalate path (deterministic failure → reasoner escalate → exit)
 *   - human gate path (ask-human → approved → continue)
 *   - budget breach path (tracker triggers → escalated)
 *   - max iterations path
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runLoop } from '../loopRunner.js'
import { saveTasks, type TaskItem } from '../taskChecklist.js'
import { createScriptedHumanGate } from '../humanInTheLoop.js'
import { LoopEventEmitter } from '../loopEvents.js'
import {
  scriptedReasoner,
  okAct,
  failAct,
  flakyAct,
  makeAskOnceReasoner,
  alwaysEscalateReasoner,
  okVerify,
} from './mockProvider.js'

import { mkdtempSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// The test exercises the real taskChecklist.ts via the file-backed
// saveTasks/getTasks pair. Use an isolated tmp dir so the suite can run
// in parallel without conflicting with a real project tree.
const tmpDir = mkdtempSync(join(tmpdir(), 'opc-loop-smoke-'))
// We rely on saveTasks() to write to whatever path getProjectRoot()
// resolves to — see taskChecklist.ts. The test does not need to know the
// absolute path; it just needs a fresh per-run directory.

function setTasks(items: TaskItem[]) {
  saveTasks(items)
}

test('smoke: success path emits loop_started and loop_finished', async () => {
  setTasks([{ text: 'noop', status: 'todo' }])
  const emitter = new LoopEventEmitter()
  const seen: string[] = []
  emitter.on(e => seen.push(e.type))
  const outcome = await runLoop({
    act: okAct,
    verify: okVerify,
    reason: scriptedReasoner(['continue']),
    emitter,
    config: { maxIterations: 5, maxRetriesPerTask: 3, verifyAfterEachTask: true },
  })
  assert.equal(outcome.status, 'success')
  assert.ok(seen.includes('loop_started'))
  assert.ok(seen.includes('loop_finished'))
})

test('smoke: transient retry path with flaky act', async () => {
  setTasks([{ text: 'flaky', status: 'todo' }])
  const outcome = await runLoop({
    act: flakyAct(2, 'ETIMEDOUT'),
    verify: okVerify,
    reason: scriptedReasoner(['retry', 'retry', 'continue']),
    config: { maxIterations: 10, maxRetriesPerTask: 5, verifyAfterEachTask: true },
  })
  assert.equal(outcome.status, 'success')
})

test('smoke: deterministic failure escalates', async () => {
  setTasks([{ text: 'bad', status: 'todo' }])
  const outcome = await runLoop({
    act: failAct('TypeError: bad input'),
    verify: okVerify,
    reason: scriptedReasoner(['escalate']),
    config: { maxIterations: 5, maxRetriesPerTask: 5, verifyAfterEachTask: true },
  })
  assert.equal(outcome.status, 'escalated')
  if (outcome.status === 'escalated') {
    assert.match(outcome.reason, /Reasoner on act-fail|TypeError/)
  }
})

test('smoke: ask-human gate approves and continues', async () => {
  setTasks([{ text: 'gate', status: 'todo' }])
  const gate = createScriptedHumanGate({ answers: ['approved'], defaultDecision: 'timeout' })
  const outcome = await runLoop({
    act: okAct,
    verify: okVerify,
    reason: makeAskOnceReasoner(),
    humanGate: gate,
    config: { maxIterations: 5, maxRetriesPerTask: 3, verifyAfterEachTask: true },
  })
  assert.equal(outcome.status, 'success')
})

test('smoke: ask-human gate rejection escalates', async () => {
  setTasks([{ text: 'gate', status: 'todo' }])
  const gate = createScriptedHumanGate({ answers: ['rejected'] })
  const outcome = await runLoop({
    act: okAct,
    verify: okVerify,
    reason: makeAskOnceReasoner(),
    humanGate: gate,
    config: { maxIterations: 5, maxRetriesPerTask: 3, verifyAfterEachTask: true },
  })
  assert.equal(outcome.status, 'escalated')
})

test('smoke: max iterations escalates', async () => {
  setTasks([
    { text: 'a', status: 'todo' },
    { text: 'b', status: 'todo' },
  ])
  const outcome = await runLoop({
    act: failAct('still bad'),
    verify: okVerify,
    reason: scriptedReasoner(['retry', 'retry', 'retry', 'retry', 'retry']),
    config: { maxIterations: 2, maxRetriesPerTask: 10, verifyAfterEachTask: true },
  })
  assert.equal(outcome.status, 'escalated')
  if (outcome.status === 'escalated') {
    assert.match(outcome.reason, /max iterations/i)
  }
})

test('smoke: empty checklist returns no-tasks', async () => {
  setTasks([])
  const outcome = await runLoop({
    act: okAct,
    verify: okVerify,
    reason: scriptedReasoner(['continue']),
    config: { maxIterations: 5, maxRetriesPerTask: 3, verifyAfterEachTask: true },
  })
  assert.equal(outcome.status, 'no-tasks')
})

test('smoke: always-escalate reasoner exits on first call', async () => {
  setTasks([{ text: 'x', status: 'todo' }])
  const outcome = await runLoop({
    act: okAct,
    verify: okVerify,
    reason: alwaysEscalateReasoner,
    config: { maxIterations: 5, maxRetriesPerTask: 3, verifyAfterEachTask: true },
  })
  assert.equal(outcome.status, 'escalated')
})

test('smoke: P2 sterile detection escalates when the same act repeats past maxSterileRepeats', async () => {
  // Verifies that actionKey + recordAction are wired into runLoop: a task
  // whose act keeps failing must trigger the `sterile` budget breach
  // instead of looping until maxRetriesPerTask is exhausted.
  setTasks([{ text: 'doomed', status: 'todo' }])
  const outcome = await runLoop({
    act: failAct('still bad'),
    verify: okVerify,
    reason: scriptedReasoner(Array(20).fill('retry')),
    config: { maxIterations: 50, maxRetriesPerTask: 50, verifyAfterEachTask: true },
    budget: { maxSterileRepeats: 2 },
  })
  assert.equal(outcome.status, 'escalated')
  if (outcome.status === 'escalated') {
    assert.match(outcome.reason, /sterile/i)
  }
})

test('cleanup: tmp dir', () => {
  if (existsSync(tmpDir)) {
    rmSync(tmpDir, { recursive: true, force: true })
  }
})
