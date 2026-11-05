import assert from 'node:assert/strict'
import { request } from 'node:http'
import { once } from 'node:events'
import type { Socket } from 'node:net'
import { test } from 'node:test'
import { createApiClient } from '../../src/shared/api/client'
import { parseAttemptResult, parseChallenge } from '../../src/shared/api/validation'
import { capture } from '../../src/shared/api/testFixtures'
import { quest } from '../../src/shared/api/testFixtures'
import { DemoAnswerStore } from '../src/answers'
import { DemoChallengeStore } from '../src/challenges'
import { HttpError } from '../src/errors'
import { expectError, startServer } from './helpers'

// Generated one-pixel PNG, not a user photo or a real location.
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jvX0AAAAASUVORK5CYII=', 'base64')
const verifier = { verify: async (token: string) => {
  if (token !== 'owner' && token !== 'other') throw new HttpError(401, 'UNAUTHENTICATED', 'ログインが必要です。')
  return { uid: token }
} }
function form(metadata: unknown = capture, bytes = png, type = 'image/png') {
  const body = new FormData()
  body.append('photo', new Blob([bytes], { type }), 'private-filename.png')
  body.append('metadata', JSON.stringify(metadata))
  return body
}
async function setup(t: Parameters<typeof startServer>[0]) {
  const { base } = await startServer(t, { verifier })
  const response = await fetch(base + '/api/v1/challenges', {
    method: 'POST', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: JSON.stringify({ questId: 'demo-quest', expectedVersion: 1 }),
  })
  const challenge = parseChallenge(await response.json())
  const path = '/api/v1/challenges/' + challenge.challengeId + '/answers'
  const submit = (body: BodyInit = form(), key = 'answer-key', token = 'owner') => fetch(base + path, {
    method: 'POST', body, headers: { Authorization: 'Bearer ' + token, 'Idempotency-Key': key },
  })
  return { base, path, submit, challenge }
}

test('an answer is received without judging, storing a photo, or disclosing private inputs', async (t) => {
  const { submit, base } = await setup(t)
  const response = await submit()
  assert.equal(response.status, 202)
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store')
  assert.equal(response.headers.get('X-Quest-Data-Mode'), 'demo')
  const receipt = parseAttemptResult(await response.json())
  assert.match(receipt.attemptId, /^[0-9a-f-]{36}$/)
  assert.deepEqual(receipt, { attemptId: receipt.attemptId, state: 'RECEIVED', outcome: null, nextAction: 'WAIT', source: 'mock' })
  assert.doesNotMatch(JSON.stringify(receipt), /capturedAt|position|latitude|private-filename|owner|challengeId|hash|photo/)
  const restored = await fetch(base + '/api/v1/attempts/' + receipt.attemptId, { headers: { Authorization: 'Bearer owner' } })
  assert.equal(restored.status, 200)
  assert.deepEqual(await restored.json(), receipt)
})

test('same bytes and normalized metadata reuse one receipt across concurrent retries', async (t) => {
  const { submit } = await setup(t)
  const reordered = { position: { measuredAt: capture.position.measuredAt, accuracyMeters: 0, longitude: 0, latitude: 0 }, capturedAt: capture.capturedAt }
  const responses = await Promise.all([submit(), submit(form(reordered))])
  assert.deepEqual(responses.map((r) => r.status), [202, 202])
  const first = await responses[0].json()
  assert.deepEqual(await responses[1].json(), first)
  const changed = Buffer.from(png)
  changed[changed.length - 1] ^= 1
  await expectError(await submit(form(capture, changed)), 409, 'IDEMPOTENCY_CONFLICT')
  await expectError(await submit(form({ ...capture, position: { ...capture.position, latitude: 1 } })), 409, 'IDEMPOTENCY_CONFLICT')
  assert.deepEqual(await (await submit()).json(), first)
  const second = parseAttemptResult(await (await submit(form(), 'new-key')).json())
  assert.notEqual(second.attemptId, (first as { attemptId: string }).attemptId)
})

test('a different user cannot submit to a challenge or read its receipt', async (t) => {
  const { submit, base, path } = await setup(t)
  const receipt = parseAttemptResult(await (await submit()).json())
  await expectError(await submit(form(), 'key', 'other'), 404, 'NOT_FOUND')
  await expectError(await fetch(base + '/api/v1/challenges/unknown/answers', {
    method: 'POST', headers: { Authorization: 'Bearer other', 'Idempotency-Key': 'key' }, body: form(),
  }), 404, 'NOT_FOUND')
  const url = base + '/api/v1/attempts/' + receipt.attemptId
  await expectError(await fetch(url, { headers: { Authorization: 'Bearer other' } }), 404, 'NOT_FOUND')
  await expectError(await fetch(url), 401, 'UNAUTHENTICATED')
  await expectError(await fetch(base + path, { method: 'POST', body: form() }), 401, 'UNAUTHENTICATED')
  await expectError(await submit(form(), 'key', 'invalid'), 401, 'UNAUTHENTICATED')
  const unavailable = await startServer(t)
  await expectError(await fetch(unavailable.base + path, { method: 'POST', body: form() }), 503, 'AUTH_UNAVAILABLE', true)
})

