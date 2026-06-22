// Resolution hook for the loop test suite.
// Intercepts `lodash-es/sumBy.js` and replaces it with our local stub.

const SHIM_URL = new URL('./lodash-sumby-shim.mjs', import.meta.url).href

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'lodash-es/sumBy.js' || specifier === 'lodash-es/sumBy') {
    return {
      url: SHIM_URL,
      shortCircuit: true,
      format: 'module',
    }
  }
  return nextResolve(specifier, context)
}
