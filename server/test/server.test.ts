import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createApiClient } from '../../src/shared/api/client'
import { parsePage, parsePublicArea, parsePublicQuest } from '../../src/shared/api/validation'
import { createServer } from '../src/server'
import { HttpError } from '../src/errors'
import { expectError, rawGet, startServer } from './helpers'

test('anonymous public reads expose existing Page/PublicArea/PublicQuest contracts', async (t) => {
  const { base } = await startServer(t)
  const areasResponse = await fetch(base + '/api/v1/areas')
  assert.equal(areasResponse.status, 200)
  const areas = parsePage(await areasResponse.json(), parsePublicArea)
  assert(areas.items.length > 1)
  const questsResponse = await fetch(base + '/api/v1/quests')
  assert.equal(questsResponse.status, 200)
  const quests = parsePage(await questsResponse.json(), parsePublicQuest)
  assert(quests.items.length > 1)
  const detail = await fetch(base + '/api/v1/quests/' + quests.items[0]!.questId)
  assert.equal(detail.status, 200)
  assert.deepEqual(parsePublicQuest(await detail.json()), quests.items[0])
})

test('existing API client reads and paginates without requesting an ID token', async (t) => {
  const { base } = await startServer(t)
  const client = createApiClient({
    fetch: (input, init) => fetch(base + String(input), init),
    getIdToken: async () => { throw new Error('Public reads must stay anonymous') },
  })
  const first = await client.listQuests({ areaId: 'demo-area', limit: 1 })
  assert.equal(first.items.length, 1)
  assert(first.nextCursor)
  const second = await client.listQuests({ areaId: 'demo-area', cursor: first.nextCursor, limit: 1 })
  assert.equal(second.items.length, 1)
  assert.equal(second.nextCursor, null)
  assert.notEqual(first.items[0].questId, second.items[0].questId)
  assert.deepEqual(await client.getQuest(first.items[0].questId), first.items[0])
})

test('areas filter by public polygon extent, including edge overlap and wrapping bbox', async (t) => {
  const { base } = await startServer(t)
  for (const [bbox, expected] of [
    ['-1,-1,1.1,2', ['demo-area']],
    ['2.9,0.9,3.1,1.1', ['demo-area-b']],
    ['10,10,11,11', []],
    ['170,-10,-170,10', []],
    ['-180,-90,180,90', ['demo-area', 'demo-area-b']],
  ] as const) {
    const response = await fetch(base + '/api/v1/areas?bbox=' + bbox + '&zoom=3.5')
    assert.equal(response.status, 200)
    const page = parsePage(await response.json(), parsePublicArea)
    assert.deepEqual(page.items.map((area) => area.areaId), expected)
  }
  const first = parsePage(await (await fetch(base + '/api/v1/areas?limit=1')).json(), parsePublicArea)
  assert(first.nextCursor)
  const second = parsePage(await (await fetch(base + '/api/v1/areas?limit=1&cursor=' + first.nextCursor)).json(), parsePublicArea)
  assert.equal(second.items[0].areaId, 'demo-area-b')
  assert.equal(second.nextCursor, null)
  const empty = await fetch(base + '/api/v1/quests?areaId=unknown-area')
  assert.deepEqual(await empty.json(), { items: [], nextCursor: null })
})

test('responses expose only allowlisted public fields and explicitly label demo data', async (t) => {
  const { base } = await startServer(t)
  const health = await fetch(base + '/health')
  assert.deepEqual(await health.json(), { status: 'ok', dataMode: 'demo', fictionalData: true, auth: 'unconfigured' })
  for (const path of ['/api/v1/areas', '/api/v1/quests']) {
    const response = await fetch(base + path, { headers: { Origin: 'https://untrusted.example' } })
    assert.equal(response.headers.get('X-Quest-Data-Mode'), 'demo')
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), null)
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store')
    const page = await response.json() as { items: Record<string, unknown>[] }
    const keys = path.endsWith('areas')
      ? ['areaId', 'label', 'marker', 'publicGeometry', 'publishedCount']
      : ['areaId', 'clue', 'hintCount', 'questId', 'title', 'version', 'visitConditions']
    for (const item of page.items) {
      assert.deepEqual(Object.keys(item).sort(), keys)
      assert.doesNotMatch(String(item.label ?? item.title), /架空|デモ/)
    }
  }
})

