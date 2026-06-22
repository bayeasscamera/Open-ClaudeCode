import { appendMemory } from './memory.js'
import {
  getTasks,
  saveTasks,
  type TaskItem,
  type TaskStatus,
} from './taskChecklist.js'
import {
  formatReport,
  verifyProject,
  type VerificationReport,
} from './verification.js'
import {
  createReasoner,
  defaultReason,
  type Reason,
  type ReasonContext,
  type ReasonDecision,
} from './loopReasoner.js'
import {
  noHumanGate,
  type HumanDecision,
  type HumanGate,
} from './humanInTheLoop.js'
import { actionKey, BudgetTracker, type LoopBudget } from './loopBudget.js'
import { evaluateStop } from './loopStop.js'
import { LoopEventEmitter } from './loopEvents.js'

/**
 * Loop runner for the OPC loop.
 *
 * Reads a checklist (taskChecklist.ts), executes each task via a user-provided
 * `act` callback, verifies with a user-provided or default `verify` callback,
 * and decides whether to continue, retry, or escalate based on observable
 * outcomes. All transitions are persisted to the task list and to memory.
 */

export interface LoopConfig {
  /** Hard cap on iterations across the whole loop. */
  maxIterations?: number
  /** Cap on retries for any single task (act failure OR verify failure). */
  maxRetriesPerTask?: number
  /** Whether to run the verify step after each successful act. */
  verifyAfterEachTask?: boolean
}

export const DEFAULT_LOOP_CONFIG: Required<LoopConfig> = {
  maxIterations: 50,
  maxRetriesPerTask: 3,
  verifyAfterEachTask: true,
}

export interface ActResult {
  ok: boolean
  reason?: string
}

export type Act = (task: TaskItem) => Promise<ActResult>

export type Verify = (
  task: TaskItem,
  prevReport: VerificationReport | undefined,
) => Promise<VerificationReport>

export type LoopStepAction =
  | 'start'
  | 'act-ok'
  | 'act-fail'
  | 'verify-ok'
  | 'verify-fail'
  | 'reason'
  | 'ask-human'
  | 'human-approved'
  | 'human-rejected'
  | 'human-timeout'
  | 'retry'
  | 'escalate'
  | 'done'

export interface LoopStep {
  iteration: number
  taskIndex: number
  taskText: string
  action: LoopStepAction
  /** 1-based attempt count for this task within the current loop run. */
  attempt: number
  result?: VerificationReport
  message?: string
  durationMs: number
}

export interface LoopReport {
  steps: LoopStep[]
  totalIterations: number
  /** Snapshot of task statuses when the loop ended. */
  finalStatus: TaskStatus[]
  startedAt: string
  finishedAt: string
}

export type LoopOutcome =
  | { status: 'success'; iterations: number; report: LoopReport }
  | {
      status: 'escalated'
      reason: string
      iterations: number
      report: LoopReport
    }
  | { status: 'no-tasks'; iterations: number; report: LoopReport }

export interface RunLoopOptions {
  config?: LoopConfig
  act: Act
  verify?: Verify
  /** ReAct-style reasoner. Defaults to the heuristic in loopReasoner.ts. */
  reason?: Reason
  /** Human-in-the-loop gate used when `reason` returns `ask-human`. */
  humanGate?: HumanGate
  /** Streaming hook for observability / UIs. */
  onStep?: (step: LoopStep) => void
  signal?: AbortSignal
  /**
   * Optional budget. When provided, the runner tracks tokens / cost /
   * wall time / sterile repeats via `BudgetTracker` and escalates on
   * breach. Strictly additive — omitting it preserves the legacy behavior.
   */
  budget?: LoopBudget
  /**
   * Optional event sink for the spec-level `LoopEvent` vocabulary. The
   * runner emits `loop_started`, `budget_breached`, and `loop_finished`
   * events alongside the existing `onStep` stream.
   */
  emitter?: LoopEventEmitter
}

const FAILURE_ACTIONS: ReadonlySet<LoopStepAction> = new Set<LoopStepAction>([
  'act-fail',
  'verify-fail',
])

async function defaultVerify(
  _task: TaskItem,
  _prevReport: VerificationReport | undefined,
): Promise<VerificationReport> {
  return verifyProject()
}

