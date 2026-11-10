import assert from 'node:assert/strict'
import { test } from 'node:test'
import { HttpError, unauthenticated } from '../src/errors'
import { createQuestHttpServer, requestTarget } from '../src/http-server'
import { createSpotAddressHandler } from '../src/spot-address-http'
import { listenServer } from './helpers'

test('admin address lookup authenticates, isolates organizations, bounds requests and rechecks revoked membership', async (t) => {
  let calls = 0
  let revoked = false
  const handler = createSpotAddressHandler({
    authenticate: async (request) => {
      if (request.headers.authorization !== 'Bearer fixture') throw unauthenticated()
      return 'admin-a'
    },
    assertMember: async (uid, orgId) => {
      if (uid !== 'admin-a' || orgId !== 'org-a' || revoked) throw new HttpError(403, 'FORBIDDEN', '所属していません。')
    },
    lookup: async () => {
      if (++calls === 2) revoked = true
      return { status: 'candidate', source: 'nearby', address: '合成候補住所' }
    },
  })
  const { base } = await listenServer(t, createQuestHttpServer('durable-local', async (request, response) => {
    const { path, params } = requestTarget(request)
    if (!await handler(request, response, path, params)) throw new HttpError(404, 'NOT_FOUND', '見つかりません。')
  }))
  const position = { latitude: 35, longitude: 139 }
  const send = (org: string, body: unknown, authorized = true) => fetch(base + '/api/v1/orgs/' + org + '/spot-address', {
    method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json',
      ...(authorized ? { Authorization: 'Bearer fixture' } : {}) },
  })
  assert.equal((await send('org-a', { position }, false)).status, 401)
  assert.equal((await send('org-b', { position })).status, 403)
  assert.equal((await send('org-a', { position, orgId: 'org-b' })).status, 400)
  assert.equal((await send('org-a', { url: 'http://localhost' })).status, 400)
  assert.equal((await send('org-a', { position: { latitude: 91, longitude: 139 } })).status, 400)
  assert.equal(calls, 0)
  const result = await send('org-a', { position })
  assert.equal(result.status, 200)
  assert.equal(result.headers.get('Cache-Control'), 'private, no-store')
  assert.deepEqual(await result.json(), { orgId: 'org-a', status: 'candidate', source: 'nearby', address: '合成候補住所' })
  const denied = await send('org-a', { position })
  assert.equal(denied.status, 403)
  assert.equal('address' in await denied.json(), false)
  assert.equal(calls, 2)
})

test('missing credentials leave address lookup unavailable and enabled lookup is limited per user', async (t) => {
  const options = { authenticate: async () => 'admin-a', assertMember: async () => {}, now: () => 90_000 }
  const disabled = createSpotAddressHandler(options)
  let calls = 0
  const enabled = createSpotAddressHandler({ ...options, lookup: async () => { calls++; return { status: 'no-result' } } })
  const { base } = await listenServer(t, createQuestHttpServer('durable-local', async (request, response) => {
    const { path, params } = requestTarget(request)
    await (path.includes('/org-disabled/') ? disabled : enabled)(request, response, path, params)
  }))
  const send = (org: string) => fetch(base + '/api/v1/orgs/' + org + '/spot-address', {
    method: 'POST', body: JSON.stringify({ googlePlaceId: 'ChIJ_test' }), headers: { 'Content-Type': 'application/json' },
  })
  assert.deepEqual(await (await send('org-disabled')).json(), { orgId: 'org-disabled', status: 'unavailable' })
  for (let index = 0; index < 6; index++) assert.equal((await send('org-a')).status, 200)
  const blocked = await send('org-a')
  assert.equal(blocked.status, 429)
  assert.equal(blocked.headers.get('Retry-After'), '30')
  assert.equal(calls, 6)
})
