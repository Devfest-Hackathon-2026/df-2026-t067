import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { resolve } from 'node:path'
import { test } from 'node:test'

const executable = resolve(__dirname, '../src/main.js')

async function unusedPort(): Promise<number> {
  const server = createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert(address && typeof address !== 'string')
  await new Promise<void>((done) => server.close(() => done()))
  return address.port
}

test('importing factory or executable has no listening/startup side effects', { timeout: 5000 }, async () => {
  const child = spawn(process.execPath, ['-e', `require(${JSON.stringify(executable)}); require(${JSON.stringify(resolve(__dirname, '../src/server.js'))})`],
    { env: {}, stdio: 'pipe' })
  let output = ''
  child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString() })
  child.stderr.on('data', (chunk: Buffer) => { output += chunk.toString() })
  const [code] = await once(child, 'exit')
  assert.equal(code, 0)
  assert.equal(output, '')
})

test('executable binds localhost, serves demo health, and shuts down on SIGTERM', { timeout: 10_000 }, async (t) => {
  const port = await unusedPort()
  const child = spawn(process.execPath, [executable], {
    env: { QUEST_DATA_MODE: 'demo', NODE_ENV: 'development', PORT: String(port) }, stdio: 'pipe',
  })
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL') })
  let output = ''
  let errors = ''
  child.stderr.on('data', (chunk: Buffer) => { errors += chunk.toString() })
  await new Promise<void>((ready, reject) => {
    child.once('error', reject)
    child.once('exit', () => reject(new Error('Server exited before readiness: ' + errors)))
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString()
      if (output.includes('FICTIONAL DEMO DATA')) ready()
    })
  })
  assert.match(output, new RegExp('http://127\\.0\\.0\\.1:' + port))
  const response = await fetch('http://127.0.0.1:' + port + '/health')
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('X-Quest-Data-Mode'), 'demo')
  await response.arrayBuffer()
  const exit = once(child, 'exit')
  child.kill('SIGTERM')
  const [code, signal] = await exit
  assert.equal(code, 0)
  assert.equal(signal, null)
  assert.equal(errors, '')
})

test('executable fails closed in production, on emulator configuration, or without explicit data mode', { timeout: 10_000 }, async () => {
  for (const env of [
    { NODE_ENV: 'production', QUEST_DATA_MODE: 'demo' },
    { NODE_ENV: 'production' },
    { NODE_ENV: 'development' },
    { NODE_ENV: 'development', QUEST_DATA_MODE: 'firestore' },
    { NODE_ENV: 'development', QUEST_DATA_MODE: 'demo', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099' },
  ]) {
    const child = spawn(process.execPath, [executable], { env, stdio: 'pipe' })
    let errors = ''
    let output = ''
    child.stderr.on('data', (chunk: Buffer) => { errors += chunk.toString() })
    child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString() })
    const [code] = await once(child, 'exit')
    assert.equal(code, 1)
    assert.equal(output, '')
    assert.match(errors, /explicitly selected|production startup|signed Firebase ID tokens/)
  }
})

test('durable-local starts through the executable, serves local health, and stops on SIGTERM', {
  skip: !process.env.QUEST_FIRESTORE_TEST_HOST || !process.env.QUEST_STORAGE_TEST_HOST, timeout: 15_000,
}, async (t) => {
  const firestoreHost = process.env.QUEST_FIRESTORE_TEST_HOST!
  const storageHost = process.env.QUEST_STORAGE_TEST_HOST!
  for (const host of [firestoreHost, storageHost]) assert.match(host, /^127\.0\.0\.1:[1-9]\d{0,4}$/)
  const project = 'demo-t067-durable-local'
  const bucket = await fetch(`http://${storageHost}/storage/v1/b?project=${project}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: project + '.appspot.com' }),
  })
  assert(bucket.ok || bucket.status === 409)
  await bucket.body?.cancel()
  const port = await unusedPort()
  const child = spawn(process.execPath, [executable], { env: {
    QUEST_DATA_MODE: 'durable-local', NODE_ENV: 'development', PORT: String(port),
    FIRESTORE_EMULATOR_HOST: firestoreHost, QUEST_DURABLE_STORAGE_ENDPOINT: 'http://' + storageHost,
    FIREBASE_PROJECT_ID: 'demo-auth-project',
  }, stdio: 'pipe' })
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL') })
  let errors = '', output = ''
  child.stderr.on('data', (chunk: Buffer) => { errors += chunk.toString() })
  await new Promise<void>((ready, reject) => {
    child.once('error', reject)
    child.once('exit', () => reject(new Error('Durable server exited before readiness: ' + errors)))
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString()
      if (output.includes('DURABLE LOCAL')) ready()
    })
  })
  const base = 'http://127.0.0.1:' + port
  const health = await fetch(base + '/health')
  assert.equal(health.status, 200)
  assert.equal(health.headers.get('X-Quest-Data-Mode'), 'durable-local')
  assert.deepEqual(await health.json(), { status: 'ok', dataMode: 'durable-local' })
  const unsigned = await fetch(base + '/api/v1/session', { headers: { Authorization: 'Bearer not-a-signed-token' } })
  assert.equal(unsigned.status, 401)
  await unsigned.body?.cancel()
  const exit = once(child, 'exit')
  child.kill('SIGTERM')
  assert.deepEqual(await exit, [0, null])
  assert.equal(errors, '')
})
