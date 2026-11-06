import { FieldValue } from 'firebase-admin/firestore'
import type { Firestore } from 'firebase-admin/firestore'
import type { AnswerPhotoStorage, IncomingPhotoObject } from './answer-photo-storage'
import { answerTransaction, incomingAnswerPhotoPath, processingError, sealedIntakePhoto, validDigest, validGeneration } from './firestore-answer-data'

type CleanupPhotos = Pick<AnswerPhotoStorage, 'listIncomingPhotos' | 'deleteIncoming'>

interface CleanupPage {
  before: number
  maximumPhotos: number
  cursor?: string
  signal?: AbortSignal
}

export async function runIntakePhotoCleanup(db: Firestore, storage: CleanupPhotos, page: CleanupPage) {
  if (!Number.isSafeInteger(page.before) || !Number.isSafeInteger(page.maximumPhotos) || page.maximumPhotos < 1 || page.maximumPhotos > 256) {
    throw new Error('Invalid intake photo cleanup limits.')
  }
  const { photos, cursor } = await storage.listIncomingPhotos(page.maximumPhotos, page.cursor)
  let deleted = 0
  let failed = 0
  for (const photo of photos) {
    if (page.signal?.aborted) break
    if (photo.createdAt >= page.before || !validCandidate(photo)) continue
    try {
      if (await sealOrphan(db, photo)) {
        await storage.deleteIncoming(photo.attemptId, photo.digest, photo)
        deleted++
      }
    } catch {
      failed++
    }
  }
  return { cursor, deleted, failed }
}

export function createIntakePhotoCleanup(db: Firestore, options: {
  storage: CleanupPhotos; minimumAgeMs: number; intervalMs: number
}, maximumPhotos: number, signal: AbortSignal) {
  const { storage, minimumAgeMs, intervalMs } = options
  if (![minimumAgeMs, intervalMs].every((value) => Number.isSafeInteger(value) && value > 0)) {
    throw new Error('Invalid intake photo cleanup schedule.')
  }
  let nextAt = 0
  let cursor: string | undefined
  return async () => {
    const now = Date.now()
    if (now < nextAt) return
    nextAt = now + intervalMs
    const previous = cursor
    cursor = undefined
    const page = await runIntakePhotoCleanup(db, storage, { before: now - minimumAgeMs, maximumPhotos, cursor: previous, signal })
    if (page.cursor && page.cursor === previous) throw processingError(true)
    cursor = page.cursor
    if (cursor) nextAt = 0
    if (page.failed) throw processingError(true)
  }
}

function validCandidate(photo: IncomingPhotoObject) {
  return validDigest(photo.attemptId) && validDigest(photo.digest) && validGeneration(photo.generation) &&
    Number.isFinite(photo.createdAt) && photo.path === incomingAnswerPhotoPath(photo.attemptId, photo.digest)
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
