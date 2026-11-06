import assert from 'node:assert/strict'
import { once } from 'node:events'
import { request } from 'node:http'
import type { Server } from 'node:http'
import type { TestContext } from 'node:test'
import { createServer } from '../src/server'
import type { ServerOptions } from '../src/server'

export async function startServer(t: TestContext, options: Partial<ServerOptions> = {}) {
  return listenServer(t, createServer({ mode: 'demo', ...options }))
}

export async function listenServer(t: TestContext, server: Server) {
  assert.equal(server.listening, false)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
    server.closeAllConnections()
  }))
  const address = server.address()
  assert(address && typeof address !== 'string')
  assert.equal(address.address, '127.0.0.1')
  return { base: 'http://127.0.0.1:' + address.port, server }
}

export async function expectError(response: Response, status: number, code: string, retryable = false) {
  assert.equal(response.status, status)
  assert.equal(response.headers.get('X-Quest-Data-Mode'), 'demo')
  const payload = await response.json() as { error: Record<string, unknown> }
  assert.deepEqual(Object.keys(payload), ['error'])
  assert.deepEqual(Object.keys(payload.error).sort(), ['code', 'message', 'requestId', 'retryable'])
  assert.equal(payload.error.code, code)
  assert.equal(payload.error.retryable, retryable)
  assert.equal(typeof payload.error.message, 'string')
  assert.equal(payload.error.requestId, response.headers.get('X-Request-Id'))
  assert.match(String(payload.error.requestId), /^[0-9a-f-]{36}$/)
  return payload
}

// Raw HTTP is necessary for GET bodies, duplicate headers and path segments
// that a browser URL parser would normalize before sending.
export async function rawGet(base: string, path: string, headers: string[] = [], body = '') {
  return new Promise<{ status: number; body: unknown }>((resolve, reject) => {
    const url = new URL(base)
    const req = request({
      hostname: url.hostname, port: url.port, path, method: 'GET',
      headers: ['Host', url.host, ...headers, 'Content-Length', String(Buffer.byteLength(body))],
    }, (res) => {
      let content = ''
      res.setEncoding('utf8')
      res.on('data', (chunk: string) => { content += chunk })
      res.on('error', reject)
      res.on('end', () => {
        try { resolve({ status: res.statusCode ?? 0, body: JSON.parse(content) }) }
        catch (error) { reject(error) }
      })
    })
    req.on('error', reject)
    req.end(body)
  })
}
