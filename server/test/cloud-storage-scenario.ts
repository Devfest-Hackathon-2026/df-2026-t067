import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import type { Bucket } from '@google-cloud/storage'
import type { Firestore } from 'firebase-admin/firestore'
import type { TestContext } from 'node:test'
import { createApiClient } from '../../src/shared/api/client'
import { AnswerPhotoStorage } from '../src/answer-photo-storage'
import type { PhotoReference } from '../src/answer-photo-storage'
import { createFixturePhotoMatcher, durableFixtureFeatures, syntheticPng } from '../src/demo-photo-test'
import { createDurableAnswerServer } from '../src/durable-answer-http'
import { cleanupFinishedAnswerPhotos } from '../src/durable-answer-photo-cleanup'
import { runDurableAnswer } from '../src/durable-answer-worker'
import { unauthenticated } from '../src/errors'
import type { AnswerIdentity } from '../src/firestore-answer-processing'
import { preparePhoto } from '../src/photo-input'
import { createPublishedAnswerMaterialLoader } from '../src/published-answer-material'
import { listenServer } from './helpers'

export async function exerciseAnswerStorage(t: TestContext, db: Firestore, bucket: Bucket) {
  const run = randomUUID()
  t.diagnostic('合成試験ID ' + run)
  const owner = 'owner-' + run
  const outsider = 'outsider-' + run
  const ownerToken = randomUUID(), outsiderToken = randomUUID()
  const tokens = new Map<string, string>([[ownerToken, owner], [outsiderToken, outsider]])
  const questId = 'quest-' + run
  const areaId = 'area-' + run
  const orgId = 'org-' + run
  const photos = new AnswerPhotoStorage(bucket)
  const prepared = await preparePhoto({ bytes: syntheticPng, mimeType: 'image/png' })
  const reference = await photos.writeReference(orgId, 'reference', prepared)
  t.after(async () => {
    try {
      await bucket.file(reference.path, { generation: reference.generation })
        .delete({ ifGenerationMatch: reference.generation, ignoreNotFound: true })
    } catch { throw new Error('合成参考画像の世代指定削除に失敗しました。') }
  })

  const version = 1
  await db.batch()
    .create(db.collection('quests').doc(questId), { orgId, publishedVersion: version, status: 'published' })
    .create(db.collection('questVersions').doc(questId + ':1'), {
      placeId: 'place-' + run, areaId, placeName: '合成の対象', descriptionSnapshot: '保存の検証用',
      revealedLocation: { latitude: 0, longitude: 0 },
      answerMaterial: {
        orgId, referenceAssetId: 'reference', referenceGeneration: reference.generation,
        features: [...durableFixtureFeatures], zones: [{ latitude: 0, longitude: 0, radiusMeters: 100 }],
      },
    }).commit()

  let work: AnswerIdentity | undefined
  const policy = { maximum: 4, windowMs: 60_000 }
  const server = createDurableAnswerServer({
    db, photos, challengePolicy: policy, answerPolicy: policy, acquireUpload: () => () => {},
    verifier: { verify: async (token) => {
      const uid = tokens.get(token)
      if (!uid) throw unauthenticated()
      return { uid }
    } },
    enqueue: async (input) => { work = input },
  })
  const { base } = await listenServer(t, server)
  const client = (token: string) => createApiClient({ getIdToken: async () => token,
    fetch: (path, init) => fetch(base + String(path), init) })
  const api = client(ownerToken)
  const other = client(outsiderToken)
  const challenge = await api.createChallenge({ questId, expectedVersion: version })
  const capturedAt = new Date().toISOString()
  const input = {
    challengeId: challenge.challengeId, idempotencyKey: randomUUID(),
    photo: new Blob([new Uint8Array(syntheticPng)], { type: 'image/png' }),
    metadata: { capturedAt, position: { latitude: 0, longitude: 0, accuracyMeters: 5, measuredAt: capturedAt } },
  }
  const [receipt, duplicate] = await Promise.all([api.submitAnswer(input), api.submitAnswer(input)])
  assert.equal(receipt.state, 'RECEIVED')
  assert.equal(duplicate.attemptId, receipt.attemptId)
  assert(work && work.attemptId === receipt.attemptId)
  t.diagnostic('同時再送を同じ受付に集約')
  const attempt = db.collection('attempts').doc(receipt.attemptId)
  const source = (await attempt.get()).get('sourcePhoto') as PhotoReference

  const processed = await runDurableAnswer(work, {
    db, photos, authorize: async (uid) => uid === owner, leaseDurationMs: 180_000,
    matcher: await createFixturePhotoMatcher(),
    ...createPublishedAnswerMaterialLoader(db, photos, {
      maxAccuracyMeters: 30, maxAgeMs: 60_000, maxFutureSkewMs: 5000, maxCaptureMeasurementGapMs: 10_000,
    }),
  })
  assert(processed.kind === 'completed' && processed.result.outcome === 'CORRECT')
  const id = processed.result.optionalDiscoveryId
  const record = (await db.collection('discoveries').doc(id).get()).get('photoObject') as PhotoReference
  assert.deepEqual(await api.submitAnswer(input), processed.result)
  assert.deepEqual((await api.listDiscoveries()).items.map((item) => item.discoveryId), [id])
  assert.deepEqual((await api.listDiscoveries({ areaId })).items.map((item) => item.discoveryId), [id])
  assert.equal((await other.listDiscoveries()).items.length, 0)
  assert.deepEqual(Buffer.from(await (await api.getDiscoveryPhoto(id)).arrayBuffer()), prepared.bytes)
  await assert.rejects(other.getDiscoveryPhoto(id), { code: 'NOT_FOUND' })
  await assert.rejects(other.deleteDiscovery(id), { code: 'NOT_FOUND' })
  t.diagnostic('初回記録、2種類の一覧、本人だけの写真取得を確認')

  assert.equal(await cleanupFinishedAnswerPhotos(db, photos, receipt.attemptId), true)
  assert.equal((await bucket.file(source.path, { generation: source.generation }).exists())[0], false)
  const deletion = await api.deleteDiscovery(id)
  assert.equal((await api.getDeletion(deletion.deletionId)).state, 'completed')
  await assert.rejects(api.getDiscoveryPhoto(id), { code: 'NOT_FOUND' })
  assert.equal((await bucket.file(record.path, { generation: record.generation }).exists())[0], false)
  t.diagnostic('受付JPEGと本人記録JPEGの世代指定削除を確認')
}
