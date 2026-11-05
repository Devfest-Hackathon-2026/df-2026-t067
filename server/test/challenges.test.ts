import assert from 'node:assert/strict'
import { test } from 'node:test'
import { request } from 'node:http'
import { createApiClient } from '../../src/shared/api/client'
import { parseChallenge } from '../../src/shared/api/validation'
import { DemoChallengeStore } from '../src/challenges'
import { HttpError } from '../src/errors'
import { expectError, startServer } from './helpers'

const input = { questId: 'demo-quest', expectedVersion: 1 }
const verifier = { verify: async (token: string) => {
  if (token !== 'user-one' && token !== 'user-two') throw new HttpError(401, 'UNAUTHENTICATED', '有効なログインが必要です。')
  return { uid: token }
} }
function start(base: string, body: unknown = input, token = 'user-one') {
  return fetch(base + '/api/v1/challenges', {
    method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
}

test('challenge start verifies identity and generates its ID/version/time on the server', async (t) => {
  const { base } = await startServer(t, { verifier })
  const before = Date.now()
  const response = await start(base)
  assert.equal(response.status, 201)
  assert.equal(response.headers.get('X-Quest-Data-Mode'), 'demo')
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store')
  const challenge = parseChallenge(await response.json())
  assert.match(challenge.challengeId, /^[0-9a-f-]{36}$/)
  assert.equal(challenge.questId, input.questId)
  assert.equal(challenge.version, 1)
  assert(Date.parse(challenge.createdAt) >= before && Date.parse(challenge.createdAt) <= Date.now())
  assert.doesNotMatch(JSON.stringify(challenge), /user-one|orgId|ownerUid/)
})

test('challenge start fails closed without Firebase or a valid bearer token', async (t) => {
  const unavailable = await startServer(t)
  await expectError(await start(unavailable.base), 503, 'AUTH_UNAVAILABLE', true)
  const { base } = await startServer(t, { verifier })
  await expectError(await start(base, input, 'invalid'), 401, 'UNAUTHENTICATED')
  await expectError(await fetch(base + '/api/v1/challenges', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  }), 401, 'UNAUTHENTICATED')
})

test('repeated and concurrent starts reuse one challenge; another user gets a separate one', async (t) => {
  const challenges = new DemoChallengeStore()
  const { base } = await startServer(t, { verifier, challenges })
  const responses = await Promise.all([start(base), start(base)])
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 201])
  const [first, second] = await Promise.all(responses.map(async (response) => parseChallenge(await response.json())))
  assert.deepEqual(first, second)
  const otherResponse = await start(base, input, 'user-two')
  assert.equal(otherResponse.status, 201)
  const other = parseChallenge(await otherResponse.json())
  assert.notEqual(other.challengeId, first.challengeId)
  assert.deepEqual(challenges.getOwned(first.challengeId, 'user-one'), first)
  assert.equal(challenges.getOwned(first.challengeId, 'user-two'), null)
  assert.equal(challenges.getOwned('missing-challenge', 'user-one'), null)
  const copy = challenges.getOwned(first.challengeId, 'user-one')!
  copy.version = 999
  assert.equal(challenges.getOwned(first.challengeId, 'user-one')!.version, 1)
})

test('the existing client uses a fresh token and decodes both newly-created and reused starts', async (t) => {
  const { base } = await startServer(t, { verifier })
  let tokenReads = 0
  const client = createApiClient({
    fetch: (path, init) => fetch(base + String(path), init), expectedDataMode: 'demo',
    getIdToken: async () => { tokenReads++; return 'user-one' },
  })
  const first = await client.createChallenge(input)
  assert.deepEqual(await client.createChallenge(input), first)
  assert.equal(tokenReads, 2)
})

test('body data survives asynchronous token verification', async (t) => {
  const { base } = await startServer(t, { verifier: { verify: async () => {
    await new Promise<void>((resolve) => setImmediate(resolve))
    return { uid: 'verified-after-body-arrival' }
  } } })
  assert.equal((await start(base)).status, 201)
})

