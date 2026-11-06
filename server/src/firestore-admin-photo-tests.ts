import { createHash } from 'node:crypto'
import type { DocumentData, DocumentReference, Firestore, Transaction } from 'firebase-admin/firestore'
import { parsePhotoTestResult } from '../../src/shared/api/admin'
import type { PhotoTestResult } from '../../src/shared/api/admin'
import { photoTestKey } from './admin-photo-tests'
import type { PhotoTestRequest, PhotoTestWork } from './admin-photo-tests'
import { HttpError, invalidInput } from './errors'
import { answerTransaction, processingError, validDigest } from './firestore-answer-data'
import type { FirestoreManagedDraftStore } from './firestore-managed-drafts'
import { readOrgAssetRecord } from './firestore-org-assets'
import { photoSystemError } from './photo-match'

const maximumPhotoTests = 128
const pendingMs = 60_000
const failureStatus = { INVALID_INPUT: 400, MEDIA_TOO_LARGE: 413, FORBIDDEN: 403, NOT_FOUND: 404, DRAFT_CONFLICT: 409, SYSTEM_ERROR: 503 } as const
type Reservation = { result: PhotoTestResult } | { deadline: number; referenceAssetId: string; referenceGeneration: string }

export class FirestorePhotoTestStore {
  constructor(private readonly db: Firestore, private readonly drafts: FirestoreManagedDraftStore) {}

  async execute(input: PhotoTestRequest, digest: string, work: PhotoTestWork) {
    const jobId = createHash('sha256').update(photoTestKey(input)).digest('hex')
    const job = this.db.collection('adminPhotoTestJobs').doc(jobId)
    const started = await this.reserve(job, input, digest)
    if ('result' in started) return started.result

    try {
      const { result, photoDigest } = await work((matcher) => matcher)
      const checked = checkedResult(result, input)
      if (!validDigest(photoDigest)) throw processingError()
      const proof = this.db.collection('adminPhotoTestEvidence').doc(checked.testId)
      return await answerTransaction(this.db, async (tx) => {
        const current = await this.readReference(tx, input)
        if (current.referenceAssetId !== started.referenceAssetId || current.referenceGeneration !== started.referenceGeneration) throw processingError()
        if (Date.now() >= started.deadline) throw photoSystemError(false)
        tx.create(proof, { ...checked, ...current, photoDigest })
        tx.update(job, { state: 'completed', result: checked })
        return checked
      })
    } catch (error) {
      const failure = error instanceof HttpError ? error : photoSystemError()
      await this.fail(job, failure).catch(() => {})
      throw failure
    }
  }

  private reserve(job: DocumentReference, input: PhotoTestRequest, digest: string): Promise<Reservation> {
    return answerTransaction(this.db, async (tx) => {
      const reference = await this.readReference(tx, input)
      const prior = (await tx.get(job)).data()
      if (prior) {
        if (prior.digest !== digest) throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', '同じ試験キーで異なる内容は送信できません。')
        if (prior.referenceAssetId !== reference.referenceAssetId || prior.referenceGeneration !== reference.referenceGeneration) throw processingError()
        if (prior.state === 'completed') return { result: checkedResult(prior.result, input) }
        if (prior.state === 'failed') throw storedFailure(prior)
        if (prior.state !== 'pending' || !Number.isSafeInteger(prior.deadline)) throw processingError()
        // An expired request remains reserved. A retry with the same key
        // cannot send a second provider request after a process crash.
        if (Date.now() >= prior.deadline) throw photoSystemError(false)
        throw new HttpError(429, 'RATE_LIMITED', '写真試験の処理中です。時間をおいて再送してください。', true, 1)
      }

      const usage = this.db.collection('adminPhotoTestUsage').doc('global')
      const snapshot = await tx.get(usage)
      const count: unknown = snapshot.exists ? snapshot.get('count') : 0
      if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) throw processingError()
      if (count >= maximumPhotoTests) throw new HttpError(429, 'RATE_LIMITED', '開発用写真試験の上限に達しました。')
      const deadline = Date.now() + pendingMs
      tx.create(job, { digest, deadline, ...reference, state: 'pending' })
      tx.set(usage, { count: count + 1 })
      return { deadline, ...reference }
    })
  }

  private async readReference(tx: Transaction, input: PhotoTestRequest) {
    const quest = await this.drafts.readAtRevision(tx, input.uid, input.orgId, input.questId, input.draftRevision)
    const referenceAssetId = quest.draft.referenceAssetId
    if (!referenceAssetId) invalidInput()
    const ref = this.db.collection('orgAssets').doc(referenceAssetId)
    const asset = readOrgAssetRecord(await tx.get(ref), input.orgId)
    if (!asset?.generation || asset.asset.purpose !== 'reference') invalidInput()
    return { referenceAssetId, referenceGeneration: asset.generation }
  }

  private fail(job: DocumentReference, error: HttpError) {
    return answerTransaction(this.db, async (tx) => {
      if ((await tx.get(job)).get('state') !== 'pending') return
      const failureCode = Object.hasOwn(failureStatus, error.code) ? error.code : 'SYSTEM_ERROR'
      tx.update(job, { state: 'failed', failureCode, retryable: error.retryable })
    })
  }
}

function checkedResult(value: unknown, input: PhotoTestRequest) {
  const result = parsePhotoTestResult(value)
  if (result.orgId !== input.orgId || result.questId !== input.questId || result.draftRevision !== input.draftRevision) throw processingError()
  return result
}

function storedFailure(job: DocumentData): HttpError {
  const code = job.failureCode as keyof typeof failureStatus
  if (!Object.hasOwn(failureStatus, code) || typeof job.retryable !== 'boolean') return processingError()
  return new HttpError(failureStatus[code], code, '写真の確認を完了できませんでした。', job.retryable)
}
