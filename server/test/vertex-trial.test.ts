import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readFile, writeFile, rm, stat, symlink, chmod } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initializeTrialLedger, withTrialSlot } from '../src/vertex-trial-ledger'
import { createVertexTrialTransport, trialEndpoint } from '../src/vertex-transport'
import { createVertexPhotoMatcher } from '../src/vertex-match'
import { createSyntheticVertexTrialMatcher } from '../src/durable-vertex-trial'
import { comparePhotos } from '../src/photo-match'
import { preparePhoto } from '../src/photo-input'
import { syntheticPng } from './photo-fixtures'
import { runVertexTrial, syntheticTrialInput } from '../src/vertex-trial-cli'

const signal = () => new AbortController().signal
async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const dir = await mkdtemp(join(tmpdir(), 'quest-vertex-test-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const file = join(dir, 'ledger.json')
  await initializeTrialLedger(file, 1)
  return file
}
async function used(file: string) { return (JSON.parse(await readFile(file, 'utf8')) as { used: number }).used }
async function comparison() {
  const photo = await preparePhoto({ bytes: syntheticPng, mimeType: 'image/png' })
  return { reference: photo, candidate: photo, features: ['架空の赤い対象'] }
}
const ok = () => Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{"verdict":"match"}' }] } }] })

test('durable Vertex uses the same authored tower and feature data as the CLI after storage normalization', async () => {
  const tower = await syntheticTrialInput('match')
  const bridge = await syntheticTrialInput('mismatch')
  const other = await preparePhoto({ bytes: syntheticPng, mimeType: 'image/png' })
  let calls = 0
  const matcher = await createSyntheticVertexTrialMatcher(async (request) => {
    const [features, , reference, , candidate] = request.contents[0].parts
    assert.deepEqual(features, { text: JSON.stringify({ verifiedFeatures: tower.features }) })
    assert.deepEqual(reference, { inlineData: { mimeType: 'image/jpeg', data: tower.reference.bytes.toString('base64') } })
    const expected = ++calls === 1 ? tower : bridge
    assert.deepEqual(candidate, { inlineData: { mimeType: 'image/jpeg', data: expected.candidate.bytes.toString('base64') } })
    return { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: calls === 1 ? '{"verdict":"match"}' : '{"verdict":"mismatch"}' }] } }] }
  })
  assert.equal(await comparePhotos(tower, { matcher }), 'MATCH')
  // Admin test photos are still normalized only once when the matcher starts.
  assert.equal(await matcher({ ...bridge, reference: await preparePhoto(bridge.reference) }, { signal: signal() }), 'WRONG_TARGET')
  await assert.rejects(comparePhotos({ ...tower, candidate: other }, { matcher }), { code: 'SYSTEM_ERROR', retryable: false })
  await assert.rejects(comparePhotos({ ...tower, features: [...tower.features, 'other'] }, { matcher }), { code: 'SYSTEM_ERROR', retryable: false })
  assert.equal(calls, 2)
})

test('a private ledger inherits the already used call, persists and refuses reinitialization', async (t) => {
  const file = await fixture(t)
  assert.equal(await used(file), 1)
  assert.equal((await stat(file)).mode & 0o777, 0o600)
  await assert.rejects(initializeTrialLedger(file, 1))
  for (const count of [0, 51, NaN]) await assert.rejects(initializeTrialLedger(file + '.invalid', count))
  assert.equal(await withTrialSlot(file, signal(), async (count) => count), 2)
  assert.equal(await used(file), 2)
  assert.equal(await withTrialSlot(file, signal(), async (count) => count), 3)
})

test('the fiftieth call is allowed; failed calls count and the fifty-first never runs', async (t) => {
  const file = await fixture(t)
  for (let n = 2; n <= 50; n++) {
    await assert.rejects(withTrialSlot(file, signal(), async () => { throw new Error('simulated failure') }))
    assert.equal(await used(file), n)
  }
  await assert.rejects(withTrialSlot(file, signal(), async () => assert.fail('quota exceeded')), { code: 'SYSTEM_ERROR', retryable: false })
  assert.equal(await used(file), 50)
})