test('malformed list values, duplicated/unknown parameters and coordinates are rejected', async (t) => {
  const { base } = await startServer(t)
  const queries = [
    'bbox=0,0,1', 'bbox=0,0,1,1,2', 'bbox=NaN,0,1,1', 'bbox=0,0,Infinity,1',
    'bbox=-181,0,1,1', 'bbox=0,-91,1,1', 'bbox=0,0,181,1', 'bbox=0,0,1,91',
    'bbox=0,2,1,1', 'bbox=,0,1,1', 'bbox=0,0,,1', 'bbox=0x1,0,1,1',
    'zoom=-1', 'zoom=25', 'zoom=NaN', 'zoom=Infinity', 'zoom=', 'zoom=1&zoom=2',
    'limit=0', 'limit=-1', 'limit=101', 'limit=1.5', 'limit=1e2', 'limit=', 'limit=1&limit=2',
    'areaId=demo-area', 'uid=untrusted', 'cursor=', 'cursor=%25',
  ]
  for (const query of queries) {
    await t.test(query, async () => {
      await expectError(await fetch(base + '/api/v1/areas?' + query), 400, 'INVALID_INPUT')
    })
  }
  for (const query of ['areaId=', 'areaId=..', 'areaId=a%2Fb', 'areaId=a%5Cb', 'areaId=a%00',
    'areaId=' + 'a'.repeat(129), 'areaId=a&areaId=b', 'bbox=0,0,1,1', 'limit=1000']) {
    await expectError(await fetch(base + '/api/v1/quests?' + query), 400, 'INVALID_INPUT')
  }
})

test('cursors cannot cross list/filter scopes or refer to unknown rows', async (t) => {
  const { base } = await startServer(t)
  const first = await (await fetch(base + '/api/v1/quests?limit=1')).json() as { nextCursor: string }
  for (const path of ['/api/v1/areas?', '/api/v1/quests?areaId=demo-area&']) {
    await expectError(await fetch(base + path + 'cursor=' + first.nextCursor), 400, 'INVALID_INPUT')
  }
  const badCursors = ['null', '{}', '[]', '{"v":1,"scope":"quests:","after":"absent"}',
    '{"v":1,"scope":"quests:","after":"demo-quest","uid":"client"}']
  for (const json of badCursors) {
    const cursor = Buffer.from(json).toString('base64url')
    await expectError(await fetch(base + '/api/v1/quests?cursor=' + cursor), 400, 'INVALID_INPUT')
  }
})

test('malformed IDs and encodings are 400; missing resources are 404', async (t) => {
  const { base } = await startServer(t)
  for (const id of ['', '%2e', '%2e%2e', 'a%2Fb', 'a%5Cb', 'a%00', '%FF', '%', 'a'.repeat(129)]) {
    const response = await rawGet(base, '/api/v1/quests/' + id)
    assert.equal(response.status, 400, id)
  }
  await expectError(await fetch(base + '/api/v1/quests/unknown-quest'), 404, 'NOT_FOUND')
  await expectError(await fetch(base + '/api/v1/absent'), 404, 'NOT_FOUND')
  await expectError(await fetch(base + '/api/v1/quests/demo-quest?answer=1'), 400, 'INVALID_INPUT')
})

