import assert from 'node:assert/strict'
import test from 'node:test'
import { createApiClient } from '../../src/shared/api/client'
import type { ManagedQuestDraft, OrgMembership } from '../../src/shared/api/admin'
import { DemoAdminStore } from '../src/admin'
import { DemoAssetStore } from '../src/admin-assets'
import { createFixtureDraftSuggester } from '../src/demo-draft-suggestions'
import { expectError, startServer } from './helpers'
import { otherSyntheticPng, syntheticPng } from './photo-fixtures'

const membership: OrgMembership = { orgId: 'demo-org', label: '架空の自治体', role: 'editor', areaId: 'demo-area' }
const draft: ManagedQuestDraft = {
  materials: { name: '架空の対象', evidence: '架空の根拠', requiresBoat: false, requiresPaidFacility: false,
    price: '', photoNote: '', photoRights: '' },
  content: { title: '下書き', question: '', hints: ['', '', ''], verifiedFeatures: '', draftingNotes: '' },
  afterClear: { access: '', hours: '', promoComment: '', explanation: '' },
  referenceAssetId: null, hintAssetId: null,
}
const headers = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }
const basePath = '/api/v1/orgs/demo-org/quests'
const verifier = { verify: async (token: string) => ({ uid: token }) }

function options() {
  return { verifier, memberships: async (uid: string) => uid === 'owner' ? [membership] : [], admin: new DemoAdminStore() }
}

test('admin client discovers server-owned membership and saves only a private demo draft', async (t) => {
  const { base } = await startServer(t, options())
  const api = createApiClient({ fetch: (input, init) => fetch(base + String(input), init),
    getIdToken: async () => 'owner', expectedDataMode: 'demo' })
  assert.deepEqual(await api.listMemberships(), { items: [membership], nextCursor: null })
  const created = await api.createManagedQuest('demo-org', draft)
  assert.equal(created.orgId, 'demo-org')
  assert.equal(created.areaId, 'demo-area')
  assert.equal(created.draftRevision, 1)
  assert.equal(created.publishedVersion, null)
  assert.equal(created.status, 'draft')
  assert.equal(created.shootingAreaStatus, 'unconfigured')
  assert.equal(created.source, 'mock')
  assert.deepEqual((await api.listManagedQuests('demo-org')).items, [created])
  assert.deepEqual(await api.getManagedQuest('demo-org', created.questId), created)
  await expectError(await fetch(base + '/api/v1/quests/' + created.questId), 404, 'NOT_FOUND')
  const publicList = await api.listQuests()
  assert.equal(publicList.items.some((item) => item.questId === created.questId), false)
})

test('Google login alone and client-supplied roles never grant municipal membership', async (t) => {
  const { base } = await startServer(t, options())
  await expectError(await fetch(base + basePath), 401, 'UNAUTHENTICATED')
  await expectError(await fetch(base + basePath, { headers: { Authorization: 'Bearer traveler' } }), 403, 'FORBIDDEN')
  await expectError(await fetch(base + basePath + '?role=publisher&uid=owner', {
    method: 'POST', headers: { ...headers, Authorization: 'Bearer traveler' }, body: JSON.stringify({ draft, role: 'publisher' }),
  }), 403, 'FORBIDDEN')
  const noMembershipProvider = await startServer(t, { verifier: options().verifier })
  await expectError(await fetch(noMembershipProvider.base + basePath, { headers }), 403, 'FORBIDDEN')
})

