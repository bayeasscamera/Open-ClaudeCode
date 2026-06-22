import { runLoop, formatLoopReport } from './loopRunner.js'
import { initTasks, saveTasks } from './taskChecklist.js'
import { runVerification, type Criterion } from './verification.js'
import {
  createReasoner,
  defaultReason,
  type Reason,
  type ReasonContext,
  type ReasonDecision,
} from './loopReasoner.js'
import { createScriptedHumanGate, type HumanGate } from './humanInTheLoop.js'

/**
 * Example wiring of the OPC loop prototype (with ReAct + human-in-the-loop).
 *
 * This is a runnable demonstration. It:
 *   1. Seeds a small checklist.
 *   2. Wires an `act` callback that interprets the task text as a list of
 *      Criteria lines (one per line) and runs them.
 *   3. Skips per-task verify (criteria are themselves the verification).
 *   4. Wires a custom reasoner that triggers ask-human after repeated
 *      transient failures.
 *   5. Wires a scripted human gate (approve / reject / timeout) so the
 *      demo is non-interactive.
 *   6. Streams steps to stdout via `onStep`.
 *
 * Invoke with:  npx tsx src/utils/loopRunner.example.ts
 */
export async function runExample(): Promise<void> {
  initTasks('Loop engineering prototype demo (ReAct + HITL)')

  const seed = [
    { text: 'fileExists: docs/OPC_LOOP_ENGINEERING_AUDIT_2026-06-21.md', status: 'todo' as const },
    { text: 'fileContains: package.json | "verify:ci"', status: 'todo' as const },
    { text: 'command: node -e "process.exit(0)"', status: 'todo' as const },
  ]
  saveTasks(seed)

  const act = async (task: { text: string }) => {
    const lines = task.text.split('\n').map(l => l.trim()).filter(Boolean)
    const criteria: Criterion[] = []
    for (const line of lines) {
      if (line.startsWith('fileExists:')) {
        criteria.push({ type: 'fileExists', path: line.slice('fileExists:'.length).trim() })
      } else if (line.startsWith('fileContains:')) {
        const [path, substr] = line
          .slice('fileContains:'.length)
          .split('|')
          .map(s => s.trim())
        if (path && substr) {
          criteria.push({ type: 'fileContains', path, substring: substr })
        }
      } else if (line.startsWith('command:')) {
        const rest = line.slice('command:'.length).trim()
        const parts = rest.split(/\s+/)
        const [command, ...args] = parts
        if (command) {
          criteria.push({ type: 'command', command, args })
        }
      }
    }

    if (criteria.length === 0) {
      return { ok: false, reason: `No parseable criteria in task: ${task.text}` }
    }

    const report = await runVerification(criteria)
    if (!report.allPassed) {
      return {
        ok: false,
        reason: `Criteria failed: ${report.results
          .filter(r => !r.passed)
          .map(r => r.detail ?? 'unknown')
          .join('; ')}`,
      }
    }
    return { ok: true, reason: `${criteria.length} criteria passed` }
  }

  // Custom ReAct reasoner:
  //   - if verify-fail with low confidence → ask-human
  //   - otherwise delegate to the default heuristic reasoner
  const reason: Reason = async (ctx: ReasonContext): Promise<ReasonDecision> => {
    if (ctx.verifyReport && !ctx.verifyReport.allPassed && ctx.attempt >= 2) {
      return {
        kind: 'ask-human',
        confidence: 0.3,
        rationale: `Verify keeps failing on attempt ${ctx.attempt}; need a human decision.`,
      }
    }
    return defaultReason(ctx)
  }

  // Scripted human gate: approve the first prompt, reject the second, then
  // time out. This makes the demo deterministic without an interactive TTY.
  const humanGate: HumanGate = createScriptedHumanGate({
    answers: ['approved', 'rejected', 'timeout'],
    defaultDecision: 'timeout',
  })

  const outcome = await runLoop({
    act,
    reason: createReasoner({ reason }),
    humanGate,
    config: { maxIterations: 20, maxRetriesPerTask: 4, verifyAfterEachTask: false },
    onStep: step => {
      // eslint-disable-next-line no-console
      console.log(
        `[loop] i${step.iteration} t${step.taskIndex} ${step.action} (${step.durationMs}ms) — ${step.taskText}`,
      )
    },
  })

  // eslint-disable-next-line no-console
  console.log('\n' + formatLoopReport(outcome))
}

// Allow CLI invocation via:  npx tsx src/utils/loopRunner.example.ts
// We avoid `import.meta` because the project emits CommonJS.
const invokedDirectly = process.argv[1]?.endsWith('loopRunner.example.ts')
if (invokedDirectly) {
  runExample().catch(err => {
    // eslint-disable-next-line no-console
    console.error('Example failed:', err)
    process.exit(1)
  })
}