test('read-only routes reject unsupported methods without permissive CORS', async (t) => {
  const { base } = await startServer(t)
  for (const path of ['/health', '/api/v1/areas', '/api/v1/quests', '/api/v1/quests/demo-quest', '/api/v1/session']) {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
      const response = await fetch(base + path, { method })
      assert.equal(response.headers.get('Allow'), 'GET')
      assert.equal(response.headers.get('Access-Control-Allow-Origin'), null)
      await expectError(response, 405, 'HTTP_ERROR')
    }
  }
})

test('session is unavailable without configuration while public reads still work', async (t) => {
  const { base } = await startServer(t)
  await expectError(await fetch(base + '/api/v1/session'), 503, 'AUTH_UNAVAILABLE', true)
  await expectError(await fetch(base + '/api/v1/session', { headers: { Authorization: 'Bearer untrusted' } }), 503, 'AUTH_UNAVAILABLE', true)
  assert.equal((await fetch(base + '/api/v1/quests')).status, 200)
})

test('session rejects missing/malformed credentials before invoking Firebase', async (t) => {
  let calls = 0
  const { base } = await startServer(t, { verifier: { verify: async () => { calls++; return { uid: 'verified-user' } } } })
  for (const authorization of [undefined, '', 'Basic untrusted', 'Bearer', 'Bearer a b', 'Bearer a,b', 'Bearer token=']) {
    const response = await fetch(base + '/api/v1/session?uid=client-uid', {
      headers: authorization === undefined ? {} : { Authorization: authorization },
    })
    assert.equal(response.headers.get('WWW-Authenticate'), 'Bearer')
    await expectError(response, 401, 'UNAUTHENTICATED')
  }
  const duplicate = await rawGet(base, '/api/v1/session', ['Authorization', 'Bearer one', 'Authorization', 'Bearer two'])
  assert.equal(duplicate.status, 401)
  assert.equal(calls, 0)
})

test('verified uid takes precedence over query/body identity and only uid is returned', async (t) => {
  const tokens: string[] = []
  const { base } = await startServer(t, { verifier: { verify: async (token) => {
    tokens.push(token)
    return { uid: 'verified-user', role: 'admin', orgId: 'internal-org', email: 'private@example.invalid' }
  } } })
  const response = await rawGet(base, '/api/v1/session?uid=client-uid&role=owner&orgId=other',
    ['Authorization', 'Bearer boundary-test-input', 'Content-Type', 'application/json'],
    JSON.stringify({ uid: 'body-uid', role: 'admin', orgId: 'body-org' }))
  assert.equal(response.status, 200)
  assert.deepEqual(response.body, { uid: 'verified-user' })
  assert.deepEqual(tokens, ['boundary-test-input'])
  const health = await (await fetch(base + '/health')).json()
  assert.deepEqual(health, { status: 'ok', dataMode: 'demo', fictionalData: true, auth: 'configured' })
})

test('invalid credentials and Firebase outages stay errors without leaking token or SDK details', async (t) => {
  const { base } = await startServer(t, { verifier: { verify: async (token) => {
    if (token === 'invalid') throw new HttpError(401, 'UNAUTHENTICATED', '有効なログインが必要です。')
    throw new Error('internal project path; secret token=' + token)
  } } })
  await expectError(await fetch(base + '/api/v1/session', { headers: { Authorization: 'Bearer invalid' } }), 401, 'UNAUTHENTICATED')
  const failure = await expectError(await fetch(base + '/api/v1/session', { headers: { Authorization: 'Bearer sdk-outage' } }), 500, 'SYSTEM_ERROR', true)
  assert.doesNotMatch(JSON.stringify(failure), /internal|secret|sdk-outage/)
})

test('factory requires explicit demo mode and refuses production', () => {
  assert.throws(() => createServer({ mode: 'real' as 'demo' }), /explicitly selected/)
  assert.throws(() => createServer({ mode: undefined as unknown as 'demo' }), /explicitly selected/)
  assert.throws(() => createServer({ mode: 'demo', nodeEnv: 'production' }), /production/)
  assert.throws(() => createServer({ mode: 'demo', nodeEnv: 'staging' }), /development\/test/)
})
