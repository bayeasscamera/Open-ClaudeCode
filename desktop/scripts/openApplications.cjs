const { execFileSync } = require('node:child_process')
const { sanitizedElectronEnv } = require('./electronEnv.cjs')

const appTarget = '/Applications/OPC.app'

execFileSync('open', ['-n', '-a', appTarget], {
  env: sanitizedElectronEnv(),
  stdio: 'inherit',
})
