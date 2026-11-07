import { readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Storage } from '@google-cloud/storage'
import { deleteApp, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { AnswerPhotoStorage } from './answer-photo-storage'
import { DemoAnswerStore } from './answers'
import { teamPreviewDatabase, type TeamPreviewConfig } from './config'
import { createFixtureDraftSuggester } from './demo-draft-suggestions'
import { createFixturePhotoMatcher } from './demo-photo-test'
import { createDurableAnswerServer } from './durable-answer-http'
import { createDurableAnswerRuntime } from './durable-answer-runtime'
import { createFirebaseVerifier } from './firebase-auth'
import { FirestoreManagedDraftStore } from './firestore-managed-drafts'
import { FirestoreOrgAssetStore } from './firestore-org-assets'
import { createPublishedAnswerMaterialLoader } from './published-answer-material'
import { createVertexPhotoMatcher } from './vertex-match'
import { createFirestoreVertexTrialTransport } from './vertex-trial-firestore'

// Trial location limits for the answer trial. These mirror the durable-local
// trial values; the production values remain undecided (decisions O-03) and
// the per-quest shooting zones themselves come from the published material.
const teamTrialLocationLimits = { maxAccuracyMeters: 50, maxAgeMs: 120_000, maxFutureSkewMs: 5000, maxCaptureMeasurementGapMs: 30_000 }

export async function createTeamPreviewRuntime(config: TeamPreviewConfig) {
  const webDirectory = resolve('dist-team-preview')
  const webProjectId = await readFile(resolve(webDirectory, '.firebase-project'), 'utf8').catch(() => '')
  if (webProjectId.trim() !== config.firebaseProjectId || !(await stat(resolve(webDirectory, 'index.html')).catch(() => null))?.isFile()) {
    throw new Error('Build the team-preview Web app before starting the API.')
  }
  const projectId = config.firebaseProjectId
  const app = initializeApp({ projectId }, 'quest-team-preview')
  const verifier = createFirebaseVerifier(projectId, undefined, true)
  const close = async () => { await Promise.all([verifier.close(), deleteApp(app)]) }
  try {
    const db = getFirestore(app, teamPreviewDatabase)
    const bucketName = projectId + '-' + teamPreviewDatabase
    const bucket = new Storage({ projectId, retryOptions: { totalTimeout: 10 } }).bucket(bucketName)
    const [metadata] = await bucket.getMetadata()
    if (metadata.name !== bucketName || String(metadata.projectNumber) !== config.projectNumber ||
      metadata.iamConfiguration?.publicAccessPrevention !== 'enforced' ||
      metadata.iamConfiguration?.uniformBucketLevelAccess?.enabled !== true) {
      throw new Error('The team-preview bucket must belong to the approved project and block public access.')
    }
    const photos = new AnswerPhotoStorage(bucket)
    const policy = { maximum: 10, windowMs: 60_000 }
    const uploadLimiter = new DemoAnswerStore()
    const shared = {
      db, photos, verifier, teamPreview: { allowedUids: config.allowedUids, webDirectory },
      assets: new FirestoreOrgAssetStore(db, photos), drafts: new FirestoreManagedDraftStore(db), publication: photos,
      photoTest: { matcher: await createFixturePhotoMatcher(), source: 'mock' as const },
      suggestDraft: { source: 'mock' as const, suggest: await createFixtureDraftSuggester() },
      challengePolicy: policy, answerPolicy: policy, acquireUpload: (uid: string) => uploadLimiter.acquire(uid),
    }
    if (!config.answerTrial) {
      const server = createDurableAnswerServer(shared)
      return { server, close, label: 'TEAM PREVIEW, synthetic fixtures' }
    }
    // Answer trial: the invited accounts run the traveler flow against real
    // Vertex matching. Admin photo tests stay on the fixture matcher so they
    // never consume the shared D-13 send allowance; only traveler answers do.
    const matcher = createVertexPhotoMatcher(createFirestoreVertexTrialTransport(db))
    const material = createPublishedAnswerMaterialLoader(db, photos, teamTrialLocationLimits)
    const runtime = createDurableAnswerRuntime({
      ...shared, answerTrial: true,
      worker: { ...material, leaseDurationMs: 180_000, authorize: verifier.isActiveUser, matcher, matchTimeoutMs: 30_000 },
      maintenance: { intervalMs: 1000, maximumJobs: 8, retryDelayMs: 5000,
        orphanPhotos: { storage: photos, minimumAgeMs: 300_000, intervalMs: 60_000 },
        onFailure: (pass) => { console.error('Team preview maintenance failed: ' + pass) } },
    })
    return { ...runtime, close, label: 'TEAM PREVIEW, synthetic fixtures; ANSWER TRIAL, real Vertex matching' }
  } catch (error) {
    await close().catch(() => {})
    if (error instanceof Error && error.message.startsWith('The team-preview bucket')) throw error
    throw new Error('Team preview startup failed; check the approved private bucket and runtime access.')
  }
}