test('org/quest/asset isolation and purpose checks are enforced by the server', async (t) => {
  const config = options()
  config.admin = new DemoAdminStore({ assets: [
    { assetId: 'reference-a', orgId: 'demo-org', purpose: 'reference' },
    { assetId: 'hint-a', orgId: 'demo-org', purpose: 'public_hint' },
    { assetId: 'reference-b', orgId: 'other-org', purpose: 'reference' },
  ] })
  const { base } = await startServer(t, config)
  const make = (body: unknown) => fetch(base + basePath, { method: 'POST', headers, body: JSON.stringify(body) })
  for (const patch of [{ referenceAssetId: 'reference-b' }, { hintAssetId: 'reference-a' }, { referenceAssetId: 'hint-a' }, { referenceAssetId: 'missing' }]) {
    await expectError(await make({ draft: { ...draft, ...patch } }), 400, 'INVALID_INPUT')
  }
  const created = await (await make({ draft: { ...draft, referenceAssetId: 'reference-a', hintAssetId: 'hint-a' } })).json() as { questId: string }
  await expectError(await fetch(base + '/api/v1/orgs/other-org/quests/' + created.questId, { headers }), 403, 'FORBIDDEN')
  const other = await startServer(t, { ...config, memberships: async () => [{ ...membership, orgId: 'other-org' }] })
  await expectError(await fetch(other.base + '/api/v1/orgs/other-org/quests/' + created.questId, { headers }), 404, 'NOT_FOUND')
})

test('save conflicts preserve the latest draft and never change a published version', async (t) => {
  const { base } = await startServer(t, options())
  const api = createApiClient({ fetch: (input, init) => fetch(base + String(input), init), getIdToken: async () => 'owner', expectedDataMode: 'demo' })
  const original = await api.createManagedQuest('demo-org', draft)
  const changes = ['編集A', '編集B'].map((title) => api.updateManagedQuest('demo-org', original.questId, {
    expectedDraftRevision: 1, draft: { ...draft, content: { ...draft.content, title } },
  }))
  const results = await Promise.allSettled(changes)
  assert.equal(results.filter((item) => item.status === 'fulfilled').length, 1)
  const failed = results.find((item) => item.status === 'rejected')
  assert(failed?.status === 'rejected')
  assert.equal((failed.reason as { code: string }).code, 'DRAFT_CONFLICT')
  const saved = await api.getManagedQuest('demo-org', original.questId)
  assert.equal(saved.draftRevision, 2)
  assert.equal(saved.publishedVersion, null)
  assert.equal(saved.status, 'draft')
  assert(['編集A', '編集B'].includes(saved.draft.content.title))
})

test('membership is checked again after revocation, including reads and saves', async (t) => {
  let active = true
  const { base } = await startServer(t, { ...options(), memberships: async () => active ? [membership] : [] })
  const created = await (await fetch(base + basePath, { method: 'POST', headers, body: JSON.stringify({ draft }) })).json() as { questId: string }
  active = false
  await expectError(await fetch(base + basePath + '/' + created.questId, { headers }), 403, 'FORBIDDEN')
  await expectError(await fetch(base + basePath + '/' + created.questId, {
    method: 'PATCH', headers, body: JSON.stringify({ expectedDraftRevision: 1, draft }),
  }), 403, 'FORBIDDEN')
})

test('draft writes reject unknown claims, invalid transport and excess input', async (t) => {
  const { base } = await startServer(t, options())
  const make = (body: unknown) => fetch(base + basePath, { method: 'POST', headers, body: JSON.stringify(body) })
  for (const body of [{ draft, orgId: 'other-org' }, { draft, status: 'published' }, { draft: { ...draft, isCorrect: true } },
    { draft: { ...draft, materials: { ...draft.materials, availableModes: [], requiredModes: ['車'] } } },
    { draft: { ...draft, content: { ...draft.content, hints: ['one'] } } }]) {
    await expectError(await make(body), 400, 'INVALID_INPUT')
  }
  await expectError(await make({ draft: { ...draft, materials: { ...draft.materials, evidence: 'x'.repeat(70000) } } }), 413, 'MEDIA_TOO_LARGE')
  await expectError(await fetch(base + basePath, { method: 'POST', headers: { Authorization: 'Bearer owner', 'Content-Type': 'text/plain' }, body: '{}' }), 415, 'HTTP_ERROR')
  const response = await fetch(base + basePath, { method: 'DELETE', headers })
  assert.equal(response.headers.get('Allow'), 'GET, POST')
  await expectError(response, 405, 'HTTP_ERROR')
  for (const action of ['generate', 'test']) {
    await expectError(await fetch(base + basePath + '/missing/' + action, { method: 'POST', headers }), 404, 'NOT_FOUND')
  }
})

