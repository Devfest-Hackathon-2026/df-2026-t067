import { Storage } from '@google-cloud/storage'
import { deleteApp, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { AnswerPhotoStorage } from './answer-photo-storage'
import { DemoAnswerStore } from './answers'
import type { DurableLocalConfig } from './config'
import { createDemoData } from './demo-data'
import { createDemoLocationValidation } from './demo-location'
import { createFixturePhotoMatcher, durableFixtureFeatures, syntheticPng } from './demo-photo-test'
import { createDurableAnswerRuntime } from './durable-answer-runtime'
import { createSyntheticVertexTrialMatcher } from './durable-vertex-trial'
import { createFirebaseVerifier } from './firebase-auth'
import { FirestoreManagedDraftStore } from './firestore-managed-drafts'
import { FirestoreOrgAssetStore } from './firestore-org-assets'
import { preparePhoto } from './photo-input'
import { createPublishedAnswerMaterialLoader } from './published-answer-material'
import { createVertexTrialTransport } from './vertex-transport'

const projectId = 'demo-t067-durable-local'
const questId = 'demo-quest'
const placeId = 'demo-durable-place'
const orgId = 'demo-org'
const referenceAssetId = 'demo-durable-reference'
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
    const photos = new AnswerPhotoStorage(bucket)
    const location = createDemoLocationValidation().policyFor(questId, version)
    if (!location) throw new Error('Local capture zone missing.')
    const { zones, ...locationLimits } = location
    const reference = await preparePhoto({ bytes: syntheticPng, mimeType: 'image/png' })
    const { generation: referenceGeneration } = await photos.writeReference(orgId, referenceAssetId, reference)
    const answerMaterial = { orgId, referenceAssetId, referenceGeneration, features: [...durableFixtureFeatures], zones: [...zones] }
    const quest = db.collection('quests').doc(questId)
    const published = db.collection('questVersions').doc(questId + ':' + version)
    const catalog = createDemoData()
    const publicQuest = catalog.quests.find((item) => item.questId === questId && item.version === version)
    const publicArea = catalog.areas.find((item) => item.areaId === publicQuest?.areaId)
    if (!publicQuest || !publicArea) throw new Error('Local catalog fixture missing.')
    const area = db.collection('areas').doc(publicArea.areaId)
    const projection = db.collection('questPublic').doc(questId)
    await db.runTransaction(async (tx) => {
      const [current, snapshot, areaDoc, publicDoc] = await tx.getAll(quest, published, area, projection)
      const savedOrg = current.get('orgId')
      const savedMaterial = snapshot.get('answerMaterial')
      if (current.exists !== snapshot.exists || (snapshot.exists && snapshot.get('placeId') !== placeId) ||
        (savedOrg !== undefined && savedOrg !== orgId) || (savedMaterial !== undefined &&
        (savedMaterial?.orgId !== orgId || savedMaterial.referenceAssetId !== referenceAssetId ||
          savedMaterial.referenceGeneration !== referenceGeneration))) {
        throw new Error('Local fixture is inconsistent.')
      }
      if (!current.exists) {
        tx.create(quest, { publishedVersion: version, status: 'published', orgId })
        tx.create(published, { placeId, areaId: publicArea.areaId, placeName: '架空の対象',
          descriptionSnapshot: '永続APIの確認用に作った架空の記録です。', revealedLocation: { latitude: 0, longitude: 0 }, answerMaterial })
      } else {
        // Older local fixtures have no private reference fields yet.
        if (savedOrg === undefined) tx.update(quest, { orgId })
        if (savedMaterial === undefined) tx.update(published, { answerMaterial })
      }
      if (!areaDoc.exists) tx.create(area, { label: publicArea.label, marker: publicArea.marker,
        publicGeometryJson: JSON.stringify(publicArea.publicGeometry) })
      if (!publicDoc.exists) tx.create(projection, { quest: publicQuest, hints: catalog.hints.get(questId) ?? [] })
    })
    const material = createPublishedAnswerMaterialLoader(db, photos, locationLimits)
    const ledger = config.vertexTrialLedger
    const matcher = ledger ? await createSyntheticVertexTrialMatcher(createVertexTrialTransport(ledger)) : await createFixturePhotoMatcher()
    const uploadLimiter = new DemoAnswerStore()
    const policy = { maximum: 10, windowMs: 60_000 }
    const runtime = createDurableAnswerRuntime({
      db, photos, verifier, dataMode: config.mode,
      assets: new FirestoreOrgAssetStore(db, photos), drafts: new FirestoreManagedDraftStore(db),
      photoTest: { matcher, source: ledger ? 'real' : 'mock', timeoutMs: ledger ? 30_000 : undefined },
      publication: photos,
      challengePolicy: policy, answerPolicy: policy, acquireUpload: (uid) => uploadLimiter.acquire(uid),
      worker: { ...material, leaseDurationMs: 180_000, authorize: verifier.isActiveUser, matcher, matchTimeoutMs: ledger ? 30_000 : undefined },
      maintenance: { intervalMs: 1000, maximumJobs: 8, retryDelayMs: 5000,
        intakePhotos: { storage: photos, minimumAgeMs: 300_000, intervalMs: 60_000 },
        onFailure: (pass) => { console.error('Durable local maintenance failed: ' + pass) } },
    })
    return { ...runtime, close, label: ledger ? 'DURABLE LOCAL, synthetic Vertex trial' : 'DURABLE LOCAL, synthetic fixture matcher' }
  } catch {
    await close().catch(() => {})
    throw new Error('Durable local startup failed. Check the loopback emulators, bucket and local fixture.')
  }
}
