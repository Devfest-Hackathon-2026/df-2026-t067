import assert from 'node:assert/strict'
import test from 'node:test'
import { DemoAdminStore } from '../src/admin'
import { DemoAssetStore } from '../src/admin-assets'
import { DemoDiscoveryStore } from '../src/discoveries'
import { preparePhoto } from '../src/photo-input'
import type { PhotoMatcher } from '../src/photo-match'
import { otherSyntheticPng, syntheticPng } from './photo-fixtures'
import { expectError, startServer } from './helpers'
import { DemoAnswerStore } from '../src/answers'
import { createApiClient } from '../../src/shared/api/client'

const member = { orgId: 'demo-org', label: '架空', role: 'editor' as const, areaId: 'demo-area' }
const metadata = { expectedDraftRevision: 1, photoRights: '自作の合成写真' }
const headers = { Authorization: 'Bearer owner', 'Idempotency-Key': 'test-a' }
function form(data: unknown = metadata, bytes: Uint8Array = syntheticPng) {
  const body = new FormData()
  body.append('photo', new Blob([new Uint8Array(bytes)], { type: 'image/png' }), 'private-name.png')
  body.append('metadata', JSON.stringify(data))
  return body
}
async function setup(matcher: PhotoMatcher = async () => 'MATCH') {
  const adminAssets = new DemoAssetStore()
  const photo = await preparePhoto({ bytes: syntheticPng, mimeType: 'image/png' })
  const asset = adminAssets.put(member.orgId, 'owner', 'ref', 'ref-digest', { purpose: 'reference', photoRights: '合成' }, photo).asset
  const admin = new DemoAdminStore({ assetLookup: (id) => adminAssets.metadata(id) })
  const quest = admin.create(member, {
    materials: { name: '架空', evidence: '', requiresBoat: false, requiresPaidFacility: false, price: '', photoNote: '', photoRights: '' },
    content: { title: '', question: '', hints: ['', '', ''], verifiedFeatures: '合成の赤い図形\n白い背景', draftingNotes: '' },
    afterClear: { access: '', hours: '', promoComment: '', explanation: '' }, referenceAssetId: asset.assetId, hintAssetId: null,
  })
  return { admin, adminAssets, quest, discoveries: new DemoDiscoveryStore(), adminPhotoTest: { matcher },
    verifier: { verify: async (uid: string) => ({ uid }) }, memberships: async (uid: string) => uid === 'owner' ? [member] : [],
    path: '/api/v1/orgs/demo-org/quests/' + quest.questId + '/test' }
}

test('D can compare a photo at a draft revision without creating a traveler record or publishing', async (t) => {
  const s = await setup()
  const { base } = await startServer(t, s)
  const response = await fetch(base + s.path, { method: 'POST', headers, body: form() })
  assert.equal(response.status, 200)
  const result = await response.json() as { testId: string; outcome: string; source: string; draftRevision: number }
  assert.equal(result.outcome, 'MATCH')
  assert.equal(result.source, 'mock')
  assert.equal(result.draftRevision, 1)
  assert.deepEqual((await s.discoveries.listOwned('owner', {})).items, [])
  assert.equal(s.admin.get(member.orgId, s.quest.questId).status, 'draft')
  assert.equal(s.admin.get(member.orgId, s.quest.questId).draftRevision, 1)
  assert.equal(s.admin.get(member.orgId, s.quest.questId).publishedVersion, null)
  await expectError(await fetch(base + '/api/v1/attempts/' + result.testId, { headers }), 404, 'NOT_FOUND')
  assert.equal(s.adminAssets.getPhotoOwned(member.orgId, result.testId), null)
  assert.doesNotMatch(JSON.stringify(result), /photo|features|private-name|reference|discovery|CORRECT/)
})