test('revocation while a write is being read prevents the eventual save', async (t) => {
  let checks = 0
  const { base } = await startServer(t, { ...options(), memberships: async () => ++checks === 1 ? [membership] : [] })
  await expectError(await fetch(base + basePath, { method: 'POST', headers, body: JSON.stringify({ draft }) }), 403, 'FORBIDDEN')
})

test('draft suggestions report unavailable when a source is unconfigured', async (t) => {
  const config = options()
  const created = config.admin.create(membership, draft)
  const { base } = await startServer(t, config)
  await expectError(await fetch(base + basePath + '/' + created.questId + '/generate', {
    method: 'POST', headers, body: JSON.stringify({ expectedDraftRevision: 1 }),
  }), 503, 'SYSTEM_ERROR', false)
})

test('a draft suggestion uses an owned saved fixture and never edits or publishes the draft', async (t) => {
  let checksBeforeRevocation: number | undefined
  const { base } = await startServer(t, {
    verifier, adminAssets: new DemoAssetStore(),
    memberships: async (uid) => {
      if (uid !== 'owner') return [{ ...membership, orgId: 'other-org' }]
      if (checksBeforeRevocation !== undefined && checksBeforeRevocation-- <= 0) return []
      return [membership]
    },
    suggestDraft: await createFixtureDraftSuggester(),
  })
  const api = (uid: string, demo?: 'demo') => createApiClient({ fetch: (input, init) => fetch(base + String(input), init),
    getIdToken: async () => uid, expectedDataMode: demo })
  const editor = api('owner', 'demo')
  const org = membership.orgId
  const upload = (bytes: Buffer, key: string) => editor.uploadOrgAsset(org, { purpose: 'reference',
    photoRights: '自作の合成画像', photo: new Blob([new Uint8Array(bytes)], { type: 'image/png' }), idempotencyKey: key })
  const fixture = await upload(syntheticPng, 'fixture-reference')
  const wrong = await upload(otherSyntheticPng, 'other-reference')
  const initial = await editor.createManagedQuest(org, { ...draft, materials: { ...draft.materials, photoRights: '自作合成' },
    referenceAssetId: fixture.assetId })
  const id = initial.questId
  const suggested = await editor.generateManagedQuestDraft(org, id, 1)
  assert.equal(suggested.source, 'mock')
  assert.equal(suggested.draftRevision, 1)
  assert.equal(suggested.content.hints.length, 3)
  assert.notEqual(suggested.content.title, initial.draft.content.title)
  assert.deepEqual(await editor.getManagedQuest(org, id), initial)
  await expectError(await fetch(base + '/api/v1/quests/' + id), 404, 'NOT_FOUND')
  await assert.rejects(api('owner').generateManagedQuestDraft(org, id, 1), { code: 'INVALID_RESPONSE' })
  await assert.rejects(api('other', 'demo').generateManagedQuestDraft('other-org', id, 1), { code: 'NOT_FOUND' })
  const changed = await editor.updateManagedQuest(org, id, { expectedDraftRevision: 1,
    draft: { ...initial.draft, referenceAssetId: wrong.assetId } })
  await assert.rejects(editor.generateManagedQuestDraft(org, id, 1), { code: 'DRAFT_CONFLICT' })
  await assert.rejects(editor.generateManagedQuestDraft(org, id, changed.draftRevision), { code: 'INVALID_INPUT' })
  checksBeforeRevocation = 1
  await assert.rejects(editor.generateManagedQuestDraft(org, id, changed.draftRevision), { code: 'FORBIDDEN' })
})

