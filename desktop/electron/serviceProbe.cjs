const http = require('node:http')
const https = require('node:https')
const net = require('node:net')

const DEFAULT_PORT_TIMEOUT_MS = 700
const DEFAULT_URL_TIMEOUT_MS = 1200

function compactError(error) {
  if (!error) return ''
  return error.code || error.message || String(error)
}

function normalizeService(service) {
  if (!service || typeof service !== 'object') return null
  const name = String(service.name || '').trim()
  const url = String(service.url || '').trim()
  const port = Number(service.port)
  return {
    name: name || (Number.isInteger(port) && port > 0 ? `port-${port}` : url || 'service'),
    url: url || '',
    port: Number.isInteger(port) && port > 0 ? port : 0,
  }
}

function checkPort(port, timeoutMs = DEFAULT_PORT_TIMEOUT_MS) {
  return new Promise(resolve => {
    if (!Number.isInteger(port) || port <= 0) {
      resolve({ ready: false, error: 'invalid-port' })
      return
    }
    const socket = net.createConnection({ host: '127.0.0.1', port })
    let settled = false
    function finish(result) {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(result)
    }
    socket.setTimeout(timeoutMs, () => finish({ ready: false, error: 'timeout' }))
    socket.once('connect', () => finish({ ready: true }))
    socket.once('error', error => finish({ ready: false, error: compactError(error) }))
  })
}

function checkUrl(url, timeoutMs = DEFAULT_URL_TIMEOUT_MS) {
  return new Promise(resolve => {
    if (!/^https?:\/\//i.test(String(url || ''))) {
      resolve({ ready: false, error: 'invalid-url' })
      return
    }
    const transport = String(url).startsWith('https:') ? https : http
    const req = transport.request(
      url,
      {
        method: 'GET',
        timeout: timeoutMs,
        headers: { Connection: 'close' },
      },
      response => {
        response.resume()
        const ready = Number(response.statusCode || 0) > 0 && Number(response.statusCode || 0) < 500
        resolve({
          ready,
          statusCode: response.statusCode || 0,
          error: ready ? '' : `HTTP ${response.statusCode || 0}`,
        })
      },
    )
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', error => resolve({ ready: false, error: compactError(error) }))
    req.end()
  })
}

async function probeService(service) {
  const normalized = normalizeService(service)
  if (!normalized) return null
  let result = { ready: false, error: '' }
  if (normalized.port) {
    result = await checkPort(normalized.port)
  } else if (normalized.url) {
    result = await checkUrl(normalized.url)
  }
  return {
    ...normalized,
    ready: Boolean(result.ready),
    statusCode: result.statusCode || 0,
    error: result.error || '',
    status: result.ready ? 'ready' : 'down',
  }
}

async function probeTask(task) {
  const services = Array.isArray(task?.services) ? task.services : []
  const normalized = services.map(normalizeService).filter(Boolean)
  const seen = new Set()
  const uniqueServices = normalized.filter(service => {
    const key = `${service.name}|${service.port}|${service.url}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  const results = (await Promise.all(uniqueServices.map(probeService))).filter(Boolean)
  const readyCount = results.filter(service => service.ready).length
  return {
    id: String(task?.id || ''),
    checkedAt: Date.now(),
    ready: results.length > 0 && readyCount === results.length,
    partial: readyCount > 0 && readyCount < results.length,
    services: results,
  }
}

async function probeServices(tasks) {
  const input = Array.isArray(tasks) ? tasks : []
  return Promise.all(input.map(probeTask))
}

module.exports = {
  checkPort,
  checkUrl,
  probeServices,
}
