import { FieldValue } from 'firebase-admin/firestore'
import type { Firestore } from 'firebase-admin/firestore'
import type { AnswerPhotoObject, AnswerPhotoStorage, IncomingPhotoObject } from './answer-photo-storage'
import { answerTransaction, incomingAnswerPhotoPath, processingError, recordAnswerPhotoPath, sealedIntakePhoto,
  storedAnswerResult, validDigest, validGeneration } from './firestore-answer-data'

type CleanupPhotos = Pick<AnswerPhotoStorage, 'listAnswerPhotos' | 'deleteIncoming' | 'deleteRecord'>

interface CleanupPage {
  before: number
  maximumPhotos: number
  cursor?: string
  signal?: AbortSignal
}

export async function runOrphanPhotoCleanup(db: Firestore, storage: CleanupPhotos, page: CleanupPage) {
  if (!Number.isSafeInteger(page.before) || !Number.isSafeInteger(page.maximumPhotos) || page.maximumPhotos < 1 || page.maximumPhotos > 256) {
    throw new Error('Invalid orphan photo cleanup limits.')
  }
  const { photos, cursor } = await storage.listAnswerPhotos(page.maximumPhotos, page.cursor)
  let deleted = 0
  let failed = 0
  for (const photo of photos) {
    if (page.signal?.aborted) break
    if (photo.createdAt >= page.before || !validCandidate(photo)) continue
    try {
      if (photo.kind === 'incoming') {
        if (!await sealOrphan(db, photo)) continue
        await storage.deleteIncoming(photo.attemptId, photo.digest, photo)
      } else {
        if (!await isUnusedRecord(db, photo.attemptId, photo.path)) continue
        await storage.deleteRecord(photo)
      }
      deleted++
    } catch {
      failed++
    }
  }
  return { cursor, deleted, failed }
}

export function createOrphanPhotoCleanup(db: Firestore, options: {
  storage: CleanupPhotos; minimumAgeMs: number; intervalMs: number
}, maximumPhotos: number, signal: AbortSignal) {
  const { storage, minimumAgeMs, intervalMs } = options
  if (![minimumAgeMs, intervalMs].every((value) => Number.isSafeInteger(value) && value > 0)) {
    throw new Error('Invalid orphan photo cleanup schedule.')
  }
  let nextAt = 0
  let cursor: string | undefined
  return async () => {
    const now = Date.now()
    if (now < nextAt) return
    nextAt = now + intervalMs
    const previous = cursor
    cursor = undefined
    const page = await runOrphanPhotoCleanup(db, storage, { before: now - minimumAgeMs, maximumPhotos, cursor: previous, signal })
    if (page.cursor && page.cursor === previous) throw processingError(true)
    cursor = page.cursor
    if (cursor) nextAt = 0
    if (page.failed) throw processingError(true)
  }
}

function validCandidate(photo: AnswerPhotoObject) {
  if (!validDigest(photo.attemptId) || !validGeneration(photo.generation) || !Number.isFinite(photo.createdAt)) return false
  return photo.kind === 'incoming'
    ? validDigest(photo.digest) && photo.path === incomingAnswerPhotoPath(photo.attemptId, photo.digest)
    : photo.path === recordAnswerPhotoPath(photo.attemptId)
}

async function isUnusedRecord(db: Firestore, attemptId: string, path: string) {
  const attempt = (await db.collection('attempts').doc(attemptId).get()).data()
  if (attempt?.state !== 'COMPLETED' || attempt.unusedRecordPhoto !== undefined || !validDigest(attempt.digest)) return false
  const { outcome } = storedAnswerResult(attempt, attemptId)
  // An invalidated receipt is terminal. A worker cannot publish this photo
  // after the check, and an existing reference always takes precedence.
  if (outcome !== 'QUEST_UNAVAILABLE' && outcome !== 'QUEST_CHANGED') return false
  return (await db.collection('discoveries').where('photoObject.path', '==', path).limit(1).get()).empty
}

function sealOrphan(db: Firestore, { attemptId, digest }: IncomingPhotoObject) {
  return answerTransaction(db, async (tx) => {
    const attempt = (await tx.get(db.collection('attempts').doc(attemptId))).data()
    if (attempt) {
      return validDigest(attempt.digest) &&
        (attempt.digest !== digest || (attempt.state === 'COMPLETED' && attempt.sourcePhoto === undefined))
    }
    const marker = sealedIntakePhoto(db, attemptId)
    if (!(await tx.get(marker)).exists) tx.create(marker, { sealedAt: FieldValue.serverTimestamp() })
    return true
  })
}
