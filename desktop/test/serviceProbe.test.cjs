const assert = require('node:assert/strict')
const http = require('node:http')
const test = require('node:test')
const { checkPort, checkUrl, probeServices } = require('../electron/serviceProbe.cjs')

function listen(server) {
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', error => {
      if (error) reject(error)
      else resolve(server.address().port)
    })
  })
}

function close(server) {
  return new Promise(resolve => server.close(() => resolve()))
}

test('service probe detects an open TCP port', async () => {
  const server = http.createServer((_req, res) => res.end('ok'))
  const port = await listen(server)
  try {
    const result = await checkPort(port)
    assert.equal(result.ready, true)
  } finally {
    await close(server)
  }
})

test('service probe detects a live local URL', async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.end('ready')
  })
  const port = await listen(server)
  try {
    const result = await checkUrl(`http://127.0.0.1:${port}`)
    assert.equal(result.ready, true)
    assert.equal(result.statusCode, 200)
  } finally {
    await close(server)
  }
})

test('service probe reports down services', async () => {
  const result = await probeServices([
    {
      id: 'task-1',
      services: [{ name: 'web', port: 65501, url: 'http://127.0.0.1:65501' }],
    },
  ])
  assert.equal(result.length, 1)
  assert.equal(result[0].ready, false)
  assert.equal(result[0].services[0].ready, false)
})
