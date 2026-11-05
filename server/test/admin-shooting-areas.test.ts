import assert from 'node:assert/strict'
import test from 'node:test'
import type { ManagedQuestDraft, OrgMembership } from '../../src/shared/api/admin'
import { DemoAdminStore } from '../src/admin'
import { expectError, startServer } from './helpers'
import { createApiClient } from '../../src/shared/api/client'

const member: OrgMembership = { orgId: 'demo-org', label: '架空', role: 'editor', areaId: 'demo-area' }
const draft: ManagedQuestDraft = {
  materials: { name: '', evidence: '', requiresBoat: false, requiresPaidFacility: false, price: '', photoNote: '', photoRights: '' },
  content: { title: '', question: '', hints: ['', '', ''], verifiedFeatures: '', draftingNotes: '' },
  afterClear: { access: '', hours: '', promoComment: '', explanation: '' }, referenceAssetId: null, hintAssetId: null,
}
const zone = { latitude: 0.125, longitude: 0.25, radiusMeters: 25 }
const headers = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }
function seed() {
  const admin = new DemoAdminStore()
  const quest = admin.create(member, draft)
  return { admin, quest, path: '/api/v1/orgs/demo-org/quests/' + quest.questId + '/shooting-areas',
    verifier: { verify: async (uid: string) => ({ uid }) }, memberships: async (uid: string) => uid === 'owner' ? [member] : [] }
}

test('shooting areas can be set, restored and removed privately with the draft revision', async (t) => {
  const s = seed()
  const { base } = await startServer(t, s)
  const initial = await fetch(base + s.path, { headers })
  assert.equal(initial.status, 200)
  assert.deepEqual(await initial.json(), { orgId: member.orgId, questId: s.quest.questId, draftRevision: 1, zones: [], source: 'mock' })
  const update = await fetch(base + s.path, { method: 'PUT', headers, body: JSON.stringify({ expectedDraftRevision: 1, zones: [zone] }) })
  assert.equal(update.status, 200)
  assert.deepEqual(await update.json(), { orgId: member.orgId, questId: s.quest.questId, draftRevision: 2, zones: [zone], source: 'mock' })
  assert.equal(s.admin.get(member.orgId, s.quest.questId).shootingAreaStatus, 'configured')
  await expectError(await fetch(base + s.path, { method: 'PUT', headers, body: JSON.stringify({ expectedDraftRevision: 1, zones: [] }) }), 409, 'DRAFT_CONFLICT')
  const api = createApiClient({ expectedDataMode: 'demo', getIdToken: async () => 'owner', fetch: (url, init) => fetch(base + String(url), init) })
  assert.deepEqual((await api.getShootingAreas(member.orgId, s.quest.questId)).zones, [zone])
  const edited = await api.updateManagedQuest(member.orgId, s.quest.questId, { expectedDraftRevision: 2, draft })
  assert.equal(edited.draftRevision, 3)
  assert.equal(edited.shootingAreaStatus, 'configured')
  assert.doesNotMatch(JSON.stringify(edited), /radiusMeters|latitude|longitude|"zones"/)
  assert.deepEqual((await api.getShootingAreas(member.orgId, s.quest.questId)).zones, [zone])
  for (const path of ['/api/v1/quests', '/api/v1/quests/demo-quest', '/api/v1/quests/demo-quest/hints/1?expectedVersion=1', '/api/v1/orgs/demo-org/quests']) {
    const response = await fetch(base + path, { headers })
    assert.equal(response.status, 200)
    assert.doesNotMatch(await response.text(), /radiusMeters|latitude|longitude|"zones"/)
  }
  const removed = await api.updateShootingAreas(member.orgId, s.quest.questId, { expectedDraftRevision: 3, zones: [] })
  assert.equal(removed.draftRevision, 4)
  assert.deepEqual(removed.zones, [])
  assert.equal((await api.getManagedQuest(member.orgId, s.quest.questId)).shootingAreaStatus, 'unconfigured')
  assert.equal((await api.getManagedQuest(member.orgId, s.quest.questId)).status, 'draft')
  assert.equal((await api.getManagedQuest(member.orgId, s.quest.questId)).publishedVersion, null)
})

