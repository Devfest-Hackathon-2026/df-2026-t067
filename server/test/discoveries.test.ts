import assert from 'node:assert/strict'
import test from 'node:test'
import { createApiClient } from '../../src/shared/api/client'
import { DemoDiscoveryStore } from '../src/discoveries'
import { expectError, rawGet, startServer } from './helpers'

// Synthetic 2x2 JPEG generated locally. No destination, camera or personal data.
const photo = Buffer.from('/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAACAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABAb/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCaACQz/9k=', 'base64')
const input = { placeId: 'demo-place', questId: 'demo-quest', questVersion: 1, areaId: 'demo-area',
  placeName: '架空の対象', descriptionSnapshot: '架空の紹介', revealedLocation: { latitude: 0, longitude: 0 }, photo }
const evidence = { location: 'WITHIN_AREA' as const, photo: 'MATCH' as const }
const verifier = { verify: async (token: string) => ({ uid: token }) }
const headers = { Authorization: 'Bearer owner' }
const listPath = '/api/v1/me/discoveries'

test('owner API lists stored first clears and serves a photo only through an authenticated request', async (t) => {
  const store = new DemoDiscoveryStore({ now: () => Date.parse('2026-11-05T07:00:00Z') })
  const saved = await store.saveFirstClear('owner', input, evidence)
  await store.saveFirstClear('other', { ...input, placeId: 'other-place' }, evidence)
  const { base } = await startServer(t, { verifier, discoveries: store })
  const api = createApiClient({ expectedDataMode: 'demo', getIdToken: async () => 'owner',
    fetch: (url, init) => fetch(base + String(url), init) })
  assert.equal(saved.created, true)
  assert.equal(saved.source, 'mock')
  assert.equal(saved.discovery.firstClearedAt, '2026-11-05T07:00:00.000Z')
  assert.deepEqual(await api.listDiscoveries(), { items: [saved.discovery], nextCursor: null })
  assert.deepEqual(await api.getDiscovery(saved.discovery.discoveryId), saved.discovery)
  assert.equal(saved.discovery.ownerPhoto, listPath + '/' + saved.discovery.discoveryId + '/photo')
  const result = await api.getDiscoveryPhoto(saved.discovery.discoveryId)
  assert.equal(result.type, 'image/jpeg')
  assert.deepEqual(Buffer.from(await result.arrayBuffer()), photo)
  const response = await fetch(base + saved.discovery.ownerPhoto, { headers })
  assert.equal(response.headers.get('X-Quest-Records-Mode'), 'memory')
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store')
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff')
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), null)
  await response.arrayBuffer()
  await expectError(await fetch(base + saved.discovery.ownerPhoto), 401, 'UNAUTHENTICATED')
  const publicList = await (await fetch(base + '/api/v1/quests')).text()
  assert(!publicList.includes(saved.discovery.discoveryId))
})

test('unconfigured records fail closed while explicit empty storage stays distinct', async (t) => {
  const disabled = await startServer(t, { verifier })
  await expectError(await fetch(disabled.base + listPath), 401, 'UNAUTHENTICATED')
  await expectError(await fetch(disabled.base + listPath, { headers }), 503, 'SYSTEM_ERROR', true)
  const enabled = await startServer(t, { verifier, discoveries: new DemoDiscoveryStore() })
  const response = await fetch(enabled.base + listPath, { headers })
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { items: [], nextCursor: null })
  const noAuth = await startServer(t, { discoveries: new DemoDiscoveryStore() })
  await expectError(await fetch(noAuth.base + listPath, { headers }), 503, 'AUTH_UNAVAILABLE', true)
})

test('startup fixture is confined to its owner and stays deleted until restart', async (t) => {
  const { base } = await startServer(t, { verifier, discoveries: await DemoDiscoveryStore.withFixture('owner') })
  const client = (uid: string) => createApiClient({ expectedDataMode: 'demo', getIdToken: async () => uid,
    fetch: (url, init) => fetch(base + String(url), init) })
  const owner = client('owner')
  const other = client('other')
  const { items } = await owner.listDiscoveries({ areaId: 'demo-area' })
  assert.equal(items.length, 1)
  const [record] = items
  assert.equal(record.placeName, '架空のデモ記録')
  assert.deepEqual(await owner.getDiscovery(record.discoveryId), record)
  assert.equal((await owner.getDiscoveryPhoto(record.discoveryId)).type, 'image/jpeg')
  assert.deepEqual((await other.listDiscoveries()).items, [])
  await assert.rejects(other.getDiscovery(record.discoveryId), { code: 'NOT_FOUND' })
  await assert.rejects(other.getDiscoveryPhoto(record.discoveryId), { code: 'NOT_FOUND' })
  await assert.rejects(other.deleteDiscovery(record.discoveryId), { code: 'NOT_FOUND' })
  const deletion = await owner.deleteDiscovery(record.discoveryId)
  assert.equal((await owner.getDeletion(deletion.deletionId)).state, 'completed')
  assert.deepEqual((await owner.listDiscoveries()).items, [])
  await assert.rejects(owner.getDiscoveryPhoto(record.discoveryId), { code: 'NOT_FOUND' })
})

