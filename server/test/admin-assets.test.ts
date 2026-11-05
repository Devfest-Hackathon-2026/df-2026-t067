import assert from 'node:assert/strict'
import test from 'node:test'
import sharp from 'sharp'
import { createApiClient } from '../../src/shared/api/client'
import { DemoAssetStore } from '../src/admin-assets'
import { preparePhoto } from '../src/photo-input'
import { syntheticPng } from './photo-fixtures'
import { expectError, startServer } from './helpers'

const membership = { orgId: 'demo-org', label: '架空の自治体', role: 'editor' as const, areaId: 'demo-area' }
const verifier = { verify: async (token: string) => ({ uid: token }) }
const headers = { Authorization: 'Bearer owner', 'Idempotency-Key': 'asset-a' }
const assetPath = '/api/v1/orgs/demo-org/assets'
const metadata = { purpose: 'reference' as const, photoRights: '自作の合成テスト画像' }
const draft = {
  materials: { name: '', evidence: '', requiresBoat: false, requiresPaidFacility: false, price: '', photoNote: '', photoRights: '' },
  content: { title: '', question: '', hints: ['', '', ''], verifiedFeatures: '', draftingNotes: '' },
  afterClear: { access: '', hours: '', promoComment: '', explanation: '' },
  referenceAssetId: null, hintAssetId: null,
}
function form(data: unknown = metadata, bytes: Uint8Array = syntheticPng, type = 'image/png') {
  const body = new FormData()
  body.append('photo', new Blob([new Uint8Array(bytes)], { type }), 'ignored-private-filename.png')
  body.append('metadata', JSON.stringify(data))
  return body
}
const memberships = async (uid: string) => uid === 'traveler' ? [] : [{ ...membership, ...(uid === 'other' ? { orgId: 'other-org' } : {}) }]

test('D uploads a validated private photo, reads it with auth and saves the returned assetId in a draft', async (t) => {
  const { base } = await startServer(t, { verifier, memberships, adminAssets: new DemoAssetStore() })
  const api = createApiClient({ expectedDataMode: 'demo', getIdToken: async () => 'owner', fetch: (url, init) => fetch(base + String(url), init) })
  const asset = await api.uploadOrgAsset('demo-org', { ...metadata, photo: new Blob([new Uint8Array(syntheticPng)], { type: 'image/png' }), idempotencyKey: 'asset-a' })
  assert.equal(asset.source, 'mock')
  assert.equal(asset.orgId, 'demo-org')
  assert.equal(asset.purpose, 'reference')
  assert.equal(asset.contentType, 'image/jpeg')
  assert.equal(asset.width, 2)
  assert.equal(asset.height, 2)
  assert.equal(asset.photoRights, metadata.photoRights)
  assert.deepEqual(await api.getOrgAsset('demo-org', asset.assetId), asset)
  const picture = await api.getOrgAssetPhoto('demo-org', asset.assetId)
  const decoded = await sharp(Buffer.from(await picture.arrayBuffer())).metadata()
  assert.equal(decoded.format, 'jpeg')
  assert.equal(decoded.exif, undefined)
  const created = await api.createManagedQuest('demo-org', { ...draft, content: { ...draft.content, hints: ['', '', ''] }, referenceAssetId: asset.assetId })
  assert.equal(created.draft.referenceAssetId, asset.assetId)
  const photoResponse = await fetch(base + assetPath + '/' + asset.assetId + '/photo', { headers })
  assert.equal(photoResponse.headers.get('X-Quest-Assets-Mode'), 'memory')
  assert.equal(photoResponse.headers.get('Cache-Control'), 'private, no-store')
  assert.equal(photoResponse.headers.get('Access-Control-Allow-Origin'), null)
  await photoResponse.arrayBuffer()
  await expectError(await fetch(base + '/api/v1/assets/' + asset.assetId), 404, 'NOT_FOUND')
})

test('upload retries reuse one asset, changed content conflicts and purpose cannot be reassigned', async (t) => {
  const { base } = await startServer(t, { verifier, memberships, adminAssets: new DemoAssetStore() })
  const send = (data: unknown = metadata) => fetch(base + assetPath, { method: 'POST', headers, body: form(data) })
  const responses = await Promise.all([send(), send()])
  assert.deepEqual(responses.map((item) => item.status).sort(), [200, 201])
  const first = await responses[0].json() as { assetId: string }
  assert.equal((await responses[1].json() as { assetId: string }).assetId, first.assetId)
  await expectError(await send({ ...metadata, photoRights: '別の権利説明' }), 409, 'IDEMPOTENCY_CONFLICT')
  await expectError(await fetch(base + '/api/v1/orgs/demo-org/quests', {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ draft: { ...draft, hintAssetId: first.assetId } }),
  }), 400, 'INVALID_INPUT')
  const hint = await (await fetch(base + assetPath, { method: 'POST', headers: { ...headers, 'Idempotency-Key': 'hint-a' }, body: form({ ...metadata, purpose: 'public_hint' }) })).json() as { assetId: string }
  const saved = await fetch(base + '/api/v1/orgs/demo-org/quests', {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ draft: { ...draft, hintAssetId: hint.assetId } }),
  })
  assert.equal(saved.status, 201)
})