function buildReport(
  steps: LoopStep[],
  tasks: TaskItem[],
  startedAt: string,
  iterations: number,
): LoopReport {
  return {
    steps,
    totalIterations: iterations,
    finalStatus: tasks.map(t => t.status),
    startedAt,
    finishedAt: new Date().toISOString(),
  }
}

function attemptsForTask(steps: LoopStep[], taskIndex: number): number {
  return steps.filter(
    s => s.taskIndex === taskIndex && FAILURE_ACTIONS.has(s.action),
  ).length
}

function updateTask(
  tasks: TaskItem[],
  index: number,
  next: TaskStatus,
): void {
  const current = tasks[index]
  if (!current || current.status === next) return
  tasks[index] = { ...current, status: next }
  saveTasks(tasks)
}

function findNextTaskIndex(tasks: TaskItem[]): number {
  // Prefer in-progress (resume), then first todo.
  const inProgress = tasks.findIndex(t => t.status === 'in_progress')
  if (inProgress !== -1) return inProgress
  return tasks.findIndex(t => t.status === 'todo')
}

/**
 * Action returned by `dispatchReason`. The caller branches on this to
 * decide what the loop should do next.
 */
type DispatchAction =
  | { kind: 'continue' }
  | { kind: 'retry' }
  | { kind: 'escalate'; reason: string }
  | { kind: 'refine'; refinedTaskText: string }
  | { kind: 'noop' }

interface DispatchReasonArgs {
  task: TaskItem
  taskIndex: number
  attempt: number
  actResult: ActResult
  verifyReport: VerificationReport | undefined
  steps: LoopStep[]
  iteration: number
  reason: Reason
  humanGate: HumanGate
  onStep: (step: LoopStep) => void
}

/**
 * Run the reasoner (and optionally the human gate) after an act/verify
 * outcome. Emits `reason` / `ask-human` / `human-*` steps and returns the
 * next action. Never throws — failures degrade to `noop` so the loop keeps
 * falling back to its built-in retry/escalate logic.
 */
