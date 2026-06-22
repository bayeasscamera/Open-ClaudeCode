// Runtime stubs for modules that exist only as ambient declarations
// (src/utils/__typestubs__/external-deps.d.ts) — they pass typecheck but
// have no real implementation in this repo. The loop test suite loads
// this file via `node --require ./test-shims/cjs-shim.cjs` so the runner
// can be exercised end-to-end without dragging in the full Claude Code
// runtime (OpenTelemetry, Anthropic SDK, etc.) as devDependencies.
//
// Two kinds of stubs:
//   - STUBS: in-place Proxy / object replacements for ambient-only modules.
//   - Per-module noop files for `memory` and `taskChecklist`, which the
//     runner actually CALLS (we don't want silent Proxy failures here).

const path = require('node:path')

/**
 * Build a no-op function that swallows all arguments and returns undefined.
 * `name` is used only for stack traces and debugging.
 */
function noop(_name) {
  return function () {}
}

/**
 * Create a Proxy that returns no-op functions for any callable-looking
 * property name. Returns `undefined` for data accesses so accidental
 * property reads throw a clear TypeError at the call site instead of
 * silently returning junk.
 */
function emptyModuleProxy() {
  return new Proxy({}, {
    get(_target, prop) {
      if (prop === '__esModule') return true
      if (prop === 'default') return undefined
      if (typeof prop === 'symbol') return undefined
      if (
        /^(get|set|read|write|save|load|build|create|reset|format|append|remove|update|mark|upsert|delete|find|fetch|is|has|should|can|to|parse|from|emit|on|off|subscribe|publish|attach|detach)/.test(
          String(prop),
        )
      ) {
        return () => undefined
      }
      return undefined
    },
  })
}

/**
 * Plain object with no-op fallback for method-like properties. Use when
 * the consumer needs to destructure real function references (e.g.
 * `const { randomUUID } = require('crypto')`).
 */
function emptyModuleObject(extras) {
  const target = { __esModule: true, ...(extras || {}) }
  return new Proxy(target, {
    get(t, prop) {
      if (prop in t) return t[prop]
      if (typeof prop === 'symbol') return undefined
      if (
        /^(get|set|read|write|save|load|build|create|reset|format|append|remove|update|mark|upsert|delete|find|fetch|is|has|should|can|to|parse|from|emit|on|off|subscribe|publish|attach|detach|random|generate|hash|sign|verify|encrypt|decrypt|create.*)/.test(
          String(prop),
        )
      ) {
        const fn = function () {}
        t[prop] = fn
        return fn
      }
      return undefined
    },
  })
}

const STUBS = {
  // Ambient-only deps that the runner transitively pulls in.
  'src/entrypoints/agentSdkTypes.js': emptyModuleProxy(),
  'src/tools/AgentTool/agentColorManager.js': emptyModuleProxy(),
  'src/types/hooks.js': emptyModuleProxy(),
  'src/types/ids.js': emptyModuleObject(),
  'src/utils/crypto.js': emptyModuleObject(),
  'src/utils/model/model.js': emptyModuleProxy(),
  'src/utils/model/modelStrings.js': emptyModuleProxy(),
  'src/utils/settings/constants.js': emptyModuleProxy(),
  'src/utils/settings/settingsCache.js': emptyModuleProxy(),
  'src/utils/settings/types.js': emptyModuleProxy(),
  // signal.createSignal() returns an object with at least `subscribe`.
  'src/utils/signal.js': emptyModuleObject({
    createSignal: (_initial) => ({
      subscribe: () => () => {},
      unsubscribe: () => {},
      emit: () => {},
      get: () => undefined,
    }),
  }),
}

// bootstrap/state.js is the worst offender — it pulls crypto, lodash, and
// many internals. Replace it with a minimal implementation that exposes
// getProjectRoot (used by memory.ts).
STUBS['src/bootstrap/state.js'] = {
  getProjectRoot: () => path.resolve(__dirname, '..', '.test-project-root'),
  STATE: {},
}

// memory.js and taskChecklist.js touch the filesystem via fs. The smoke
// test does not need real persistence, so we replace them with in-memory
// noops. Their noop implementations live in sibling files so the test
// runner can introspect them if needed.
const memoryNoop = require('./memory-noop.cjs')
STUBS['src/utils/memory.js'] = memoryNoop
STUBS['src/utils/memory.cjs'] = memoryNoop
STUBS['./memory.js'] = memoryNoop

const tasksNoop = require('./taskchecklist-noop.cjs')
STUBS['src/utils/taskChecklist.js'] = tasksNoop
STUBS['src/utils/taskChecklist.cjs'] = tasksNoop
STUBS['./taskChecklist.js'] = tasksNoop

function resolveStub(request) {
  if (!request) return null
  if (request.startsWith('./') || request.startsWith('../')) {
    // Relative imports — leave them alone.
    return null
  }
  if (STUBS[request]) return STUBS[request]
  if (STUBS[request + '.js']) return STUBS[request + '.js']
  if (request.startsWith('lodash-es/')) {
    return require('./lodash-sumby-shim.cjs')
  }
  return null
}

const Module = require('node:module')
const originalResolve = Module._resolveFilename
Module._resolveFilename = function patchedResolve(request, parent, ...rest) {
  const stub = resolveStub(request)
  if (stub) {
    // Construct a synthetic Module that already has the stub loaded, then
    // return its fake id. Module._cache stores it so require() returns it.
    const fakeId = `opc-test-stub:${request}`
    const cached = Module._cache[fakeId]
    if (cached) return fakeId
    const m = new Module(fakeId, parent)
    m.filename = fakeId
    m.loaded = true
    m.exports = stub
    Module._cache[fakeId] = m
    return fakeId
  }
  return originalResolve.call(this, request, parent, ...rest)
}

module.exports = { STUBS }