test('the shared client binds tests to the selected draft and does not expose any private inputs', async (t) => {
  const s = await setup(async (input) => {
    assert.deepEqual(input.features, ['合成の赤い図形', '白い背景'])
    assert.equal(input.candidate.mimeType, 'image/jpeg')
    assert.equal(input.reference.mimeType, 'image/jpeg')
    return 'IMAGE_UNCERTAIN'
  })
  const { base } = await startServer(t, s)
  const api = createApiClient({ expectedDataMode: 'demo', getIdToken: async () => 'owner', fetch: (url, init) => fetch(base + String(url), init) })
  const result = await api.testManagedQuest(member.orgId, s.quest.questId, { ...metadata,
    photo: new Blob([new Uint8Array(syntheticPng)], { type: 'image/png' }), idempotencyKey: 'client-test' })
  assert.equal(result.questId, s.quest.questId)
  assert.equal(result.outcome, 'IMAGE_UNCERTAIN')
  for (const path of ['/api/v1/quests', '/api/v1/quests/demo-quest/hints/1?expectedVersion=1']) {
    const response = await fetch(base + path)
    assert.equal(response.status, 200)
    assert.doesNotMatch(await response.text(), /testId|photoRights|合成の赤い図形|白い背景/)
  }
})

test('concurrent test retries share one comparison; changed bytes or metadata conflict', async (t) => {
  let calls = 0
  const s = await setup(async () => { calls++; return 'MATCH' })
  const { base } = await startServer(t, s)
  const submit = (data: unknown = metadata, bytes = syntheticPng) => fetch(base + s.path, { method: 'POST', headers, body: form(data, bytes) })
  const responses = await Promise.all([submit(), submit()])
  assert.deepEqual(responses.map((item) => item.status), [200, 200])
  const first = await responses[0].json()
  assert.deepEqual(await responses[1].json(), first)
  assert.equal(calls, 1)
  await expectError(await submit(metadata, otherSyntheticPng), 409, 'IDEMPOTENCY_CONFLICT')
  await expectError(await submit({ ...metadata, photoRights: '別の説明' }), 409, 'IDEMPOTENCY_CONFLICT')
  assert.deepEqual(await (await submit()).json(), first)
  assert.equal(calls, 1)
})

test('test authorization, org separation and an unconfigured matcher fail without a fallback', async (t) => {
  const s = await setup()
  const { base } = await startServer(t, s)
  await expectError(await fetch(base + s.path, { method: 'POST', body: form() }), 401, 'UNAUTHENTICATED')
  await expectError(await fetch(base + s.path, { method: 'POST', headers: { ...headers, Authorization: 'Bearer traveler' }, body: form() }), 403, 'FORBIDDEN')
  const other = await startServer(t, { ...s, memberships: async () => [{ ...member, orgId: 'other-org' }] })
  await expectError(await fetch(other.base + s.path.replace('demo-org', 'other-org'), { method: 'POST', headers, body: form() }), 404, 'NOT_FOUND')
  const disabled = await startServer(t, { ...s, adminPhotoTest: undefined })
  await expectError(await fetch(disabled.base + s.path, { method: 'POST', headers, body: form() }), 503, 'SYSTEM_ERROR')
  const method = await fetch(base + s.path, { headers })
  assert.equal(method.headers.get('Allow'), 'POST')
  await expectError(method, 405, 'HTTP_ERROR')
})

test('test inputs require rights, valid pixel data and a matching saved reference and feature list', async (t) => {
  let calls = 0
  const s = await setup(async () => { calls++; return 'MATCH' })
  const { base } = await startServer(t, s)
  for (const patch of [{ photoRights: '' }, { orgId: 'other' }, { isCorrect: true }, { expectedDraftRevision: 0 }]) {
    await expectError(await fetch(base + s.path, { method: 'POST', headers, body: form({ ...metadata, ...patch }) }), 400, 'INVALID_INPUT')
  }
  await expectError(await fetch(base + s.path, { method: 'POST', headers, body: form(metadata, syntheticPng.subarray(0, 8)) }), 400, 'INVALID_INPUT')
  await expectError(await fetch(base + s.path, { method: 'POST', headers, body: form({ ...metadata, photoRights: 'あ'.repeat(1500) }) }), 413, 'MEDIA_TOO_LARGE')
  const extra = form(); extra.append('role', 'publisher')
  await expectError(await fetch(base + s.path, { method: 'POST', headers, body: extra }), 400, 'INVALID_INPUT')
  for (const features of ['', 'x'.repeat(301), Array.from({ length: 21 }, () => 'feature').join('\n')]) {
    const current = s.admin.get(member.orgId, s.quest.questId)
    const saved = s.admin.update(member.orgId, s.quest.questId, { expectedDraftRevision: current.draftRevision,
      draft: { ...current.draft, content: { ...current.draft.content, verifiedFeatures: features } } })
    await expectError(await fetch(base + s.path, { method: 'POST', headers, body: form({ ...metadata, expectedDraftRevision: saved.draftRevision }) }), 400, 'INVALID_INPUT')
  }
  assert.equal(calls, 0)
})