test('ownership and membership prevent reading or editing another org capture zone', async (t) => {
  const s = seed()
  const { base } = await startServer(t, s)
  for (const method of ['GET', 'PUT']) {
    await expectError(await fetch(base + s.path, { method }), 401, 'UNAUTHENTICATED')
    await expectError(await fetch(base + s.path, { method, headers: { Authorization: 'Bearer traveler' } }), 403, 'FORBIDDEN')
  }
  const other = await startServer(t, { ...s, memberships: async () => [{ ...member, orgId: 'other-org' }] })
  await expectError(await fetch(other.base + s.path.replace('demo-org', 'other-org'), { headers }), 404, 'NOT_FOUND')
  await expectError(await fetch(other.base + s.path.replace('demo-org', 'other-org'), {
    method: 'PUT', headers, body: JSON.stringify({ expectedDraftRevision: 1, zones: [zone] }),
  }), 404, 'NOT_FOUND')
})

test('zone writes and content edits share one revision and cannot overwrite each other', async (t) => {
  const s = seed()
  const { base } = await startServer(t, s)
  const results = await Promise.all([
    fetch(base + s.path, { method: 'PUT', headers, body: JSON.stringify({ expectedDraftRevision: 1, zones: [zone] }) }),
    fetch(base + s.path.replace('/shooting-areas', ''), { method: 'PATCH', headers, body: JSON.stringify({ expectedDraftRevision: 1, draft }) }),
  ])
  assert.deepEqual(results.map((item) => item.status).sort(), [200, 409])
  await expectError(results.find((item) => item.status === 409)!, 409, 'DRAFT_CONFLICT')
  const saved = s.admin.getShootingAreas(member.orgId, s.quest.questId)
  assert.equal(saved.draftRevision, 2)
  assert.deepEqual(saved.zones, results[0].status === 200 ? [zone] : [])
})

test('zone writes reject client authority, invalid transport and oversized bodies', async (t) => {
  const s = seed()
  const { base } = await startServer(t, s)
  for (const patch of [{ orgId: 'other' }, { status: 'published' }, { expectedDraftRevision: 0 },
    { zones: [{ ...zone, radiusMeters: 0 }] }, { zones: [{ ...zone, latitude: 91 }] },
    { zones: [{ ...zone, isCorrect: true }] }, { zones: Array.from({ length: 11 }, () => zone) }]) {
    await expectError(await fetch(base + s.path, { method: 'PUT', headers,
      body: JSON.stringify({ expectedDraftRevision: 1, zones: [zone], ...patch }) }), 400, 'INVALID_INPUT')
  }
  await expectError(await fetch(base + s.path, { method: 'PUT', headers, body: JSON.stringify({ data: 'x'.repeat(5000) }) }), 413, 'MEDIA_TOO_LARGE')
  await expectError(await fetch(base + s.path, { method: 'PUT', headers: { ...headers, 'Content-Type': 'text/plain' }, body: '{}' }), 415, 'HTTP_ERROR')
  const wrongMethod = await fetch(base + s.path, { method: 'POST', headers })
  assert.equal(wrongMethod.headers.get('Allow'), 'GET, PUT')
  await expectError(wrongMethod, 405, 'HTTP_ERROR')
  assert.equal(s.admin.get(member.orgId, s.quest.questId).draftRevision, 1)
})

test('membership revocation while reading PUT prevents its commit, including publisher removal', async (t) => {
  const s = seed()
  let checks = 0
  const { base } = await startServer(t, { ...s, memberships: async () => ++checks === 1 ? [{ ...member, role: 'publisher' as const }] : [] })
  await expectError(await fetch(base + s.path, { method: 'PUT', headers, body: JSON.stringify({ expectedDraftRevision: 1, zones: [zone] }) }), 403, 'FORBIDDEN')
  assert.equal(s.admin.getShootingAreas(member.orgId, s.quest.questId).draftRevision, 1)
  assert.deepEqual(s.admin.getShootingAreas(member.orgId, s.quest.questId).zones, [])
})

test('stored zones and returned copies are detached and a restart has no drafts or zones', () => {
  const s = seed()
  const input = { expectedDraftRevision: 1, zones: [{ ...zone }] }
  const saved = s.admin.updateShootingAreas(member.orgId, s.quest.questId, input)
  input.zones[0].radiusMeters = 99
  saved.zones[0].latitude = 88
  assert.deepEqual(s.admin.getShootingAreas(member.orgId, s.quest.questId).zones, [zone])
  assert.throws(() => new DemoAdminStore().getShootingAreas(member.orgId, s.quest.questId))
})