test('rate and capacity limits do not overwrite a previous receipt and preserve owner separation', async (t) => {
  let now = 1_000
  const answers = new DemoAnswerStore({ capacity: 1, requestsPerMinute: 2, now: () => now })
  const challenges = new DemoChallengeStore()
  const selected = challenges.start('owner', quest).challenge
  const { base } = await startServer(t, { verifier, challenges, answers })
  const post = (key: string) => fetch(base + '/api/v1/challenges/' + selected.challengeId + '/answers', {
    method: 'POST', body: form(), headers: { Authorization: 'Bearer owner', 'Idempotency-Key': key },
  })
  const first = await (await post('first')).json()
  await expectError(await post('other'), 503, 'SYSTEM_ERROR')
  const limited = await post('first')
  assert.equal(limited.headers.get('Retry-After'), '60')
  await expectError(limited, 429, 'RATE_LIMITED', true)
  now += 60_001
  assert.deepEqual(await (await post('first')).json(), first)
  const id = (first as { attemptId: string }).attemptId
  assert.equal(answers.getOwned(id, 'other'), null)
  const copy = answers.getOwned(id, 'owner')!
  copy.nextAction = 'tampered'
  assert.equal(answers.getOwned(id, 'owner')?.nextAction, 'WAIT')
  assert.equal(new DemoAnswerStore().getOwned(id, 'owner'), null)
})

test('concurrent receiver slots are bounded and released even after a malformed upload', async (t) => {
  const answers = new DemoAnswerStore({ concurrentUploads: 1 })
  const challenges = new DemoChallengeStore()
  const selected = challenges.start('owner', quest).challenge
  const { base } = await startServer(t, { verifier, challenges, answers })
  const post = (body: BodyInit) => fetch(base + '/api/v1/challenges/' + selected.challengeId + '/answers', {
    method: 'POST', body, headers: { Authorization: 'Bearer owner', 'Idempotency-Key': 'key' },
  })
  const release = answers.acquire('other')
  const response = await post(form())
  await expectError(response, 429, 'RATE_LIMITED', true)
  assert.equal(response.headers.get('Retry-After'), '1')
  release()
  release()
  await expectError(await post('malformed'), 415, 'HTTP_ERROR')
  assert.equal((await post(form())).status, 202)
})

test('stale and no-longer-public quest references cannot receive new answers', async (t) => {
  for (const [change, code] of [[{ version: 2 }, 'QUEST_CHANGED'], [{ questId: 'not-public' }, 'QUEST_UNAVAILABLE']] as const) {
    const challenges = new DemoChallengeStore()
    const selected = challenges.start('owner', { ...quest, ...change }).challenge
    const { base } = await startServer(t, { verifier, challenges })
    await expectError(await fetch(base + '/api/v1/challenges/' + selected.challengeId + '/answers', {
      method: 'POST', body: form(), headers: { Authorization: 'Bearer owner', 'Idempotency-Key': 'key' },
    }), 409, code)
  }
})

test('disconnecting an unfinished upload releases its receiving slot', async (t) => {
  const answers = new DemoAnswerStore({ concurrentUploads: 1 })
  const challenges = new DemoChallengeStore()
  const selected = challenges.start('owner', quest).challenge
  let authenticated!: () => void
  const started = new Promise<void>((resolve) => { authenticated = resolve })
  const { base, server } = await startServer(t, { verifier: { verify: async (token) => {
    const identity = await verifier.verify(token)
    authenticated()
    return identity
  } }, challenges, answers })
  const path = '/api/v1/challenges/' + selected.challengeId + '/answers'
  const url = new URL(base)
  const connected = once(server, 'connection')
  const req = request({ hostname: url.hostname, port: url.port, path, method: 'POST', headers: {
    Authorization: 'Bearer owner', 'Idempotency-Key': 'key', 'Content-Type': 'multipart/form-data; boundary=test',
  } })
  req.on('error', () => {})
  req.write('--test\r\n')
  const [socket] = await connected as [Socket]
  await started
  await new Promise<void>((resolve) => setImmediate(resolve))
  // A deliberately incomplete chunked request can emit a parser/socket error
  // before close. That is the scenario; wait for close without rejecting on it.
  const closed = new Promise<void>((resolve) => socket.once('close', () => resolve()))
  req.destroy()
  await closed
  await new Promise<void>((resolve) => setImmediate(resolve))
  const response = await fetch(base + path, { method: 'POST', body: form(), headers: { Authorization: 'Bearer owner', 'Idempotency-Key': 'new-key' } })
  assert.equal(response.status, 202)
})