test('an owner can read a saved snapshot even when its original quest is no longer public', async (t) => {
  const store = new DemoDiscoveryStore()
  const saved = await store.saveFirstClear('owner', { ...input, questId: 'retired-quest', questVersion: 7 }, evidence)
  const { base } = await startServer(t, { verifier, discoveries: store })
  await expectError(await fetch(base + '/api/v1/quests/retired-quest'), 404, 'NOT_FOUND')
  const response = await fetch(base + listPath + '/' + saved.discovery.discoveryId, { headers })
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), saved.discovery)
  assert.equal((await fetch(base + saved.discovery.ownerPhoto, { headers })).status, 200)
})

test('other users, municipality roles and forged uid values cannot read or delete private records', async (t) => {
  const store = new DemoDiscoveryStore()
  const saved = await store.saveFirstClear('owner', input, evidence)
  const { base } = await startServer(t, { verifier, discoveries: store,
    memberships: async () => [{ orgId: 'demo-org', label: '架空', role: 'publisher', areaId: 'demo-area' }] })
  const detail = listPath + '/' + saved.discovery.discoveryId
  for (const path of [detail, detail + '/photo']) {
    await expectError(await fetch(base + path, { headers: { Authorization: 'Bearer other' } }), 404, 'NOT_FOUND')
  }
  await expectError(await fetch(base + detail, { method: 'DELETE', headers: { Authorization: 'Bearer other' } }), 404, 'NOT_FOUND')
  await expectError(await fetch(base + listPath + '?uid=owner', { headers: { Authorization: 'Bearer other' } }), 400, 'INVALID_INPUT')
  const page = await (await fetch(base + listPath, { headers: { Authorization: 'Bearer other' } })).json()
  assert.deepEqual(page, { items: [], nextCursor: null })
  assert.equal((await fetch(base + detail, { headers })).status, 200)
})

test('first clears remain unique under concurrent retries and never overwrite the initial photo or date', async () => {
  let now = Date.parse('2026-11-05T07:00:00Z')
  const store = new DemoDiscoveryStore({ now: () => now })
  const saved = await store.saveFirstClear('owner', input, evidence)
  now += 60000
  const retries = await Promise.all(Array.from({ length: 3 }, () => store.saveFirstClear('owner', {
    ...input, questVersion: 2, placeName: '変えない', photo: Buffer.concat([photo, Buffer.from([1])]),
  }, evidence)))
  for (const result of retries) {
    assert.equal(result.created, false)
    assert.deepEqual(result.discovery, saved.discovery)
  }
  assert.deepEqual((await store.getPhotoOwned('owner', saved.discovery.discoveryId))?.bytes, photo)
  saved.discovery.placeName = 'outside mutation'
  assert.equal((await store.getOwned('owner', saved.discovery.discoveryId))?.placeName, '架空の対象')
  const another = await store.saveFirstClear('other', input, evidence)
  assert.notEqual(another.discovery.discoveryId, saved.discovery.discoveryId)
  await assert.rejects(store.saveFirstClear('owner', { ...input, placeId: 'new-place' }, { location: 'OUTSIDE_AREA', photo: 'MATCH' }), /保存/)
  assert.deepEqual((await new DemoDiscoveryStore().listOwned('owner', {})).items, [])
})

test('deletion is owner-only, idempotent and removes the record and photo before reporting completed', async (t) => {
  const store = new DemoDiscoveryStore()
  const saved = await store.saveFirstClear('owner', input, evidence)
  const { base } = await startServer(t, { verifier, discoveries: store })
  const api = createApiClient({ expectedDataMode: 'demo', getIdToken: async () => 'owner', fetch: (url, init) => fetch(base + String(url), init) })
  const first = await api.deleteDiscovery(saved.discovery.discoveryId)
  const repeated = await api.deleteDiscovery(saved.discovery.discoveryId)
  assert.deepEqual(repeated, first)
  assert.deepEqual(await api.getDeletion(first.deletionId), { deletionId: first.deletionId, state: 'completed', retryable: false })
  const response = await fetch(base + '/api/v1/me/deletions/' + first.deletionId, { headers: { Authorization: 'Bearer other' } })
  await expectError(response, 404, 'NOT_FOUND')
  await expectError(await fetch(base + saved.discovery.ownerPhoto, { headers }), 404, 'NOT_FOUND')
  await expectError(await fetch(base + listPath + '/' + saved.discovery.discoveryId, { headers }), 404, 'NOT_FOUND')
  assert.deepEqual(await api.listDiscoveries(), { items: [], nextCursor: null })
  await expectError(await fetch(base + listPath + '/missing', { method: 'DELETE', headers }), 404, 'NOT_FOUND')
})

