import { createHash } from 'node:crypto'
import { Timestamp } from 'firebase-admin/firestore'
import type { Firestore, Transaction } from 'firebase-admin/firestore'
import { HttpError, invalidInput } from './errors'
import { processingError } from './firestore-answer-data'

export interface AdmissionPolicy { maximum: number; windowMs: number }

export function validateAdmissionPolicy(policy: AdmissionPolicy): void {
  if (!Number.isSafeInteger(policy.maximum) || policy.maximum < 1 ||
    !Number.isSafeInteger(policy.windowMs) || policy.windowMs < 1) invalidInput()
}

export async function readAdmission(db: Firestore, tx: Transaction, collection: 'answerAdmission' | 'challengeAdmission',
  uid: string, policy: AdmissionPolicy) {
  const ref = db.collection(collection).doc(createHash('sha256').update(uid).digest('hex'))
  const snapshot = await tx.get(ref)
  const data = snapshot.data()
  if (!data) return { ref, windowStartedAt: snapshot.readTime, count: 0 }
  const { windowStartedAt, count } = data
  if (!(windowStartedAt instanceof Timestamp) || !Number.isSafeInteger(count) || count < 0) throw processingError()
  const elapsed = snapshot.readTime.toMillis() - windowStartedAt.toMillis()
  if (elapsed < 0) throw processingError(true)
  if (elapsed >= policy.windowMs) return { ref, windowStartedAt: snapshot.readTime, count: 0 }
  if (count >= policy.maximum) {
    throw new HttpError(429, 'RATE_LIMITED', '時間をおいて再試行してください。', true, Math.ceil((policy.windowMs - elapsed) / 1000))
  }
  return { ref, windowStartedAt, count }
}
