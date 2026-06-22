// CJS version of the lodash-es/sumBy stub for the loop test suite.
//
// Picked up by test-shims/cjs-shim.cjs via Module._resolveFilename
// patching. Mirrors the ESM stub (lodash-sumby-shim.mjs) — keep them in
// sync if either side changes.

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

module.exports = sumBy
module.exports.sumBy = sumBy
module.exports.default = sumBy
