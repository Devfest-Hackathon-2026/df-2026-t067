import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { deleteApp, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import test from 'node:test'
import type { ManagedQuestDraft } from '../../src/shared/api/admin'
import { createApiClient } from '../../src/shared/api/client'
import { createFixturePhotoMatcher, durableFixtureFeatures, otherSyntheticPng, syntheticPng } from '../src/demo-photo-test'
import { createDurableAnswerServer } from '../src/durable-answer-http'
import { FirestoreManagedDraftStore } from '../src/firestore-managed-drafts'
import { FirestoreOrgAssetStore } from '../src/firestore-org-assets'
import { preparePhoto } from '../src/photo-input'
import { listenServer } from './helpers'

const emulator = process.env.QUEST_FIRESTORE_TEST_HOST

test('durable photo tests deduplicate across servers and store evidence only for the checked draft', {
  skip: !emulator, timeout: 15_000,
}, async (t) => {
  assert(emulator && /^127\.0\.0\.1:[1-9]\d{0,4}$/.test(emulator) && Number(emulator.split(':')[1]) <= 65535)
  process.env.FIRESTORE_EMULATOR_HOST = emulator
  const app = initializeApp({ projectId: 'demo-t067-admin-photo-tests' }, 'durable-admin-photo-tests')
  t.after(() => deleteApp(app))
  const db = getFirestore(app)
  db.settings({ universeDomain: 'googleapis.com' })
  const uid = 'editor', orgId = 'photo-test-org', areaId = 'photo-test-area', assetId = 'private-reference'
  const memberId = createHash('sha256').update(JSON.stringify([uid, orgId])).digest('hex')
  const reference = await preparePhoto({ bytes: syntheticPng, mimeType: 'image/png' })
  const batch = db.batch()
  batch.create(db.collection('areas').doc(areaId), { label: '架空の地域', marker: { latitude: 0, longitude: 0 }, prefectureCode: '13',
    boundarySource: 'fixture', publicGeometryJson: JSON.stringify({ type: 'Polygon', coordinates: [[[0, 0], [0, 1], [1, 1], [0, 0]]] }) })
  batch.create(db.collection('memberships').doc(memberId), { uid, orgId, active: true, role: 'editor', label: '架空の自治体', areaId })
  batch.create(db.collection('orgAssets').doc(assetId), { generation: '1', digest: 'a'.repeat(64),
    asset: { assetId, orgId, purpose: 'reference', photoRights: '架空', contentType: 'image/jpeg', width: reference.width,
      height: reference.height, byteLength: reference.bytes.length, source: 'real' } })
  await batch.commit()

  const fixture = await createFixturePhotoMatcher()
  let entered!: () => void
  let unblock!: () => void
  let comparingOldDraft!: () => void
  let finishOldDraft!: () => void
  const started = new Promise<void>((resolve) => { entered = resolve })
  const blocked = new Promise<void>((resolve) => { unblock = resolve })
  const startedOldDraft = new Promise<void>((resolve) => { comparingOldDraft = resolve })
  const blockedOldDraft = new Promise<void>((resolve) => { finishOldDraft = resolve })
  t.after(() => { unblock(); finishOldDraft() })
  let matches = 0
  const unexpected = () => { throw new Error('Photo test unexpectedly wrote an image or accessed a traveler photo') }
  async function start() {
    const policy = { maximum: 10, windowMs: 60_000 }
    const assets = new FirestoreOrgAssetStore(db, {
      writeReference: unexpected, writeHint: unexpected, readHint: unexpected,
      readReference: async (org, asset, generation) => {
        assert.deepEqual([org, asset, generation], [orgId, assetId, '1'])
        return reference
      },
    })
    const server = createDurableAnswerServer({ db, dataMode: 'durable-local', assets, drafts: new FirestoreManagedDraftStore(db),
      verifier: { verify: async (token) => ({ uid: token }) },
      photos: { writeIncoming: unexpected, readRecord: unexpected, deleteRecord: unexpected }, acquireUpload: () => () => {},
      challengePolicy: policy, answerPolicy: policy, photoTest: { source: 'mock', matcher: async (input, call) => {
        if (++matches === 1) {
          entered()
          await blocked
        } else if (matches === 3) {
          comparingOldDraft()
          await blockedOldDraft
        }
        return fixture(input, call)
      } } })
    const { base } = await listenServer(t, server)
    return (token: string) => createApiClient({ expectedDataMode: 'durable-local',
      getIdToken: async () => token, fetch: (path, init) => fetch(base + String(path), init) })
  }
  const first = await start(), second = await start()
  const editor = first(uid), replay = second(uid)
  const draft: ManagedQuestDraft = {
    materials: { name: '架空の対象', evidence: '', requiresBoat: false, requiresPaidFacility: false, price: '', photoNote: '', photoRights: '' },
    content: { title: '写真試験用', question: '', hints: ['', '', ''], verifiedFeatures: durableFixtureFeatures[0], draftingNotes: '' },
    afterClear: { access: '', hours: '', promoComment: '', explanation: '' }, referenceAssetId: assetId, hintAssetId: null,
  }
  const { questId, draftRevision } = await editor.createManagedQuest(orgId, draft)
  const candidate = { expectedDraftRevision: draftRevision, photoRights: '合成画像の試験用',
    idempotencyKey: 'photo-test-match', photo: new Blob([Uint8Array.from(syntheticPng)], { type: 'image/png' }) }
  await assert.rejects(second('traveler').testManagedQuest(orgId, questId, candidate), { code: 'FORBIDDEN' })

  assert.equal(matches, 0)
  const pending = editor.testManagedQuest(orgId, questId, candidate)
  try {
    await Promise.race([started, pending.then(() => { throw new Error('Matcher was never called') })])
    await assert.rejects(replay.testManagedQuest(orgId, questId, candidate), { code: 'RATE_LIMITED', retryable: true })
    await assert.rejects(replay.testManagedQuest(orgId, questId, { ...candidate, photoRights: '別の説明' }), { code: 'IDEMPOTENCY_CONFLICT' })
  } finally {
    unblock()
  }
  const result = await pending
  assert.equal(result.source, 'mock')
  assert.equal(result.outcome, 'MATCH')
  assert.deepEqual(await replay.testManagedQuest(orgId, questId, candidate), result)
  assert.equal(matches, 1)

  const other = await replay.testManagedQuest(orgId, questId, { ...candidate, idempotencyKey: 'photo-test-mismatch',
    photo: new Blob([Uint8Array.from(otherSyntheticPng)], { type: 'image/png' }) })
  assert.equal(other.outcome, 'WRONG_TARGET')
  const evidence = await db.collection('adminPhotoTestEvidence').get()
  assert.equal(evidence.size, 2)
  const byTestId = new Map(evidence.docs.map((doc) => [doc.id, doc.data()]))
  assert.match(byTestId.get(result.testId)?.photoDigest, /^[a-f0-9]{64}$/)
  assert.notEqual(byTestId.get(other.testId)?.photoDigest, byTestId.get(result.testId)?.photoDigest)
  assert(!JSON.stringify(evidence.docs.map((doc) => doc.data())).includes(candidate.photoRights))
  assert((await db.collection('attempts').limit(1).get()).empty)
  assert((await db.collection('discoveries').limit(1).get()).empty)

  const expiredJobId = createHash('sha256').update(JSON.stringify([uid, orgId, questId, candidate.idempotencyKey])).digest('hex')
  await db.collection('adminPhotoTestJobs').doc(expiredJobId).update({ state: 'pending', deadline: 0 })
  await assert.rejects(replay.testManagedQuest(orgId, questId, candidate), { code: 'SYSTEM_ERROR', retryable: false })
  assert.equal(matches, 2)

  const oldDraft = editor.testManagedQuest(orgId, questId, { ...candidate, idempotencyKey: 'photo-test-while-editing' })
  const oldDraftRejected = assert.rejects(oldDraft, { code: 'DRAFT_CONFLICT' })
  try {
    await Promise.race([startedOldDraft, oldDraft.then(() => { throw new Error('Matcher was never called') })])
    await replay.updateManagedQuest(orgId, questId, { expectedDraftRevision: draftRevision, draft })
  } finally {
    finishOldDraft()
  }
  await oldDraftRejected
  assert.equal((await db.collection('adminPhotoTestEvidence').get()).size, 2)
  await assert.rejects(replay.testManagedQuest(orgId, questId, candidate), { code: 'DRAFT_CONFLICT' })
  assert.equal(matches, 3)
})
