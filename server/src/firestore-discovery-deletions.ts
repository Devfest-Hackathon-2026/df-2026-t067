import { createHash } from 'node:crypto'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import type { DocumentData, DocumentReference, Firestore } from 'firebase-admin/firestore'
import type { DeletionReceipt, DeletionStatus } from '../../src/shared/api/types'
import { parseDeletionStatus } from '../../src/shared/api/validation'
import type { AnswerPhotoStorage } from './answer-photo-storage'
import { HttpError, invalidInput } from './errors'
import { answerTransaction, discoveryKeyId, processingError, storedId, validAnswerUid,
  validGeneration, validRecordPhotoPath } from './firestore-answer-data'
import { parseId } from './query'

type DeletionPhotos = Pick<AnswerPhotoStorage, 'deleteRecord'>

export async function requestDiscoveryDeletion(db: Firestore, photos: DeletionPhotos, uid: string, discoveryId: string): Promise<DeletionReceipt | null> {
  if (!validAnswerUid(uid) || typeof discoveryId !== 'string') invalidInput()
  const record = db.collection('discoveries').doc(parseId(discoveryId))
  const deletionId = createHash('sha256').update(JSON.stringify([uid, discoveryId])).digest('hex')
  const receipt = db.collection('discoveryDeletions').doc(deletionId)
  const accepted = await answerTransaction(db, async (tx) => {
    const [previous, stored] = await tx.getAll(receipt, record)
    const replay = previous.data()
    if (replay) return replay.uid === uid
    const data = stored.data()
    if (!data || data.uid !== uid) return false
    if (data.discoveryId !== discoveryId) throw processingError()
    const photoObject = recordPhoto(data)
    const key = db.collection('discoveryKeys').doc(discoveryKeyId(uid, storedId(data.placeId)))
    const mapping = (await tx.get(key)).data()
    // Old records used the uniqueness key as the record ID.
    if (mapping ? mapping.discoveryId !== discoveryId : key.id !== discoveryId) throw processingError()
    tx.create(receipt, { uid, photoObject, state: 'pending', retryable: false, nextDeleteAt: FieldValue.serverTimestamp() })
    tx.delete(record)
    tx.set(key, { deletedAt: FieldValue.serverTimestamp() })
    return true
  })
  if (!accepted) return null
  await completeDeletion(db, photos, receipt)
  return { deletionId }
}

export async function getDiscoveryDeletion(db: Firestore, uid: string, deletionId: string): Promise<DeletionStatus | null> {
  if (!validAnswerUid(uid) || typeof deletionId !== 'string') invalidInput()
  const receipt = db.collection('discoveryDeletions').doc(parseId(deletionId))
  const data = (await receipt.get()).data()
  return data?.uid === uid ? deletionStatus(data, deletionId) : null
}

export async function runDueDiscoveryDeletions(db: Firestore, photos: DeletionPhotos,
  { maximumJobs, retryDelayMs, signal }: { maximumJobs: number; retryDelayMs: number; signal?: AbortSignal }): Promise<number> {
  if (!Number.isSafeInteger(maximumJobs) || maximumJobs < 1 || maximumJobs > 256 ||
    !Number.isSafeInteger(retryDelayMs) || retryDelayMs < 1) invalidInput()
  if (signal?.aborted) return 0
  const due = await db.collection('discoveryDeletions').where('nextDeleteAt', '<=', Timestamp.now())
    .orderBy('nextDeleteAt').limit(maximumJobs).select('state').get()
  let completed = 0
  for (const job of due.docs) {
    if (signal?.aborted) break
    if (await completeDeletion(db, photos, job.ref, retryDelayMs)) completed++
  }
  return completed
}

async function completeDeletion(db: Firestore, photos: DeletionPhotos, receipt: DocumentReference, retryDelayMs?: number): Promise<boolean> {
  const snapshot = await receipt.get()
  const data = snapshot.data()
  if (!data) return false
  const previous = deletionStatus(data, receipt.id)
  if (previous.state === 'completed') return true
  if (previous.state === 'failed' && !previous.retryable) return false
  let failure: HttpError | undefined
  try { await photos.deleteRecord(recordPhoto(data)) }
  catch (error) { failure = error instanceof HttpError ? error : processingError(true) }

  return answerTransaction(db, async (tx) => {
    const fresh = await tx.get(receipt)
    const current = fresh.data()
    if (!current || current.uid !== data.uid) throw processingError()
    if (deletionStatus(current, receipt.id).state === 'completed') return true
    if (current.photoObject?.path !== data.photoObject?.path || current.photoObject?.generation !== data.photoObject?.generation) {
      throw processingError()
    }
    if (failure) {
      // A late failed attempt cannot overwrite a newer worker's outcome.
      if (!snapshot.updateTime || !fresh.updateTime?.isEqual(snapshot.updateTime)) return false
      const update: { state: 'failed'; retryable: boolean; nextDeleteAt?: Timestamp | FieldValue } = {
        state: 'failed', retryable: failure.retryable,
      }
      if (!failure.retryable) update.nextDeleteAt = FieldValue.delete()
      else if (retryDelayMs !== undefined) update.nextDeleteAt = Timestamp.fromMillis(Date.now() + retryDelayMs)
      tx.update(receipt, update)
      return false
    }
    tx.update(receipt, { state: 'completed', retryable: false, photoObject: FieldValue.delete(), nextDeleteAt: FieldValue.delete() })
    return true
  })
}

function recordPhoto(data: DocumentData): { path: string; generation: string } {
  const { path, generation } = data.photoObject ?? {}
  if (!validRecordPhotoPath(path) || !validGeneration(generation)) throw processingError()
  return { path, generation }
}

function deletionStatus(data: DocumentData, deletionId: string): DeletionStatus {
  return parseDeletionStatus({ deletionId, state: data.state, retryable: data.retryable })
}