test('membership and draft revision are checked before the provider and after comparison', async (t) => {
  for (const change of ['revoke-before', 'edit-before', 'revoke-after', 'edit-after']) {
    let active = true, checks = 0, calls = 0
    const edit = () => {
      const current = s.admin.get(member.orgId, s.quest.questId)
      s.admin.update(member.orgId, s.quest.questId, { expectedDraftRevision: current.draftRevision, draft: current.draft })
    }
    const s = await setup(async () => {
      calls++
      if (change === 'revoke-after') active = false
      if (change === 'edit-after') edit()
      return 'MATCH'
    })
    const { base } = await startServer(t, { ...s, memberships: async () => {
      if (++checks === 3) {
        if (change === 'revoke-before') active = false
        if (change === 'edit-before') edit()
      }
      return active ? [member] : []
    } })
    const response = await fetch(base + s.path, { method: 'POST', headers, body: form() })
    await expectError(response, change.startsWith('revoke') ? 403 : 409, change.startsWith('revoke') ? 'FORBIDDEN' : 'DRAFT_CONFLICT')
    assert.equal(calls, change.endsWith('before') ? 0 : 1)
    assert.deepEqual((await s.discoveries.listOwned('owner', {})).items, [])
  }
})

test('wrong targets, uncertain photos and provider errors remain distinct and do not create clears', async (t) => {
  for (const outcome of ['WRONG_TARGET', 'IMAGE_UNCERTAIN', 'CORRECT', 'error']) {
    let calls = 0
    const s = await setup(async () => { calls++; if (outcome === 'error') throw new Error('private model details'); return outcome })
    const { base } = await startServer(t, s)
    for (let retry = 0; retry < 2; retry++) {
      const response = await fetch(base + s.path, { method: 'POST', headers, body: form() })
      if (outcome === 'CORRECT' || outcome === 'error') await expectError(response, 503, 'SYSTEM_ERROR', true)
      else { assert.equal(response.status, 200); assert.equal((await response.json() as { outcome: string }).outcome, outcome) }
    }
    assert.equal(calls, 1)
    assert.deepEqual((await s.discoveries.listOwned('owner', {})).items, [])
  }
})

test('a timed-out matcher retains its slot and late success never replaces the failed result', async (t) => {
  let finish!: (value: string) => void
  const pending = new Promise<string>((resolve) => { finish = resolve })
  let calls = 0
  const s = await setup(async () => { calls++; return pending })
  const { base } = await startServer(t, { ...s, adminPhotoTest: { ...s.adminPhotoTest, timeoutMs: 10 } })
  const submit = (key: string) => fetch(base + s.path, { method: 'POST', headers: { ...headers, 'Idempotency-Key': key }, body: form() })
  await expectError(await submit('first'), 503, 'SYSTEM_ERROR', true)
  await expectError(await submit('second'), 429, 'RATE_LIMITED', true)
  finish('MATCH')
  await new Promise<void>((resolve) => setImmediate(resolve))
  await expectError(await submit('first'), 503, 'SYSTEM_ERROR', true)
  assert.equal((await submit('second')).status, 200)
  assert.equal(calls, 2)
  assert.deepEqual((await s.discoveries.listOwned('owner', {})).items, [])
})

test('trial cache and shared upload rate limits preserve existing results', async (t) => {
  const s = await setup()
  const { base } = await startServer(t, { ...s, adminPhotoTest: { ...s.adminPhotoTest, capacity: 1 } })
  const submit = (key: string) => fetch(base + s.path, { method: 'POST', headers: { ...headers, 'Idempotency-Key': key }, body: form() })
  const first = await (await submit('first')).json()
  await expectError(await submit('second'), 429, 'RATE_LIMITED', true)
  assert.deepEqual(await (await submit('first')).json(), first)
  const limited = await startServer(t, { ...s, answers: new DemoAnswerStore({ requestsPerMinute: 1 }) })
  assert.equal((await fetch(limited.base + s.path, { method: 'POST', headers, body: form() })).status, 200)
  await expectError(await fetch(limited.base + s.path, { method: 'POST', headers, body: form() }), 429, 'RATE_LIMITED', true)
})