async function dispatchReason(args: DispatchReasonArgs): Promise<DispatchAction> {
  const ctx: ReasonContext = {
    task: args.task,
    attempt: args.attempt,
    actResult: args.actResult,
    verifyReport: args.verifyReport,
    recentSteps: args.steps.slice(-6).map(s => ({
      action: s.action,
      attempt: s.attempt,
      message: s.message,
    })),
  }

  let decision: ReasonDecision
  try {
    decision = await args.reason(ctx)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    appendMemory('Loop reasoner', `Reasoner threw — falling back to noop: ${message}`)
    return { kind: 'noop' }
  }

  args.steps.push({
    iteration: args.iteration,
    taskIndex: args.taskIndex,
    taskText: args.task.text,
    action: 'reason',
    attempt: args.attempt,
    message: `${decision.kind} (conf=${decision.confidence.toFixed(2)}) — ${decision.rationale}`,
    durationMs: 0,
  })
  args.onStep(args.steps[args.steps.length - 1]!)

  if (decision.kind !== 'ask-human') {
    switch (decision.kind) {
      case 'escalate':
        return { kind: 'escalate', reason: decision.rationale }
      case 'retry':
        return { kind: 'retry' }
      case 'refine':
        // refine without refined text falls back to noop (caller keeps its
        // existing retry/escalate logic, avoiding an undefined-text bug).
        return decision.refinedTaskText
          ? { kind: 'refine', refinedTaskText: decision.refinedTaskText }
          : { kind: 'noop' }
      case 'continue':
        return { kind: 'continue' }
    }
  }

  // ask-human path
  args.steps.push({
    iteration: args.iteration,
    taskIndex: args.taskIndex,
    taskText: args.task.text,
    action: 'ask-human',
    attempt: args.attempt,
    message: decision.rationale,
    durationMs: 0,
  })
  args.onStep(args.steps[args.steps.length - 1]!)

  let humanDecision: HumanDecision
  try {
    humanDecision = await args.humanGate.ask({
      id: `i${args.iteration}-t${args.taskIndex}-a${args.attempt}`,
      question: decision.rationale,
      context: args.task.text,
      timeoutMs: 60_000,
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    appendMemory('Human gate', `Gate threw — treating as timeout: ${message}`)
    humanDecision = 'timeout'
  }

  const actionFor: Record<HumanDecision, LoopStepAction> = {
    approved: 'human-approved',
    rejected: 'human-rejected',
    timeout: 'human-timeout',
  }
  args.steps.push({
    iteration: args.iteration,
    taskIndex: args.taskIndex,
    taskText: args.task.text,
    action: actionFor[humanDecision],
    attempt: args.attempt,
    message: `human=${humanDecision}`,
    durationMs: 0,
  })
  args.onStep(args.steps[args.steps.length - 1]!)

  switch (humanDecision) {
    case 'approved':
      return { kind: 'continue' }
    case 'rejected':
      return { kind: 'escalate', reason: `Human rejected: ${decision.rationale}` }
    case 'timeout':
      return { kind: 'retry' }
  }
}

export async function runLoop(opts: RunLoopOptions): Promise<LoopOutcome> {
  const config = { ...DEFAULT_LOOP_CONFIG, ...(opts.config ?? {}) }
  const verify = opts.verify ?? defaultVerify
  const onStep = opts.onStep ?? (() => {})
  const startedAt = new Date().toISOString()
  const steps: LoopStep[] = []
  let iteration = 0

  const reason = opts.reason ?? defaultReason
  const humanGate = opts.humanGate ?? noHumanGate

  // Budget + emitter are strictly additive: omitting them preserves the
  // legacy behavior. When provided, the budget tracker records iterations
  // and surfaces any breach as an `escalated` outcome with a precise reason.
  const tracker = opts.budget ? new BudgetTracker(opts.budget) : undefined
  tracker?.start()
  opts.emitter?.emit({
    type: 'loop_started',
    config: { maxIterations: config.maxIterations },
  })

  while (iteration < config.maxIterations) {
    // Central stop-condition evaluation (Phase 1.2 of the spec).
    // Order: abort > budget > legacy abort > legacy no-work > continue.
    const stop = evaluateStop({ budget: tracker, signal: opts.signal })
    if (stop.kind === 'abort') {
      opts.emitter?.emit({
        type: 'loop_finished',
        stop: { kind: 'abort', reason: stop.reason },
        iterations: iteration,
      })
      return {
        status: 'escalated',
        reason: stop.reason,
        iterations: iteration,
        report: buildReport(steps, getTasks(), startedAt, iteration),
      }
    }
    if (stop.kind === 'budget') {
      opts.emitter?.emit({ type: 'budget_breached', breach: stop.breach })
      appendMemory(
        'Loop budget breach',
        `${stop.breach.kind}: ${stop.breach.reason}`,
      )
      opts.emitter?.emit({
        type: 'loop_finished',
        stop: { kind: 'budget', breach: stop.breach },
        iterations: iteration,
      })
      return {
        status: 'escalated',
        reason: `Budget breach (${stop.breach.kind}): ${stop.breach.reason}`,
        iterations: iteration,
        report: buildReport(steps, getTasks(), startedAt, iteration),
      }
    }

    if (opts.signal?.aborted) {
      opts.emitter?.emit({
        type: 'loop_finished',
        stop: { kind: 'abort', reason: 'Aborted by signal' },
        iterations: iteration,
      })
      return {
        status: 'escalated',
        reason: 'Aborted by signal',
        iterations: iteration,
        report: buildReport(steps, getTasks(), startedAt, iteration),
      }
    }

    const tasks = getTasks()
    if (tasks.length === 0) {
      appendMemory('Loop', 'No tasks in checklist — nothing to do.')
      opts.emitter?.emit({
        type: 'loop_finished',
        stop: { kind: 'done', message: 'No tasks in checklist' },
        iterations: 0,
      })
      return {
        status: 'no-tasks',
        iterations: 0,
        report: buildReport(steps, tasks, startedAt, 0),
      }
    }

    const nextIdx = findNextTaskIndex(tasks)
    if (nextIdx === -1) {
      const step: LoopStep = {
        iteration,
        taskIndex: -1,
        taskText: '',
        action: 'done',
        attempt: 0,
        message: 'All tasks complete',
        durationMs: 0,
      }
      steps.push(step)
      onStep(step)
      appendMemory('Loop', `Completed in ${iteration} iterations`)
      opts.emitter?.emit({
        type: 'loop_finished',
        stop: { kind: 'done' },
        iterations: iteration,
      })
      return {
        status: 'success',
        iterations: iteration,
        report: buildReport(steps, tasks, startedAt, iteration),
      }
    }

    const task = tasks[nextIdx]
    if (!task) {
      const reason = `Task index ${nextIdx} not found in checklist`
      opts.emitter?.emit({
        type: 'loop_finished',
        stop: { kind: 'fatal', error: reason },
        iterations: iteration,
      })
      return {
        status: 'escalated',
        reason,
        iterations: iteration,
        report: buildReport(steps, tasks, startedAt, iteration),
      }
    }

    iteration += 1
    tracker?.recordIteration()
    const priorAttempts = attemptsForTask(steps, nextIdx)
    const attempt = priorAttempts + 1

    // START
    updateTask(tasks, nextIdx, 'in_progress')
    const startStep: LoopStep = {
      iteration,
      taskIndex: nextIdx,
      taskText: task.text,
      action: 'start',
      attempt,
      durationMs: 0,
    }
    steps.push(startStep)
    onStep(startStep)

    // ACT
    const actStart = Date.now()
    let actResult: ActResult
    try {
      actResult = await opts.act(task)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      actResult = { ok: false, reason: message }
    }
    const actDuration = Date.now() - actStart

    // Sterile-loop detection (P2): record every act invocation under a
    // semantic key (tool=act, args={taskIndex, taskText}). If the same task
    // is retried past `maxSterileRepeats` without progress, the tracker
    // escalates the loop with reason `sterile`.
    tracker?.recordAction(
      actionKey('act', { taskIndex: nextIdx, taskText: task.text }),
    )

    if (!actResult.ok) {
      const failStep: LoopStep = {
        iteration,
        taskIndex: nextIdx,
        taskText: task.text,
        action: 'act-fail',
        attempt,
        message: actResult.reason,
        durationMs: actDuration,
      }
      steps.push(failStep)
      onStep(failStep)

      const decision = await dispatchReason({
        task,
        taskIndex: nextIdx,
        attempt,
        actResult,
        verifyReport: undefined,
        steps,
        iteration,
        reason,
        humanGate,
        onStep,
      })

      if (decision.kind === 'escalate') {
        const reason = `Reasoner on act-fail: ${decision.reason}`
        opts.emitter?.emit({
          type: 'loop_finished',
          stop: { kind: 'fatal', error: reason },
          iterations: iteration,
        })
        return {
          status: 'escalated',
          reason,
          iterations: iteration,
          report: buildReport(steps, tasks, startedAt, iteration),
        }
      }
      if (decision.kind === 'continue') {
        updateTask(tasks, nextIdx, 'done')
        appendMemory(
          'Loop task done',
          `Task ${nextIdx} "${task.text}" — reasoner overrode act-fail with continue`,
        )
        continue
      }
      if (decision.kind === 'refine') {
        const refined = decision.refinedTaskText
        if (refined && tasks[nextIdx]) {
          tasks[nextIdx] = { ...tasks[nextIdx]!, text: refined }
          saveTasks(tasks)
        }
      }

      if (attempt >= config.maxRetriesPerTask) {
        const escStep: LoopStep = {
          iteration,
          taskIndex: nextIdx,
          taskText: task.text,
          action: 'escalate',
          attempt,
          message: `Failed act after ${attempt} attempts: ${actResult.reason ?? 'unknown'}`,
          durationMs: 0,
        }
        steps.push(escStep)
        onStep(escStep)
        appendMemory(
          'Loop escalation',
          `Task ${nextIdx} "${task.text}" failed act after ${attempt} attempts: ${actResult.reason ?? 'unknown'}`,
        )
        const reason = `Task ${nextIdx} failed act after ${attempt} attempts`
        opts.emitter?.emit({
          type: 'loop_finished',
          stop: { kind: 'fatal', error: reason },
          iterations: iteration,
        })
        return {
          status: 'escalated',
          reason,
          iterations: iteration,
          report: buildReport(steps, tasks, startedAt, iteration),
        }
      }

      // Reset to todo so the next pass treats it as a fresh attempt.
      updateTask(tasks, nextIdx, 'todo')
      const retryStep: LoopStep = {
        iteration,
        taskIndex: nextIdx,
        taskText: task.text,
        action: 'retry',
        attempt,
        message: `Will retry (attempt ${attempt + 1}/${config.maxRetriesPerTask})`,
        durationMs: 0,
      }
      steps.push(retryStep)
      onStep(retryStep)
      continue
    }

    // ACT OK
    const actOkStep: LoopStep = {
      iteration,
      taskIndex: nextIdx,
      taskText: task.text,
      action: 'act-ok',
      attempt,
      message: actResult.reason,
      durationMs: actDuration,
    }
    steps.push(actOkStep)
    onStep(actOkStep)

    // VERIFY
    if (!config.verifyAfterEachTask) {
      const skipDecision = await dispatchReason({
        task,
        taskIndex: nextIdx,
        attempt,
        actResult,
        verifyReport: undefined,
        steps,
        iteration,
        reason,
        humanGate,
        onStep,
      })
      if (skipDecision.kind === 'escalate') {
        const reason = `Reasoner on skipped-verify: ${skipDecision.reason}`
        opts.emitter?.emit({
          type: 'loop_finished',
          stop: { kind: 'fatal', error: reason },
          iterations: iteration,
        })
        return {
          status: 'escalated',
          reason,
          iterations: iteration,
          report: buildReport(steps, tasks, startedAt, iteration),
        }
      }
      if (skipDecision.kind === 'refine') {
        const refined = skipDecision.refinedTaskText
        if (refined && tasks[nextIdx]) {
          tasks[nextIdx] = { ...tasks[nextIdx]!, text: refined }
          saveTasks(tasks)
          updateTask(tasks, nextIdx, 'todo')
          continue
        }
      }
      updateTask(tasks, nextIdx, 'done')
      appendMemory(
        'Loop task done',
        `Task ${nextIdx} "${task.text}" — act ok, verify skipped`,
      )
      continue
    }

    const verifyStart = Date.now()
    const verifyReport = await verify(task, undefined)
    const verifyDuration = Date.now() - verifyStart

    if (verifyReport.allPassed) {
      const okDecision = await dispatchReason({
        task,
        taskIndex: nextIdx,
        attempt,
        actResult,
        verifyReport,
        steps,
        iteration,
        reason,
        humanGate,
        onStep,
      })

      if (okDecision.kind === 'escalate') {
        const reason = `Reasoner on verify-ok: ${okDecision.reason}`
        opts.emitter?.emit({
          type: 'loop_finished',
          stop: { kind: 'fatal', error: reason },
          iterations: iteration,
        })
        return {
          status: 'escalated',
          reason,
          iterations: iteration,
          report: buildReport(steps, tasks, startedAt, iteration),
        }
      }
      if (okDecision.kind === 'retry' || okDecision.kind === 'refine') {
        if (okDecision.kind === 'refine') {
          const refined = okDecision.refinedTaskText
          if (refined && tasks[nextIdx]) {
            tasks[nextIdx] = { ...tasks[nextIdx]!, text: refined }
            saveTasks(tasks)
          }
        }
        updateTask(tasks, nextIdx, 'todo')
        continue
      }
      // continue or noop → mark done
      updateTask(tasks, nextIdx, 'done')
      const okStep: LoopStep = {
        iteration,
        taskIndex: nextIdx,
        taskText: task.text,
        action: 'verify-ok',
        attempt,
        result: verifyReport,
        durationMs: verifyDuration,
      }
      steps.push(okStep)
      onStep(okStep)
      appendMemory(
        'Loop task done',
        `Task ${nextIdx} "${task.text}" — verify ok (${verifyReport.totalDurationMs}ms)`,
      )
      continue
    }

    // Verify failed
    const vFailStep: LoopStep = {
      iteration,
      taskIndex: nextIdx,
      taskText: task.text,
      action: 'verify-fail',
      attempt,
      result: verifyReport,
      message: formatReport(verifyReport).split('\n').slice(0, 6).join('\n'),
      durationMs: verifyDuration,
    }
    steps.push(vFailStep)
    onStep(vFailStep)

    const failDecision = await dispatchReason({
      task,
      taskIndex: nextIdx,
      attempt,
      actResult,
      verifyReport,
      steps,
      iteration,
      reason,
      humanGate,
      onStep,
    })

    if (failDecision.kind === 'escalate') {
      const reason = `Reasoner on verify-fail: ${failDecision.reason}`
      opts.emitter?.emit({
        type: 'loop_finished',
        stop: { kind: 'fatal', error: reason },
        iterations: iteration,
      })
      return {
        status: 'escalated',
        reason,
        iterations: iteration,
        report: buildReport(steps, tasks, startedAt, iteration),
      }
    }
    if (failDecision.kind === 'continue') {
      updateTask(tasks, nextIdx, 'done')
      appendMemory(
        'Loop task done',
        `Task ${nextIdx} "${task.text}" — reasoner overrode verify-fail with continue`,
      )
      continue
    }
    if (failDecision.kind === 'refine') {
      const refined = failDecision.refinedTaskText
      if (refined && tasks[nextIdx]) {
        tasks[nextIdx] = { ...tasks[nextIdx]!, text: refined }
        saveTasks(tasks)
      }
    }

    if (attempt >= config.maxRetriesPerTask) {
      const escStep: LoopStep = {
        iteration,
        taskIndex: nextIdx,
        taskText: task.text,
        action: 'escalate',
        attempt,
        message: `Failed verify after ${attempt} attempts`,
        durationMs: 0,
      }
      steps.push(escStep)
      onStep(escStep)
      appendMemory(
        'Loop escalation',
        `Task ${nextIdx} "${task.text}" failed verify after ${attempt} attempts`,
      )
      const reason = `Task ${nextIdx} failed verify after ${attempt} attempts`
      opts.emitter?.emit({
        type: 'loop_finished',
        stop: { kind: 'fatal', error: reason },
        iterations: iteration,
      })
      return {
        status: 'escalated',
        reason,
        iterations: iteration,
        report: buildReport(steps, tasks, startedAt, iteration),
      }
    }

    // Reset to todo for retry.
    updateTask(tasks, nextIdx, 'todo')
    const retryStep: LoopStep = {
      iteration,
      taskIndex: nextIdx,
      taskText: task.text,
      action: 'retry',
      attempt,
      message: `Will retry after verify failure (attempt ${attempt + 1}/${config.maxRetriesPerTask})`,
      durationMs: 0,
    }
    steps.push(retryStep)
    onStep(retryStep)
  }

  // Hit max iterations.
  const maxItersReason = `Reached max iterations (${config.maxIterations})`
  appendMemory('Loop escalation', maxItersReason)
  opts.emitter?.emit({
    type: 'loop_finished',
    stop: { kind: 'fatal', error: maxItersReason },
    iterations: iteration,
  })
  return {
    status: 'escalated',
    reason: maxItersReason,
    iterations: iteration,
    report: buildReport(steps, getTasks(), startedAt, iteration),
  }
}

/**
 * Render a LoopReport as a human-readable timeline. Useful for logs and UIs.
 */
export function formatLoopReport(outcome: LoopOutcome): string {
  const lines: string[] = []
  lines.push(
    `Loop ${outcome.status} after ${outcome.iterations} iteration(s) — ${outcome.report.startedAt} → ${outcome.report.finishedAt}`,
  )
  if (outcome.status === 'escalated') {
    lines.push(`Reason: ${outcome.reason}`)
  }
  for (const step of outcome.report.steps) {
    const tag = `[${step.action.padEnd(15)}]`
    const dur = step.durationMs > 0 ? ` (${step.durationMs}ms)` : ''
    const head = `i${String(step.iteration).padStart(3)} t${String(step.taskIndex).padStart(3)} a${step.attempt} ${tag}${dur}`
    lines.push(`${head} ${step.taskText}`)
    if (step.message) {
      const msg = step.message.split('\n').join('\n            ')
      lines.push(`            ${msg}`)
    }
  }
  return lines.join('\n')
}
