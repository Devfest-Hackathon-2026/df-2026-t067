import { Storage } from '@google-cloud/storage'
import { deleteApp, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { AnswerPhotoStorage } from './answer-photo-storage'
import { DemoAnswerStore } from './answers'
import type { DurableLocalConfig } from './config'
import { createDemoLocationValidation } from './demo-location'
import { createFixturePhotoMatcher, syntheticPng } from './demo-photo-test'
import { createDurableAnswerRuntime } from './durable-answer-runtime'
import { createFirebaseVerifier } from './firebase-auth'
import { processingError } from './firestore-answer-data'
import { preparePhoto } from './photo-input'

const projectId = 'demo-t067-durable-local'
const questId = 'demo-quest'
const placeId = 'demo-durable-place'
const version = 1

export async function createDurableLocalRuntime(config: DurableLocalConfig) {
  const app = initializeApp({ projectId }, 'quest-durable-local')
  const verifier = createFirebaseVerifier(config.firebaseProjectId, undefined, true)
  const close = async () => { await Promise.all([verifier.close(), deleteApp(app)]) }
  try {
    const db = getFirestore(app)
    // The emulator uses an insecure loopback channel. Supplying the SDK's
    // default domain also avoids discovering a domain through cloud ADC.
    db.settings({ universeDomain: 'googleapis.com' })
    const bucket = new Storage({ projectId, apiEndpoint: config.storageEndpoint,
      retryOptions: { totalTimeout: 10 } }).bucket(projectId + '.appspot.com')
    if (!(await bucket.exists())[0]) throw new Error('Local bucket missing.')
    const quest = db.collection('quests').doc(questId)
    const published = db.collection('questVersions').doc(questId + ':' + version)
    await db.runTransaction(async (tx) => {
      const [current, snapshot] = await tx.getAll(quest, published)
      if (current.exists && snapshot.get('placeId') === placeId) return
      if (current.exists || snapshot.exists) throw new Error('Local fixture is inconsistent.')
      tx.create(quest, { publishedVersion: version, status: 'published' })
      tx.create(published, { placeId, areaId: 'demo-area', placeName: '架空の対象',
        descriptionSnapshot: '永続APIの確認用に作った架空の記録です。', revealedLocation: { latitude: 0, longitude: 0 } })
    })
    const location = createDemoLocationValidation().policyFor(questId, version)
    if (!location) throw new Error('Local capture zone missing.')
    const reference = await preparePhoto({ bytes: syntheticPng, mimeType: 'image/png' })
    const matcher = await createFixturePhotoMatcher()
    const uploadLimiter = new DemoAnswerStore()
    const policy = { maximum: 10, windowMs: 60_000 }
    const runtime = createDurableAnswerRuntime({
      db, photos: new AnswerPhotoStorage(bucket), verifier, dataMode: config.mode,
      challengePolicy: policy, answerPolicy: policy, acquireUpload: (uid) => uploadLimiter.acquire(uid),
      worker: {
        leaseDurationMs: 180_000, authorize: verifier.isActiveUser, matcher,
        async locationPolicy(target) {
          if (target.questId !== questId || target.version !== version || target.placeId !== placeId) throw processingError()
          return location
        },
        async loadReference() { return { reference, features: ['合成の確認済み特徴'] } },
      },
      maintenance: { intervalMs: 1000, maximumJobs: 8, retryDelayMs: 5000,
        onFailure: (pass) => { console.error('Durable local maintenance failed: ' + pass) } },
    })
    return { ...runtime, close, label: 'DURABLE LOCAL; synthetic quest and matcher' }
  } catch {
    await close().catch(() => {})
    throw new Error('Durable local startup failed. Check the loopback emulators, bucket and local fixture.')
  }
}
