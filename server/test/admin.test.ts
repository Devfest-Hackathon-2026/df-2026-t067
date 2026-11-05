import assert from 'node:assert/strict'
import test from 'node:test'
import { createApiClient } from '../../src/shared/api/client'
import type { ManagedQuestDraft, OrgMembership } from '../../src/shared/api/admin'
import { DemoAdminStore } from '../src/admin'
import { expectError, startServer } from './helpers'

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

function options() {
  return { verifier: { verify: async (token: string) => ({ uid: token }) },
    memberships: async (uid: string) => uid === 'owner' ? [membership] : [], admin: new DemoAdminStore() }
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
  for (const action of ['generate', 'test', 'publish', 'pause']) {
    await expectError(await fetch(base + basePath + '/missing/' + action, { method: 'POST', headers }), 404, 'NOT_FOUND')
  }
})

test('revocation while a write is being read prevents the eventual save', async (t) => {
  let checks = 0
  const { base } = await startServer(t, { ...options(), memberships: async () => ++checks === 1 ? [membership] : [] })
  await expectError(await fetch(base + basePath, { method: 'POST', headers, body: JSON.stringify({ draft }) }), 403, 'FORBIDDEN')
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