test('review submission reports missing fields and returns an edited submission to draft', async (t) => {
  const admin = new DemoAdminStore({ assets: [{ assetId: 'ref', orgId: membership.orgId, purpose: 'reference' }] })
  const initial = admin.create(membership, draft)
  const { base } = await startServer(t, { ...options(), admin })
  const path = base + basePath + '/' + initial.questId
  const submit = (expectedDraftRevision: number) => fetch(path + '/submit-review', {
    method: 'POST', headers, body: JSON.stringify({ expectedDraftRevision }),
  })
  const incomplete = await submit(1)
  assert.equal(incomplete.status, 200)
  assert.deepEqual(await incomplete.json(), {
    quest: initial, missing: ['materials.photoRights', 'referenceAssetId', 'shootingAreas', 'content.question', 'content.hints', 'content.verifiedFeatures'],
  })
  const complete: ManagedQuestDraft = {
    ...draft, referenceAssetId: 'ref', materials: { ...draft.materials, photoRights: '合成画像' },
    content: { ...draft.content, question: 'どの図形でしょう？', hints: ['形', '色', '背景'], verifiedFeatures: '赤い図形' },
  }
  admin.update(membership.orgId, initial.questId, { expectedDraftRevision: 1, draft: complete })
  admin.updateShootingAreas(membership.orgId, initial.questId, { expectedDraftRevision: 2,
    zones: [{ latitude: 0, longitude: 0, radiusMeters: 1000 }] })
  const pending = { ...admin.get(membership.orgId, initial.questId), status: 'review_pending' }
  const submissions = await Promise.all([submit(3), submit(3)])
  for (const response of submissions) {
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { quest: pending, missing: [] })
  }
  await expectError(await fetch(base + '/api/v1/quests/' + initial.questId), 404, 'NOT_FOUND')
  const api = createApiClient({ fetch: (input, init) => fetch(base + String(input), init),
    getIdToken: async () => 'owner', expectedDataMode: 'demo' })
  assert.deepEqual(await api.getManagedQuest(membership.orgId, initial.questId), pending)
  const edited = await api.updateManagedQuest(membership.orgId, initial.questId, { expectedDraftRevision: 3, draft: complete })
  assert.equal(edited.status, 'draft')
  assert.equal((await api.submitManagedQuestReview(membership.orgId, initial.questId, 4)).quest.status, 'review_pending')
  admin.updateShootingAreas(membership.orgId, initial.questId, { expectedDraftRevision: 4, zones: [] })
  await expectError(await submit(3), 409, 'DRAFT_CONFLICT')
  assert.equal(admin.get(membership.orgId, initial.questId).status, 'draft')
})

test('review submission rejects cross-org quests and membership revoked during the request', async (t) => {
  const admin = new DemoAdminStore()
  const initial = admin.create(membership, draft)
  const path = basePath + '/' + initial.questId + '/submit-review'
  let checks = 0
  const { base } = await startServer(t, { ...options(), admin, memberships: async () => ++checks === 1 ? [membership] : [] })
  await expectError(await fetch(base + path, {
    method: 'POST', headers, body: JSON.stringify({ expectedDraftRevision: 1 }),
  }), 403, 'FORBIDDEN')
  const other = await startServer(t, { ...options(), admin, memberships: async () => [{ ...membership, orgId: 'other-org' }] })
  await expectError(await fetch(other.base + path.replace('demo-org', 'other-org'), {
    method: 'POST', headers, body: JSON.stringify({ expectedDraftRevision: 1 }),
  }), 404, 'NOT_FOUND')
  assert.equal(admin.get(membership.orgId, initial.questId).status, 'draft')
})

test('demo capacity preserves existing edits, returned values are detached, and restart clears drafts', () => {
  const store = new DemoAdminStore()
  const first = store.create(membership, draft)
  first.draft.content.title = 'changed outside the store'
  assert.equal(store.get('demo-org', first.questId).draft.content.title, '下書き')
  for (let i = 1; i < 100; i++) store.create(membership, draft)
  assert.throws(() => store.create(membership, draft), (error: unknown) =>
    error instanceof Error && 'code' in error && error.code === 'RATE_LIMITED')
  assert.equal(store.update('demo-org', first.questId, { expectedDraftRevision: 1, draft }).draftRevision, 2)
  assert.equal(store.create({ ...membership, orgId: 'other-org' }, draft).orgId, 'other-org')
  assert.deepEqual(new DemoAdminStore().list('demo-org'), [])
})
