import { createHash } from 'node:crypto'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import type { Firestore, Transaction } from 'firebase-admin/firestore'
import type { AttemptResult, CaptureMetadata } from '../../src/shared/api/types'
import { ContractError, parseCaptureMetadata } from '../../src/shared/api/validation'
import { HttpError, invalidInput } from './errors'
import { answerTransaction, conflict, incomingAnswerPhotoPath, notFound, processingError, readActiveChallenge,
  readCurrentVersion, storedAnswerResult, validAnswerUid, validDigest, validGeneration } from './firestore-answer-data'
import { parseIdempotencyKey } from './idempotency-key'
import { parseId } from './query'

interface AnswerSubmission { uid: string; challengeId: string; idempotencyKey: string; digest: string }
interface IntakePolicy { maximum: number; windowMs: number }
interface AnswerUpload { attemptId: string; objectPath: string }
type IntakePlan = ({ kind: 'upload' } & AnswerUpload) | { kind: 'replay'; result: AttemptResult }

export async function prepareAnswerIntake(db: Firestore, submission: AnswerSubmission, policy: IntakePolicy): Promise<IntakePlan> {
  const target = uploadTarget(submission, policy)
  return answerTransaction(db, async (tx) => {
    const intake = await inspectIntake(db, tx, submission, target.attemptId, policy)
    return intake.kind === 'replay' ? intake : { kind: 'upload', ...target }
  }, true)
}

// The server must confirm the private normalized image at the upload target
// before accepting the corresponding generation. Do not call Storage in the transaction.
export async function acceptDurableAnswer(db: Firestore, input: AnswerSubmission & { metadata: CaptureMetadata; generation: string },
  policy: IntakePolicy): Promise<AttemptResult> {
  const { uid, challengeId, digest, generation } = input
  const target = uploadTarget(input, policy)
  if (!validGeneration(generation)) invalidInput()
  let capture: CaptureMetadata
  try { capture = parseCaptureMetadata(input.metadata) }
  catch (error) { if (error instanceof ContractError) invalidInput(); throw error }
  return answerTransaction(db, async (tx) => {
    const intake = await inspectIntake(db, tx, input, target.attemptId, policy)
    if (intake.kind === 'replay') return intake.result
    const { current, admission } = intake
    const result: AttemptResult = { attemptId: target.attemptId, state: 'RECEIVED', outcome: null, nextAction: 'WAIT', source: 'real' }
    tx.create(intake.receipt, {
      uid, challengeId, digest, questId: current.questId, version: current.version, state: result.state,
      receivedAt: FieldValue.serverTimestamp(), capture, sourcePhoto: { path: target.objectPath, generation },
    })
    tx.set(admission.ref, { windowStartedAt: admission.windowStartedAt, count: admission.count + 1 })
    return result
  })
}

export async function getDurableAnswer(db: Firestore, uid: string, attemptId: string): Promise<AttemptResult> {
  if (!validAnswerUid(uid) || typeof attemptId !== 'string') invalidInput()
  const receipt = db.collection('attempts').doc(parseId(attemptId))
  return answerTransaction(db, async (tx) => {
    const data = (await tx.get(receipt)).data()
    if (!data || data.uid !== uid) throw notFound()
    const result = storedAnswerResult(data, attemptId)
    if (result.state !== 'COMPLETED') await readCurrentVersion(db, tx, data, uid)
    return result
  }, true)
}

function uploadTarget({ uid, challengeId, idempotencyKey, digest }: AnswerSubmission, policy: IntakePolicy): AnswerUpload {
  if (!validAnswerUid(uid) || typeof challengeId !== 'string' || !validDigest(digest) ||
    !Number.isSafeInteger(policy.maximum) || policy.maximum < 1 ||
    !Number.isSafeInteger(policy.windowMs) || policy.windowMs < 1) invalidInput()
  const attemptId = createHash('sha256').update(JSON.stringify([uid, parseId(challengeId), parseIdempotencyKey(idempotencyKey)])).digest('hex')
  return { attemptId, objectPath: incomingAnswerPhotoPath(attemptId, digest) }
}

async function inspectIntake(db: Firestore, tx: Transaction, input: AnswerSubmission, attemptId: string, policy: IntakePolicy) {
  const receipt = db.collection('attempts').doc(attemptId)
  const data = (await tx.get(receipt)).data()
  if (data) {
    if (data.uid !== input.uid || data.challengeId !== input.challengeId) throw notFound()
    if (data.digest !== input.digest) throw conflict()
    const result = storedAnswerResult(data, attemptId)
    if (result.state !== 'COMPLETED') await readCurrentVersion(db, tx, data, input.uid)
    return { kind: 'replay' as const, result }
  }
  const current = await readActiveChallenge(db, tx, input.uid, input.challengeId)
  const admission = await readAdmission(db, tx, input.uid, policy)
  return { kind: 'new' as const, current, admission, receipt }
}

async function readAdmission(db: Firestore, tx: Transaction, uid: string, policy: IntakePolicy) {
  const ref = db.collection('answerAdmission').doc(createHash('sha256').update(uid).digest('hex'))
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
