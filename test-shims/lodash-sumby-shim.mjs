// Minimal stub for lodash-es/sumBy.js — used by src/bootstrap/state.ts at
// runtime in the loop test suite. The rest of the lodash-es surface is
// stubbed at typecheck time via src/utils/__typestubs__/external-deps.d.ts;
// we only need the one function at runtime because the loop smoke test
// transitively imports memory.ts → bootstrap/state.ts.
//
// Keeping the stub standalone (ESM, no deps) means the test suite does not
// have to drag in the real lodash-es package.

function sumBy(arr, iter) {
  if (!Array.isArray(arr)) return 0
  if (typeof iter === 'function') {
    let total = 0
    for (const item of arr) {
      const v = iter(item)
      total += Number(v) || 0
    }
    return total
  }
  if (typeof iter === 'string') {
    let total = 0
    for (const item of arr) {
      const v = item == null ? 0 : item[iter]
      total += Number(v) || 0
    }
    return total
  }
  return 0
}

export { sumBy }
export default sumBy