test('multipart fields and capture metadata are an allowlist, never trusted client authority', async (t) => {
  const { submit } = await setup(t)
  for (const body of [
    (() => { const b = form(); b.append('uid', 'other'); return b })(),
    (() => { const b = form(); b.append('metadata', JSON.stringify(capture)); return b })(),
    (() => { const b = form(); b.delete('photo'); return b })(),
    (() => { const b = form(); b.set('photo', 'not-a-file'); return b })(),
    (() => { const b = form(); b.set('metadata', new Blob(['{}']), 'metadata.json'); return b })(),
    form({ ...capture, isCorrect: true }),
    form({ ...capture, capturedAt: 'invalid' }),
    form({ ...capture, position: { ...capture.position, latitude: 91 } }),
  ]) await expectError(await submit(body), 400, 'INVALID_INPUT')
})

test('only supported nonempty image signatures and bounded metadata are accepted', async (t) => {
  const { submit } = await setup(t)
  await expectError(await submit(form(capture, Buffer.alloc(0))), 400, 'INVALID_INPUT')
  await expectError(await submit(form(capture, Buffer.from('<svg/>'), 'image/svg+xml')), 415, 'HTTP_ERROR')
  await expectError(await submit(form(capture, png, 'image/jpeg')), 400, 'INVALID_INPUT')
  const largeMetadata = form()
  largeMetadata.set('metadata', ' '.repeat(5000))
  await expectError(await submit(largeMetadata), 413, 'MEDIA_TOO_LARGE')
  await expectError(await submit(form(capture, Buffer.alloc(4 * 1024 * 1024 + 1))), 413, 'MEDIA_TOO_LARGE')
  const valid = await submit()
  assert.equal(valid.status, 202)
})

test('bad keys, content types, query parameters and malformed multipart fail safely', async (t) => {
  const { submit, base, path } = await setup(t)
  await expectError(await submit(form(), ''), 400, 'INVALID_INPUT')
  await expectError(await submit(form(), 'a'.repeat(129)), 400, 'INVALID_INPUT')
  await expectError(await submit('not-multipart'), 415, 'HTTP_ERROR')
  await expectError(await fetch(base + path + '?uid=other', { method: 'POST', body: form(), headers: { Authorization: 'Bearer owner', 'Idempotency-Key': 'key' } }), 400, 'INVALID_INPUT')
  await expectError(await fetch(base + path, { method: 'POST', body: 'broken', headers: {
    Authorization: 'Bearer owner', 'Idempotency-Key': 'key', 'Content-Type': 'multipart/form-data; boundary=missing',
  } }), 400, 'INVALID_INPUT')
  const method = await fetch(base + path)
  assert.equal(method.status, 405)
  assert.equal(method.headers.get('Allow'), 'POST')
})

test('the common client sends an explicit demo answer and recovers the same receipt', async (t) => {
  const { base, challenge } = await setup(t)
  const api = createApiClient({ fetch: (path, init) => fetch(base + String(path), init), getIdToken: async () => 'owner', expectedDataMode: 'demo' })
  const input = { challengeId: challenge.challengeId, photo: new Blob([png], { type: 'image/png' }), metadata: capture, idempotencyKey: 'client-answer' }
  const first = await api.submitAnswer(input)
  assert.equal(first.state, 'RECEIVED')
  assert.equal(first.source, 'mock')
  assert.deepEqual(await api.submitAnswer(input), first)
  assert.deepEqual(await api.getAttempt(first.attemptId), first)
})

test('chunked body overflow and a stalled upload free the receiver for the next request', { timeout: 10_000 }, async (t) => {
  const { base, path, submit } = await setup(t)
  const raw = (chunks: Buffer[], end: boolean) => new Promise<Response>((resolve, reject) => {
    const url = new URL(base)
    const req = request({ hostname: url.hostname, port: url.port, path, method: 'POST', headers: {
      Authorization: 'Bearer owner', 'Idempotency-Key': 'key', 'Content-Type': 'multipart/form-data; boundary=test',
    } }, (res) => {
      const parts: Buffer[] = []
      res.on('data', (part: Buffer) => parts.push(part))
      res.on('end', () => { resolve(new Response(Buffer.concat(parts), { status: res.statusCode, headers: res.headers as Record<string, string> })); req.destroy() })
      res.on('error', reject)
    })
    req.on('error', reject)
    chunks.forEach((chunk) => req.write(chunk))
    if (end) req.end()
  })
  await expectError(await raw([Buffer.alloc(4 * 1024 * 1024 + 16 * 1024 + 1)], true), 413, 'MEDIA_TOO_LARGE')
  await expectError(await raw([Buffer.from('--test\r\n')], false), 408, 'HTTP_ERROR', true)
  assert.equal((await submit()).status, 202)
})
