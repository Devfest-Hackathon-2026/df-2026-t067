import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { deleteApp, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import test from 'node:test'
import { createApiClient } from '../../src/shared/api/client'
import { createDurableAnswerServer } from '../src/durable-answer-http'
import { listenServer } from './helpers'

const emulator = process.env.QUEST_FIRESTORE_TEST_HOST

test('durable reports deduplicate across servers and reach only the publishing organization', {
  skip: !emulator, timeout: 15_000,
}, async (t) => {
  assert(emulator && /^127\.0\.0\.1:[1-9]\d{0,4}$/.test(emulator) && Number(emulator.split(':')[1]) <= 65535)
  process.env.FIRESTORE_EMULATOR_HOST = emulator
  const app = initializeApp({ projectId: 'demo-t067-durable-reports' }, 'durable-reports')
  t.after(() => deleteApp(app))
  const db = getFirestore(app)
  db.settings({ universeDomain: 'googleapis.com' })
  const orgId = 'report-org', questId = 'report-quest'
  const quest = db.collection('quests').doc(questId)
  const batch = db.batch()
  batch.create(quest, { orgId, publishedVersion: 1, status: 'published' })
  batch.create(db.collection('questVersions').doc(questId + ':1'), { placeId: questId })
  batch.create(db.collection('quests').doc('draft'), { orgId, publishedVersion: null, status: 'draft' })
  for (const [uid, org, role] of [['publisher', orgId, 'publisher'], ['editor', orgId, 'editor'], ['other', 'other-org', 'publisher']]) {
    const id = createHash('sha256').update(JSON.stringify([uid, org])).digest('hex')
    batch.create(db.collection('memberships').doc(id), { uid, orgId: org, role, active: true, areaId: 'report-area', label: '架空の自治体' })
  }
  await batch.commit()
  const unexpected = () => { throw new Error('Report operation unexpectedly accessed a photo') }
  async function start() {
    const policy = { maximum: 10, windowMs: 60_000 }
    const server = createDurableAnswerServer({ db, dataMode: 'durable-local',
      verifier: { verify: async (token) => ({ uid: token }) }, photos: { writeIncoming: unexpected, readRecord: unexpected, deleteRecord: unexpected },
      challengePolicy: policy, answerPolicy: policy, acquireUpload: unexpected })
    const { base } = await listenServer(t, server)
    return (uid: string) => createApiClient({ expectedDataMode: 'durable-local', getIdToken: async () => uid,
      fetch: (path, init) => fetch(base + String(path), init) })
  }
  const first = await start(), second = await start()
  const traveler = first('traveler'), publisher = second('publisher')
  const input = { questId, category: 'PHOTO_UNAVAILABLE' as const, text: '架空の撮影状況', idempotencyKey: 'report-v1' }
  await assert.rejects(traveler.submitReport({ ...input, questId: 'draft' }), { code: 'NOT_FOUND' })
  const [report, replay] = await Promise.all([traveler.submitReport(input), second('traveler').submitReport(input)])
  assert.equal(report.source, 'real')
  assert.deepEqual(report, replay)
  await assert.rejects(traveler.submitReport({ ...input, text: '異なる内容' }), { code: 'IDEMPOTENCY_CONFLICT' })
  await assert.rejects(first('editor').listManagedReports(orgId), { code: 'FORBIDDEN' })
  await assert.rejects(second('other').listManagedReports(orgId), { code: 'FORBIDDEN' })
  assert.deepEqual((await second('other').listManagedReports('other-org')).items, [])
  assert.deepEqual((await publisher.listManagedReports(orgId)).items.map(({ reportId, questVersion, text }) =>
    ({ reportId, questVersion, text })), [{ reportId: report.reportId, questVersion: 1, text: input.text }])

  await quest.update({ publishedVersion: null, latestPublishedVersion: 1, status: 'paused', pauseReason: '架空の休止' })
  const paused = await traveler.submitReport({ ...input, idempotencyKey: 'report-paused' })
  await db.collection('questVersions').doc(questId + ':2').create({ placeId: questId })
  await quest.update({ publishedVersion: 2, latestPublishedVersion: 2, status: 'published', pauseReason: null })
  const after = await traveler.submitReport({ ...input, idempotencyKey: 'report-v2' })
  assert.deepEqual(await second('traveler').submitReport(input), report)
  const page = await publisher.listManagedReports(orgId, { limit: 1 })
  assert.equal(page.items[0].reportId, after.reportId)
  assert.equal(page.items[0].questVersion, 2)
  assert(page.nextCursor)
  const rest = await publisher.listManagedReports(orgId, { cursor: page.nextCursor })
  assert.deepEqual(new Set(rest.items.map(({ reportId, questVersion }) => reportId + ':' + questVersion)),
    new Set([paused.reportId + ':1', report.reportId + ':1']))
  assert.doesNotMatch(JSON.stringify([page, rest]), /traveler|report-v1|report-paused/)
  for (let count = 3; count < 10; count++) {
    await traveler.submitReport({ ...input, idempotencyKey: 'bounded-' + count })
  }
  await assert.rejects(second('traveler').submitReport({ ...input, idempotencyKey: 'over-cap' }), { code: 'RATE_LIMITED' })
  assert.deepEqual(await second('traveler').submitReport(input), report)
  const publisherId = createHash('sha256').update(JSON.stringify(['publisher', orgId])).digest('hex')
  await db.collection('memberships').doc(publisherId).update({ active: false })
  await assert.rejects(publisher.listManagedReports(orgId), { code: 'FORBIDDEN' })
})
