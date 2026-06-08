const fs = require('node:fs')
const path = require('node:path')

function privateJsonText(value, { trailingNewline = true } = {}) {
  return `${JSON.stringify(value, null, 2)}${trailingNewline ? '\n' : ''}`
}

function writePrivateJsonFile(filePath, value, { atomic = false, mode = 0o600, trailingNewline = true } = {}) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  if (!atomic) {
    fs.writeFileSync(filePath, privateJsonText(value, { trailingNewline }), { mode })
    fs.chmodSync(filePath, mode)
    return filePath
  }
  const tmp = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`)
  fs.writeFileSync(tmp, privateJsonText(value, { trailingNewline }), { mode })
  fs.chmodSync(tmp, mode)
  fs.renameSync(tmp, filePath)
  return filePath
}

module.exports = {
  privateJsonText,
  writePrivateJsonFile,
}