test('Google login cannot grant membership and assets remain isolated by organization', async (t) => {
  const { base } = await startServer(t, { verifier, memberships, adminAssets: new DemoAssetStore() })
  await expectError(await fetch(base + assetPath, { method: 'POST', body: form() }), 401, 'UNAUTHENTICATED')
  await expectError(await fetch(base + assetPath, { method: 'POST', headers: { ...headers, Authorization: 'Bearer traveler' }, body: form() }), 403, 'FORBIDDEN')
  const asset = await (await fetch(base + assetPath, { method: 'POST', headers, body: form() })).json() as { assetId: string }
  for (const suffix of ['', '/photo']) {
    await expectError(await fetch(base + '/api/v1/orgs/other-org/assets/' + asset.assetId + suffix, { headers: { Authorization: 'Bearer other' } }), 404, 'NOT_FOUND')
    assert.equal((await fetch(base + assetPath + '/' + asset.assetId + suffix, { headers: { Authorization: 'Bearer colleague' } })).status, 200)
  }
})

test('unconfigured storage and membership revoked during upload never create an asset', async (t) => {
  const disabled = await startServer(t, { verifier, memberships })
  await expectError(await fetch(disabled.base + assetPath, { method: 'POST', headers, body: form() }), 503, 'SYSTEM_ERROR', true)
  let checks = 0
  const assets = new DemoAssetStore()
  const { base } = await startServer(t, { verifier, adminAssets: assets, memberships: async () => ++checks === 1 ? [membership] : [] })
  await expectError(await fetch(base + assetPath, { method: 'POST', headers, body: form() }), 403, 'FORBIDDEN')
  assert.equal(assets.findReplay('demo-org', 'owner', 'asset-a', 'a'.repeat(64)), null)
})

test('revocation after actual image normalization is checked again before storing the image', async (t) => {
  let active = true
  const module = require('../src/photo-input') as typeof import('../src/photo-input')
  const original = module.preparePhoto
  t.mock.method(module, 'preparePhoto', async (input: Parameters<typeof preparePhoto>[0]) => {
    const result = await original(input)
    active = false
    return result
  })
  const assets = new DemoAssetStore()
  const { base } = await startServer(t, { verifier, adminAssets: assets, memberships: async () => active ? [membership] : [] })
  await expectError(await fetch(base + assetPath, { method: 'POST', headers, body: form() }), 403, 'FORBIDDEN')
  assert.equal(assets.findReplay('demo-org', 'owner', 'asset-a', 'a'.repeat(64)), null)
})

test('asset input rejects claimed authority, unsafe metadata, bad image bytes and unsupported routes', async (t) => {
  const { base } = await startServer(t, { verifier, memberships, adminAssets: new DemoAssetStore({ requestsPerMinute: 60 }) })
  for (const data of [{ ...metadata, orgId: 'other-org' }, { ...metadata, uid: 'owner' }, { ...metadata, purpose: 'answer' },
    { ...metadata, photoRights: '' }, { ...metadata, photoRights: 'x'.repeat(2001) }]) {
    await expectError(await fetch(base + assetPath, { method: 'POST', headers, body: form(data) }), 400, 'INVALID_INPUT')
  }
  await expectError(await fetch(base + assetPath, { method: 'POST', headers, body: form(metadata, new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])) }), 400, 'INVALID_INPUT')
  await expectError(await fetch(base + assetPath, { method: 'POST', headers, body: form(metadata, new Uint8Array(4 * 1024 * 1024 + 1)) }), 413, 'MEDIA_TOO_LARGE')
  await expectError(await fetch(base + assetPath, { method: 'POST', headers: { Authorization: 'Bearer owner' }, body: form() }), 400, 'INVALID_INPUT')
  await expectError(await fetch(base + assetPath + '?role=publisher', { method: 'POST', headers, body: form() }), 400, 'INVALID_INPUT')
  await expectError(await fetch(base + assetPath + '/missing', { method: 'PATCH', headers }), 405, 'HTTP_ERROR')
})

test('capacity and upload limits retain prior assets and allow safe retries after errors', async () => {
  let now = 0
  const store = new DemoAssetStore({ capacity: 1, requestsPerMinute: 1, concurrentUploads: 1, now: () => now })
  const release = store.acquire('owner')
  assert.throws(() => store.acquire('other'), { code: 'RATE_LIMITED' })
  release(); release()
  assert.throws(() => store.acquire('owner'), { code: 'RATE_LIMITED' })
  now = 60000
  store.acquire('owner')()
  const prepared = await preparePhoto({ bytes: syntheticPng, mimeType: 'image/png' })
  const first = store.put('demo-org', 'owner', 'asset-a', 'a'.repeat(64), metadata, prepared)
  assert.equal(store.put('demo-org', 'owner', 'asset-a', 'a'.repeat(64), metadata, prepared).created, false)
  assert.throws(() => store.put('demo-org', 'owner', 'asset-b', 'b'.repeat(64), metadata, prepared), { code: 'RATE_LIMITED' })
  const bytes = store.getPhotoOwned('demo-org', first.asset.assetId)!
  bytes[0] = 0
  assert.equal(store.getPhotoOwned('demo-org', first.asset.assetId)![0], 255)
  const byteLimited = new DemoAssetStore({ maximumBytes: prepared.bytes.length })
  byteLimited.put('demo-org', 'owner', 'asset-a', 'a'.repeat(64), metadata, prepared)
  assert.throws(() => byteLimited.put('demo-org', 'owner', 'asset-b', 'b'.repeat(64), metadata, prepared), { code: 'RATE_LIMITED' })
})
