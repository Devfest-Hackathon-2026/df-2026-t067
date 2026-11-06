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
import { createFirebaseVerifier } from './firebase-auth'
import { FirestoreManagedDraftStore } from './firestore-managed-drafts'
import { FirestoreOrgAssetStore } from './firestore-org-assets'

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
    const server = createDurableAnswerServer({
      db, photos, verifier, teamPreview: { allowedUids: config.allowedUids, webDirectory },
      assets: new FirestoreOrgAssetStore(db, photos), drafts: new FirestoreManagedDraftStore(db), publication: photos,
      photoTest: { matcher: await createFixturePhotoMatcher(), source: 'mock' },
      suggestDraft: { source: 'mock', suggest: await createFixtureDraftSuggester() },
      challengePolicy: policy, answerPolicy: policy, acquireUpload: (uid) => uploadLimiter.acquire(uid),
    })
    return { server, close, label: 'TEAM PREVIEW, synthetic fixtures' }
  } catch (error) {
    await close().catch(() => {})
    if (error instanceof Error && error.message.startsWith('The team-preview bucket')) throw error
    throw new Error('Team preview startup failed; check the approved private bucket and runtime access.')
  }
}