test('independent callers share a single in-flight slot and release it after failure', async (t) => {
  const file = await fixture(t)
  let release!: () => void
  let ready!: () => void
  const entered = new Promise<void>((resolve) => { ready = resolve })
  const first = withTrialSlot(file, signal(), async () => { ready(); await new Promise<void>((resolve) => { release = resolve }) })
  await entered
  await assert.rejects(withTrialSlot(file, signal(), async () => assert.fail('concurrent request')))
  assert.equal(await used(file), 2)
  release(); await first
  await assert.rejects(withTrialSlot(file, signal(), async () => { throw new Error('failed') }))
  await withTrialSlot(file, signal(), async () => undefined)
  assert.equal(await used(file), 4)
})

test('missing, corrupted, redirected or incompatible ledger never creates a new allowance', async (t) => {
  const file = await fixture(t)
  const original = await readFile(file, 'utf8')
  await assert.rejects(withTrialSlot(file + '.missing', signal(), async () => assert.fail()))
  for (const text of ['{', original.replace('gemini-3.8-flash', 'different-model'), original.replace('"used":1', '"used":0')]) {
    await writeFile(file, text)
    await assert.rejects(withTrialSlot(file, signal(), async () => assert.fail()))
  }
  await writeFile(file, original)
  await symlink(file, file + '.link')
  await assert.rejects(withTrialSlot(file + '.link', signal(), async () => assert.fail()))
  assert.equal(await used(file), 1)
})

test('REST transport fixes endpoint/headers/generation settings and reserves before sending', async (t) => {
  const file = await fixture(t)
  let calls = 0
  const transport = createVertexTrialTransport(file, { getAccessToken: async () => 'test-token', http: async (url, init) => {
    calls++
    assert.equal(url, trialEndpoint)
    assert.equal(init?.method, 'POST')
    assert.equal(init?.redirect, 'error')
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer test-token')
    assert.equal(new Headers(init?.headers).get('x-goog-user-project'), 'tour-513804')
    const body = JSON.parse(String(init?.body))
    assert.equal(body.generationConfig.thinkingConfig.thinkingLevel, 'LOW')
    assert.equal(body.generationConfig.maxOutputTokens, 1024)
    assert.equal(body.tools, undefined)
    assert.equal(await used(file), 2)
    return ok()
  } })
  assert.equal(await createVertexPhotoMatcher(transport)(await comparison(), { signal: signal() }), 'MATCH')
  assert.equal(calls, 1)
})

test('HTTP errors, redirects, non-JSON and excessive bodies fail safely once and consume a call', async (t) => {
  const file = await fixture(t)
  for (const reply of [new Response('private-cloud-details', { status: 429 }), new Response('', { status: 302 }), new Response('not json'), new Response(' '.repeat(65_537), { headers: { 'content-type': 'application/json' } })]) {
    let calls = 0
    const matcher = createVertexPhotoMatcher(createVertexTrialTransport(file, { getAccessToken: async () => 'test-token', http: async () => { calls++; return reply } }))
    await assert.rejects(matcher(await comparison(), { signal: signal() }), (error: unknown) => {
      assert.equal((error as { code: string }).code, 'SYSTEM_ERROR')
      assert.doesNotMatch((error as Error).message, /private-cloud-details/)
      return true
    })
    assert.equal(calls, 1)
  }
  assert.equal(await used(file), 5)
})

test('authentication failure or pre-cancellation never sends or consumes inference quota', async (t) => {
  const file = await fixture(t)
  const http: typeof fetch = async () => assert.fail('no request')
  await assert.rejects(createVertexPhotoMatcher(createVertexTrialTransport(file, { getAccessToken: async () => { throw new Error('private-credential') }, http }))(await comparison(), { signal: signal() }), { code: 'SYSTEM_ERROR' })
  const controller = new AbortController(); controller.abort()
  await assert.rejects(createVertexTrialTransport(file, { getAccessToken: async () => assert.fail(), http })({} as never, { signal: controller.signal }))
  assert.equal(await used(file), 1)
})

