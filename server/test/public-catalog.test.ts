import assert from 'node:assert/strict'
import { deleteApp, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import test from 'node:test'
import { createApiClient } from '../../src/shared/api/client'
import { createDemoData } from '../src/demo-data'
import { createDurableAnswerServer } from '../src/durable-answer-http'
import { listenServer } from './helpers'

const emulator = process.env.QUEST_FIRESTORE_TEST_HOST

test('public catalog serves only current public projections with scoped cursors and versioned hints', {
  skip: !emulator, timeout: 15_000,
}, async (t) => {
  assert(emulator && /^127\.0\.0\.1:[1-9]\d{0,4}$/.test(emulator) && Number(emulator.split(':')[1]) <= 65535)
  process.env.FIRESTORE_EMULATOR_HOST = emulator
  const app = initializeApp({ projectId: 'demo-t067-catalog-test' }, 'public-catalog')
  const db = getFirestore(app)
  db.settings({ universeDomain: 'googleapis.com' })
  const { areas: [area], quests: [first, second], hints } = createDemoData()
  const current = db.collection('quests')
  const catalog = db.collection('questPublic')
  const batch = db.batch()
  batch.create(db.collection('areas').doc(area.areaId), { label: area.label, marker: area.marker,
    publicGeometryJson: JSON.stringify(area.publicGeometry), publishedCount: 999 })
  for (const quest of [first, second]) {
    batch.create(current.doc(quest.questId), { status: 'published', publishedVersion: quest.version, internal: '非公開データ' })
    batch.create(catalog.doc(quest.questId), { quest, hints: hints.get(quest.questId), internal: '非公開データ' })
  }
  batch.create(db.collection('questVersions').doc(first.questId + ':1'), { internal: '非公開データ' })
  const privateQuest = { ...first, questId: 'draft-only' }
  batch.create(current.doc(privateQuest.questId), { status: 'draft', publishedVersion: null })
  batch.create(catalog.doc(privateQuest.questId), { quest: privateQuest, hints: ['非公開データ'] })
  await batch.commit()
  const unexpected = () => { throw new Error('Anonymous catalog touched a protected dependency') }
  const policy = { maximum: 10, windowMs: 60_000 }
  const server = createDurableAnswerServer({ db, dataMode: 'durable-local',
    photos: { writeIncoming: unexpected, readRecord: unexpected, deleteRecord: unexpected },
    verifier: { verify: unexpected }, acquireUpload: unexpected, challengePolicy: policy, answerPolicy: policy })
  const { base } = await listenServer(t, server)
  t.after(() => deleteApp(app))
  const api = createApiClient({ fetch: (path, init) => fetch(base + String(path), init) })

  const page = await api.listQuests({ areaId: area.areaId, limit: 1 })
  assert.deepEqual(page.items, [first])
  assert(page.nextCursor)
  assert.deepEqual(await api.listQuests({ areaId: area.areaId, limit: 1, cursor: page.nextCursor }), { items: [second], nextCursor: null })
  await assert.rejects(api.listQuests({ cursor: page.nextCursor }), { code: 'INVALID_INPUT' })
  assert.deepEqual(await api.getQuest(first.questId), first)
  assert.deepEqual(await api.getHint({ questId: first.questId, index: 1, expectedVersion: first.version }),
    { questId: first.questId, index: 1, version: first.version, text: hints.get(first.questId)?.[0] })
  assert.deepEqual((await api.listAreas()).items, [area])
  assert.deepEqual((await api.listAreas({ bbox: [10, 10, 11, 11] })).items, [])
  await assert.rejects(api.getQuest(privateQuest.questId), { code: 'NOT_FOUND' })

  await current.doc(first.questId).update({ status: 'paused' })
  await current.doc(second.questId).update({ status: 'review_pending', publishedVersion: 2 })
  assert.deepEqual((await api.listQuests()).items, [])
  assert.equal((await api.listAreas()).items[0].publishedCount, 0)
  await assert.rejects(api.getQuest(first.questId), { code: 'NOT_FOUND' })
  await assert.rejects(api.getHint({ questId: first.questId, index: 1, expectedVersion: first.version }), { code: 'NOT_FOUND' })
  await assert.rejects(api.getQuest(second.questId), { code: 'NOT_FOUND' })

  const latest = { ...second, version: 2 }
  await catalog.doc(second.questId).set({ quest: latest, hints: ['公開版のヒント'] })
  assert.deepEqual(await api.getQuest(second.questId), latest)
  await assert.rejects(api.getHint({ questId: second.questId, index: 1, expectedVersion: second.version }), { code: 'QUEST_CHANGED' })
  assert.equal((await api.listAreas()).items[0].publishedCount, 1)
})
