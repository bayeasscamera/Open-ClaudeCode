const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.join(__dirname, '..', '..')

test('src refactor gates keep query recovery policy extracted and allowlisted', () => {
  const tsconfig = JSON.parse(fs.readFileSync(path.join(root, 'tsconfig.check.json'), 'utf8'))
  const query = fs.readFileSync(path.join(root, 'src', 'query.ts'), 'utf8')
  const recoveryPolicy = fs.readFileSync(path.join(root, 'src', 'query', 'recoveryPolicy.ts'), 'utf8')

  assert.equal(tsconfig.compilerOptions.noEmit, true)
  assert.equal(tsconfig.compilerOptions.types.includes('node'), true)
  assert.equal(tsconfig.include.includes('src/query/recoveryPolicy.ts'), true)
  assert.equal(tsconfig.include.includes('src/typecheck/**/*.d.ts'), true)
  assert.match(query, /from '\.\/query\/recoveryPolicy\.js'/)
  assert.match(recoveryPolicy, /MAX_OUTPUT_TOKENS_RECOVERY_LIMIT = 3/)
  assert.match(recoveryPolicy, /apiError === 'max_output_tokens'/)
  assert.doesNotMatch(recoveryPolicy, /from '\.\.\/types\/message\.js'/)
})