test('a stalled request is aborted, counted once and never retried', { timeout: 1000 }, async (t) => {
  const file = await fixture(t)
  let calls = 0
  const matcher = createVertexPhotoMatcher(createVertexTrialTransport(file, { timeoutMs: 20, getAccessToken: async () => 'test-token', http: async (_, init) => {
    calls++
    return new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('network aborted')), { once: true })
    })
  } }))
  await assert.rejects(matcher(await comparison(), { signal: signal() }), { code: 'SYSTEM_ERROR' })
  assert.equal(calls, 1)
  assert.equal(await used(file), 2)
  await withTrialSlot(file, signal(), async () => undefined)
})

test('another process resumes the same allowance; unsafe file permissions and leftover locks stop it', async (t) => {
  const file = await fixture(t)
  const script = 'require(process.argv[1]).withTrialSlot(process.argv[2],new AbortController().signal,async()=>{}).catch(()=>process.exitCode=1)'
  const moduleFile = require.resolve('../src/vertex-trial-ledger')
  await promisify(execFile)(process.execPath, ['-e', script, moduleFile, file])
  assert.equal(await used(file), 2)
  await chmod(file, 0o644)
  await assert.rejects(withTrialSlot(file, signal(), async () => assert.fail()))
  await chmod(file, 0o600)
  const { mkdir } = await import('node:fs/promises')
  await mkdir(file + '.lock')
  await assert.rejects(withTrialSlot(file, signal(), async () => assert.fail()))
  assert.equal(await used(file), 2)
})

test('quota exhaustion stays non-retryable through the transport and sends nothing', async (t) => {
  const file = await fixture(t)
  for (let n = 2; n <= 50; n++) await withTrialSlot(file, signal(), async () => undefined)
  const matcher = createVertexPhotoMatcher(createVertexTrialTransport(file, { getAccessToken: async () => 'test-token', http: async () => assert.fail('quota exhausted') }))
  await assert.rejects(matcher(await comparison(), { signal: signal() }), { code: 'SYSTEM_ERROR', retryable: false })
})

test('credential waiting obeys the deadline and cancellation does not free a still-running send', { timeout: 1000 }, async (t) => {
  const file = await fixture(t)
  const waiting = createVertexTrialTransport(file, { timeoutMs: 15, getAccessToken: async () => new Promise(() => {}), http: async () => assert.fail() })
  await assert.rejects(waiting({} as never, { signal: signal() }), { code: 'SYSTEM_ERROR' })
  assert.equal(await used(file), 1)
  let release!: (response: Response) => void
  let entered!: () => void
  const ready = new Promise<void>((resolve) => { entered = resolve })
  const controller = new AbortController()
  const request = createVertexTrialTransport(file, { getAccessToken: async () => 'test-token', http: async () => { entered(); return new Promise<Response>((resolve) => { release = resolve }) } })
  const pending = request({ generationConfig: {} } as never, { signal: controller.signal })
  await ready; controller.abort()
  await assert.rejects(withTrialSlot(file, signal(), async () => assert.fail('network still running')))
  release(ok())
  await assert.rejects(pending, { name: 'AbortError' })
  assert.equal(await used(file), 2)
})

test('the local CLI initializes without credentials and rejects production, paths and extra arguments', async (t) => {
  const file = await fixture(t)
  const env = { NODE_ENV: 'development', QUEST_VERTEX_TRIAL_LEDGER: file + '.cli' }
  assert.deepEqual(await runVertexTrial(['init'], env), { source: 'vertex-trial', status: 'initialized', used: 5, limit: 50 })
  for (const [args, configuration] of [
    [['match'], { ...env, NODE_ENV: 'production' }],
    [['match'], { ...env, QUEST_VERTEX_TRIAL_LEDGER: 'relative.json' }],
    [['/private/photo.jpg'], env], [['match', 'extra'], env],
  ] as const) await assert.rejects(runVertexTrial(args, configuration))
})