test('a cached result cannot be reused after the draft revision changes', async (t) => {
  let calls = 0
  const s = await setup(async () => { calls++; return 'MATCH' })
  const { base } = await startServer(t, s)
  assert.equal((await fetch(base + s.path, { method: 'POST', headers, body: form() })).status, 200)
  const current = s.admin.get(member.orgId, s.quest.questId)
  s.admin.update(member.orgId, s.quest.questId, { expectedDraftRevision: 1, draft: current.draft })
  await expectError(await fetch(base + s.path, { method: 'POST', headers, body: form() }), 409, 'DRAFT_CONFLICT')
  assert.equal(calls, 1)
})

test('an inconsistent stored reference cannot use another org asset or a public hint as reference', async (t) => {
  for (const foreign of [true, false]) {
    let calls = 0
    const s = await setup(async () => { calls++; return 'MATCH' })
    const prepared = await preparePhoto({ bytes: syntheticPng, mimeType: 'image/png' })
    const wrong = s.adminAssets.put(foreign ? 'other-org' : member.orgId, 'owner', 'wrong-ref', 'wrong-digest',
      { purpose: foreign ? 'reference' : 'public_hint', photoRights: '合成' }, prepared).asset
    const get = s.admin.get.bind(s.admin)
    t.mock.method(s.admin, 'get', (orgId: string, questId: string) => {
      const quest = get(orgId, questId)
      return { ...quest, draft: { ...quest.draft, referenceAssetId: wrong.assetId } }
    })
    const { base } = await startServer(t, s)
    await expectError(await fetch(base + s.path, { method: 'POST', headers, body: form() }), 400, 'INVALID_INPUT')
    assert.equal(calls, 0)
  }
})

test('cancelling an in-flight test aborts comparison and never turns its late result into success', { timeout: 3000 }, async (t) => {
  let began!: () => void, aborted!: () => void, finish!: (value: string) => void
  const started = new Promise<void>((resolve) => { began = resolve })
  const stopped = new Promise<void>((resolve) => { aborted = resolve })
  const pending = new Promise<string>((resolve) => { finish = resolve })
  let calls = 0
  const s = await setup(async (_input, call) => {
    calls++; began()
    call.signal.addEventListener('abort', aborted, { once: true })
    return pending
  })
  const { base } = await startServer(t, s)
  const controller = new AbortController()
  const request = fetch(base + s.path, { method: 'POST', headers, body: form(), signal: controller.signal })
  void request.catch(() => {})
  await started
  controller.abort()
  await assert.rejects(request, (error: unknown) => error instanceof Error && error.name === 'AbortError')
  await stopped
  finish('MATCH')
  await new Promise<void>((resolve) => setImmediate(resolve))
  await expectError(await fetch(base + s.path, { method: 'POST', headers, body: form() }), 503, 'SYSTEM_ERROR', true)
  assert.equal(calls, 1)
  assert.deepEqual((await s.discoveries.listOwned('owner', {})).items, [])
})

test('a deadline while rechecking membership prevents a late provider call and retains the slot', async (t) => {
  let release!: (members: Array<typeof member>) => void
  const gate = new Promise<Array<typeof member>>((resolve) => { release = resolve })
  let checks = 0, calls = 0
  const s = await setup(async () => { calls++; return 'MATCH' })
  const { base } = await startServer(t, { ...s, adminPhotoTest: { ...s.adminPhotoTest, timeoutMs: 10 },
    memberships: async () => ++checks === 3 ? gate : [member] })
  const submit = (key: string) => fetch(base + s.path, { method: 'POST', headers: { ...headers, 'Idempotency-Key': key }, body: form() })
  await expectError(await submit('first'), 503, 'SYSTEM_ERROR', true)
  await expectError(await submit('second'), 429, 'RATE_LIMITED', true)
  release([member])
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(calls, 0)
  await expectError(await submit('first'), 503, 'SYSTEM_ERROR', true)
  assert.equal((await submit('second')).status, 200)
  assert.equal(calls, 1)
})