test('unknown/non-public quests and wrong published versions cannot start', async (t) => {
  const { base } = await startServer(t, { verifier })
  await expectError(await start(base, { questId: 'not-public', expectedVersion: 1 }), 404, 'NOT_FOUND')
  await expectError(await start(base, { questId: 'demo-quest', expectedVersion: 2 }), 409, 'QUEST_CHANGED')
  const response = await fetch(base + '/api/v1/challenges?uid=another-user', {
    method: 'POST', headers: { Authorization: 'Bearer user-one', 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  })
  await expectError(response, 400, 'INVALID_INPUT')
})

test('only the selected quest and a positive integer version are accepted', async (t) => {
  const { base } = await startServer(t, { verifier })
  for (const body of [
    null, [], {}, { questId: 'demo-quest' }, { ...input, expectedVersion: '1' }, { ...input, expectedVersion: 0 },
    { ...input, expectedVersion: -1 }, { ...input, expectedVersion: 1.5 }, { ...input, expectedVersion: null },
    { ...input, expectedVersion: 9_007_199_254_740_992 }, { ...input, questId: '' }, { ...input, questId: '../secret' },
    { ...input, questId: 'x'.repeat(129) }, { ...input, uid: 'forged-owner' }, { ...input, orgId: 'forged-org' },
    { ...input, role: 'admin' }, { ...input, createdAt: '2000-01-01T00:00:00Z' }, { ...input, challengeId: 'chosen-by-client' },
    { ...input, isCorrect: true },
  ]) {
    await expectError(await start(base, body), 400, 'INVALID_INPUT')
  }
  assert.equal((await start(base)).status, 201)
})

test('JSON media types, compression, encoding and payload size are checked', async (t) => {
  const { base } = await startServer(t, { verifier })
  const post = (body: BodyInit, headers: Record<string, string> = {}) => fetch(base + '/api/v1/challenges', {
    method: 'POST', body, headers: { Authorization: 'Bearer user-one', ...headers },
  })
  await expectError(await post(JSON.stringify(input), { 'Content-Type': 'text/plain' }), 415, 'HTTP_ERROR')
  await expectError(await post(JSON.stringify(input), { 'Content-Type': 'application/json; charset=iso-8859-1' }), 415, 'HTTP_ERROR')
  await expectError(await post(JSON.stringify(input), { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' }), 415, 'HTTP_ERROR')
  for (const body of ['', '{invalid', '\uFEFF{}']) await expectError(await post(body, { 'Content-Type': 'application/json' }), 400, 'INVALID_INPUT')
  await expectError(await post(Buffer.from([0xff, 0xfe]), { 'Content-Type': 'application/json' }), 400, 'INVALID_INPUT')
  await expectError(await post(' '.repeat(5000), { 'Content-Type': 'application/json' }), 413, 'MEDIA_TOO_LARGE')
  const chunked = await rawPost(base, ['Content-Type', 'application/json'], [' '.repeat(2500), ' '.repeat(2500)])
  await expectError(chunked, 413, 'MEDIA_TOO_LARGE')
  const duplicate = await rawPost(base, ['Content-Type', 'application/json', 'Content-Type', 'text/plain'], [JSON.stringify(input)])
  await expectError(duplicate, 400, 'INVALID_INPUT')
  const valid = await post(JSON.stringify(input), { 'Content-Type': 'application/json; charset="UTF-8"' })
  assert.equal(valid.status, 201)
})

test('a stalled request body expires and does not prevent subsequent reads', { timeout: 10_000 }, async (t) => {
  const { base } = await startServer(t, { verifier })
  const response = await rawPost(base, ['Content-Type', 'application/json'], ['{'], false)
  await expectError(response, 408, 'HTTP_ERROR', true)
  assert.equal((await fetch(base + '/health')).status, 200)
})

test('aborting a body does not crash the server or retain the body deadline', async (t) => {
  let notify!: () => void
  const authenticated = new Promise<void>((resolve) => { notify = resolve })
  const { base } = await startServer(t, { verifier: { verify: async () => { notify(); return { uid: 'user-one' } } } })
  const url = new URL(base)
  const req = request({ hostname: url.hostname, port: url.port, method: 'POST', path: '/api/v1/challenges',
    headers: { Authorization: 'Bearer user-one', 'Content-Type': 'application/json' } })
  req.on('error', () => {})
  req.write('{')
  await authenticated
  await new Promise<void>((resolve) => setImmediate(resolve))
  req.destroy()
  assert.equal((await fetch(base + '/health')).status, 200)
})

test('per-user start limits include retries and return Retry-After without blocking other users', async (t) => {
  let now = Date.parse('2026-11-05T00:00:00Z')
  const challenges = new DemoChallengeStore({ requestsPerMinute: 2, now: () => now })
  const { base } = await startServer(t, { verifier, challenges })
  const first = parseChallenge(await (await start(base)).json())
  assert.equal(first.createdAt, '2026-11-05T00:00:00.000Z')
  assert.equal((await start(base)).status, 200)
  const limited = await start(base)
  assert.equal(limited.headers.get('Retry-After'), '60')
  await expectError(limited, 429, 'RATE_LIMITED', true)
  assert.equal((await start(base, input, 'user-two')).status, 201)
  now += 60_001
  const recovered = await start(base)
  assert.equal(recovered.status, 200)
  assert.deepEqual(parseChallenge(await recovered.json()), first)
})

test('bounded memory still permits retries of an existing challenge', async (t) => {
  const challenges = new DemoChallengeStore({ capacity: 2 })
  const { base } = await startServer(t, { verifier, challenges })
  const first = parseChallenge(await (await start(base)).json())
  assert.equal((await start(base, { questId: 'demo-quest-b', expectedVersion: 1 })).status, 201)
  await expectError(await start(base, { questId: 'demo-quest-c', expectedVersion: 1 }), 503, 'SYSTEM_ERROR')
  const repeated = await start(base)
  assert.equal(repeated.status, 200)
  assert.deepEqual(parseChallenge(await repeated.json()), first)
  await expectError(await start(base, input, 'user-two'), 503, 'SYSTEM_ERROR')
})

test('capacity rejections do not fill rate windows and block an existing owner', async (t) => {
  let now = Date.parse('2026-11-05T00:00:00Z')
  const challenges = new DemoChallengeStore({ capacity: 2, now: () => now })
  const { base } = await startServer(t, { challenges, verifier: { verify: async (token) => ({ uid: token }) } })
  const first = parseChallenge(await (await start(base)).json())
  assert.equal((await start(base, { questId: 'demo-quest-b', expectedVersion: 1 })).status, 201)
  now += 60_001
  for (const uid of ['user-two', 'user-three', 'user-four']) await expectError(await start(base, input, uid), 503, 'SYSTEM_ERROR')
  const repeated = await start(base)
  assert.equal(repeated.status, 200)
  assert.deepEqual(parseChallenge(await repeated.json()), first)
})

test('restart creates a fresh isolated temporary store and GET remains unimplemented', async (t) => {
  const first = await startServer(t, { verifier })
  const original = parseChallenge(await (await start(first.base)).json())
  const second = await startServer(t, { verifier })
  assert.notEqual(parseChallenge(await (await start(second.base)).json()).challengeId, original.challengeId)
  const get = await fetch(second.base + '/api/v1/challenges')
  assert.equal(get.headers.get('Allow'), 'POST')
  await expectError(get, 405, 'HTTP_ERROR')
  await expectError(await fetch(second.base + '/api/v1/challenges/' + original.challengeId), 404, 'NOT_FOUND')
})

function rawPost(base: string, headers: string[], chunks: string[], end = true): Promise<Response> {
  return new Promise((resolve, reject) => {
    const url = new URL(base)
    const req = request({ hostname: url.hostname, port: url.port, path: '/api/v1/challenges', method: 'POST',
      headers: ['Host', url.host, 'Authorization', 'Bearer user-one', ...headers] }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('error', reject)
      res.on('end', () => {
        resolve(new Response(Buffer.concat(chunks), { status: res.statusCode, headers: res.headers as Record<string, string> }))
        req.destroy()
      })
    })
    req.on('error', reject)
    chunks.forEach((chunk) => req.write(chunk))
    if (end) req.end()
  })
}
