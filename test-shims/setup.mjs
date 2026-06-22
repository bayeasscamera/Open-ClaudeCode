// Test setup loaded via `node --import ./test-shims/setup.mjs`.
//
// Registers a module-resolution hook that intercepts `lodash-es/sumBy.js`
// and redirects it to our minimal stub. This lets the loop smoke test
// import loopRunner (which transitively imports memory.ts → bootstrap/
// state.ts → lodash-es/sumBy.js) without dragging in the full lodash-es
// package as a devDependency.
//
// The hook is registered BEFORE node starts running test files so all
// subsequent imports see the shim.

import { register } from 'node:module'

register(new URL('./hook.mjs', import.meta.url))