test('record pagination is scoped to owner and area and query values are validated', async (t) => {
  let now = Date.parse('2026-11-05T07:00:00Z')
  const store = new DemoDiscoveryStore({ now: () => now })
  const first = await store.saveFirstClear('owner', input, evidence)
  now += 1000
  await store.saveFirstClear('owner', { ...input, placeId: 'place-b', areaId: 'demo-area-b' }, evidence)
  const { base } = await startServer(t, { verifier, discoveries: store })
  const page = await (await fetch(base + listPath + '?limit=1', { headers })).json() as { items: { placeId: string }[]; nextCursor: string }
  assert(page.nextCursor)
  assert.equal(page.items[0].placeId, 'place-b')
  const second = await (await fetch(base + listPath + '?limit=1&cursor=' + page.nextCursor, { headers })).json() as { items: { placeId: string }[]; nextCursor: null }
  assert.equal(second.items[0].placeId, 'demo-place')
  assert.equal(second.nextCursor, null)
  const filtered = await (await fetch(base + listPath + '?areaId=demo-area', { headers })).json()
  assert.deepEqual(filtered, { items: [first.discovery], nextCursor: null })
  await expectError(await fetch(base + listPath + '?cursor=' + page.nextCursor, { headers: { Authorization: 'Bearer other' } }), 400, 'INVALID_INPUT')
  await expectError(await fetch(base + listPath + '?areaId=demo-area&cursor=' + page.nextCursor, { headers }), 400, 'INVALID_INPUT')
  for (const query of ['?limit=0', '?limit=101', '?limit=1&limit=2', '?areaId=', '?areaId=a%2Fb', '?orgId=demo-org']) {
    await expectError(await fetch(base + listPath + query, { headers }), 400, 'INVALID_INPUT')
  }
})

test('storage failures never masquerade as an empty list or completed deletion and expose no internal paths', async (t) => {
  const store = new DemoDiscoveryStore()
  const saved = await store.saveFirstClear('owner', input, evidence)
  const repository = {
    storageMode: 'memory' as const,
    listOwned: async () => { throw new Error('private-storage-path') },
    getOwned: store.getOwned.bind(store), getPhotoOwned: store.getPhotoOwned.bind(store),
    deleteOwned: async () => { throw new Error('private-storage-path') },
    getDeletionOwned: store.getDeletionOwned.bind(store),
  }
  const { base } = await startServer(t, { verifier, discoveries: repository })
  for (const [path, method] of [[listPath, 'GET'], [listPath + '/' + saved.discovery.discoveryId, 'DELETE']]) {
    const failure = await expectError(await fetch(base + path, { headers, method }), 503, 'SYSTEM_ERROR', true)
    assert(!JSON.stringify(failure).includes('private-storage-path'))
  }
  assert(await store.getOwned('owner', saved.discovery.discoveryId))
  assert(await store.getPhotoOwned('owner', saved.discovery.discoveryId))
})

test('capacity, photo copies and invalid clocks cannot corrupt a previously saved first clear', async () => {
  const store = new DemoDiscoveryStore({ capacity: 1, maximumBytes: photo.byteLength })
  const bytes = Buffer.from(photo)
  const saved = await store.saveFirstClear('owner', { ...input, photo: bytes }, evidence)
  bytes[3] = 0
  const copy = await store.getPhotoOwned('owner', saved.discovery.discoveryId)
  assert(copy)
  copy.bytes[3] = 0
  assert.deepEqual((await store.getPhotoOwned('owner', saved.discovery.discoveryId))?.bytes, photo)
  assert.equal((await store.saveFirstClear('owner', input, evidence)).created, false)
  await assert.rejects(store.saveFirstClear('other', input, evidence), { code: 'RATE_LIMITED' })
  await store.deleteOwned('owner', saved.discovery.discoveryId)
  const another = await store.saveFirstClear('other', input, evidence)
  await assert.rejects(store.deleteOwned('other', another.discovery.discoveryId), { code: 'RATE_LIMITED' })
  assert(await store.getOwned('other', another.discovery.discoveryId))
  for (const now of [NaN, Infinity, 1e20]) {
    await assert.rejects(new DemoDiscoveryStore({ now: () => now }).saveFirstClear('owner', input, evidence), { code: 'SYSTEM_ERROR' })
  }
})

test('records expose no HTTP create/update operation and reject bad paths and methods', async (t) => {
  const { base } = await startServer(t, { verifier, discoveries: new DemoDiscoveryStore() })
  for (const path of [listPath, listPath + '/missing', listPath + '/missing/photo', '/api/v1/me/deletions/missing']) {
    const response = await fetch(base + path, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{"isCorrect":true}' })
    await expectError(response, 405, 'HTTP_ERROR')
  }
  assert.equal((await rawGet(base, listPath + '/a%2Fb', ['Authorization', 'Bearer owner'])).status, 400)
  await expectError(await fetch(base + listPath + '/missing/photo?uid=owner', { headers }), 400, 'INVALID_INPUT')
})
