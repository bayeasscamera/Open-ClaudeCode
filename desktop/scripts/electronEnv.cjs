function sanitizedElectronEnv(extraEnv = {}) {
  const env = { ...process.env, ...extraEnv }
  delete env.ELECTRON_RUN_AS_NODE
  return env
}

module.exports = { sanitizedElectronEnv }
