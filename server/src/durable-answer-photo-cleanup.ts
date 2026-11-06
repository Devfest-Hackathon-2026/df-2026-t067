import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import type { DocumentSnapshot, Firestore } from 'firebase-admin/firestore'
import { ContractError } from '../../src/shared/api/validation'
import type { AnswerPhotoStorage, PhotoReference } from './answer-photo-storage'
import { HttpError, invalidInput } from './errors'
import { incomingAnswerPhotoPath, processingError, recordAnswerPhotoPath, storedAnswerResult, storedId,
  updateAnswerSnapshot, validDigest, validGeneration } from './firestore-answer-data'
import { parseId } from './query'

type CleanupPhotos = Pick<AnswerPhotoStorage, 'deleteIncoming' | 'deleteRecord'>
type CleanupOutcome = 'completed' | 'retrying' | 'stopped'

export async function runDueAnswerPhotoCleanup(db: Firestore, photos: CleanupPhotos,
  { maximumJobs, retryDelayMs }: { maximumJobs: number; retryDelayMs: number }) {
  if (!Number.isSafeInteger(maximumJobs) || maximumJobs < 1 || maximumJobs > 256 ||
    !Number.isSafeInteger(retryDelayMs) || retryDelayMs < 1) invalidInput()
  let due
  try {
    due = await db.collection('attempts').where('nextPhotoCleanupAt', '<=', Timestamp.now()).orderBy('nextPhotoCleanupAt')
      .limit(maximumJobs).select('state', 'result', 'digest', 'sourcePhoto', 'unusedRecordPhoto', 'nextPhotoCleanupAt').get()
  } catch { throw processingError(true) }
  const report = { completed: 0, retrying: 0, stopped: 0 }
  for (const snapshot of due.docs) report[await cleanupReceipt(snapshot, photos, retryDelayMs)]++
  return report
}

// Explicit recovery for older finished receipts or a previously stopped job.
export async function cleanupFinishedAnswerPhotos(db: Firestore, photos: CleanupPhotos, attemptId: string): Promise<boolean> {
  if (typeof attemptId !== 'string') invalidInput()
  const snapshot = await db.collection('attempts').doc(parseId(attemptId)).get()
  return await cleanupReceipt(snapshot, photos) === 'completed'
}

async function cleanupReceipt(snapshot: DocumentSnapshot, photos: CleanupPhotos, retryDelayMs?: number): Promise<CleanupOutcome> {
  const data = snapshot.data()
  if (!data || data.state !== 'COMPLETED') {
    if (data?.nextPhotoCleanupAt !== undefined) await updateAnswerSnapshot(snapshot, { nextPhotoCleanupAt: FieldValue.delete() })
    return 'stopped'
  }
  if (data.sourcePhoto === undefined && data.unusedRecordPhoto === undefined && data.nextPhotoCleanupAt === undefined) return 'completed'
  try {
    const attemptId = storedId(snapshot.id)
    const result = storedAnswerResult(data, attemptId)
    let unused: PhotoReference | undefined
    if (data.unusedRecordPhoto !== undefined) {
      if (result.outcome === 'CORRECT') throw processingError()
      unused = storedPhoto(data.unusedRecordPhoto, recordAnswerPhotoPath(attemptId))
    }
    if (data.sourcePhoto !== undefined) {
      const digest: unknown = data.digest
      if (!validDigest(digest)) throw processingError()
      const incoming = storedPhoto(data.sourcePhoto, incomingAnswerPhotoPath(attemptId, digest))
      await photos.deleteIncoming(attemptId, digest, incoming)
    }
    if (unused) await photos.deleteRecord(unused)
  } catch (error) {
    const retryable = error instanceof HttpError ? error.retryable : !(error instanceof ContractError)
    if (!retryable) await updateAnswerSnapshot(snapshot, { nextPhotoCleanupAt: FieldValue.delete() })
    else if (retryDelayMs !== undefined) {
      await updateAnswerSnapshot(snapshot, { nextPhotoCleanupAt: Timestamp.fromMillis(Date.now() + retryDelayMs) })
    }
    return retryable ? 'retrying' : 'stopped'
  }
  // Preserve the receipt and outcome. The generations can safely be deleted
  // again if another worker or a lost response interrupted this update.
  const updated = await updateAnswerSnapshot(snapshot, {
    sourcePhoto: FieldValue.delete(), unusedRecordPhoto: FieldValue.delete(), nextPhotoCleanupAt: FieldValue.delete(),
  })
  return updated ? 'completed' : 'retrying'
}

function storedPhoto(data: { path?: unknown; generation?: unknown } | null, path: string): PhotoReference {
  if (data?.path !== path || !validGeneration(data.generation)) throw processingError()
  return { path, generation: data.generation }
}
