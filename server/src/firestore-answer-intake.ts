import { createHash } from 'node:crypto'
import { FieldValue } from 'firebase-admin/firestore'
import type { Firestore, Transaction } from 'firebase-admin/firestore'
import type { AttemptResult, CaptureMetadata } from '../../src/shared/api/types'
import { ContractError, parseCaptureMetadata } from '../../src/shared/api/validation'
import { invalidInput } from './errors'
import { readAdmission, validateAdmissionPolicy } from './firestore-admission'
import type { AdmissionPolicy } from './firestore-admission'
import { answerTransaction, conflict, incomingAnswerPhotoPath, notFound, readActiveChallenge,
  readCurrentVersion, storedAnswerResult, validAnswerUid, validDigest, validGeneration } from './firestore-answer-data'
import { parseIdempotencyKey } from './idempotency-key'
import { parseId } from './query'

interface AnswerSubmission { uid: string; challengeId: string; idempotencyKey: string; digest: string }
interface AnswerUpload { attemptId: string; objectPath: string }
type IntakePlan = ({ kind: 'upload' } & AnswerUpload) | { kind: 'replay'; result: AttemptResult }

export async function prepareAnswerIntake(db: Firestore, submission: AnswerSubmission, policy: AdmissionPolicy): Promise<IntakePlan> {
  const target = uploadTarget(submission, policy)
  return answerTransaction(db, async (tx) => {
    const intake = await inspectIntake(db, tx, submission, target.attemptId, policy)
    return intake.kind === 'replay' ? intake : { kind: 'upload', ...target }
  }, true)
}

// The server must confirm the private normalized image at the upload target
// before accepting the corresponding generation. Do not call Storage in the transaction.
export async function acceptDurableAnswer(db: Firestore, input: AnswerSubmission & { metadata: CaptureMetadata; generation: string },
  policy: AdmissionPolicy): Promise<AttemptResult> {
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
      receivedAt: FieldValue.serverTimestamp(), nextWorkAt: FieldValue.serverTimestamp(),
      capture, sourcePhoto: { path: target.objectPath, generation },
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

function uploadTarget({ uid, challengeId, idempotencyKey, digest }: AnswerSubmission, policy: AdmissionPolicy): AnswerUpload {
  if (!validAnswerUid(uid) || typeof challengeId !== 'string' || !validDigest(digest)) invalidInput()
  validateAdmissionPolicy(policy)
  const attemptId = createHash('sha256').update(JSON.stringify([uid, parseId(challengeId), parseIdempotencyKey(idempotencyKey)])).digest('hex')
  return { attemptId, objectPath: incomingAnswerPhotoPath(attemptId, digest) }
}

async function inspectIntake(db: Firestore, tx: Transaction, input: AnswerSubmission, attemptId: string, policy: AdmissionPolicy) {
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
  const admission = await readAdmission(db, tx, 'answerAdmission', input.uid, policy)
  return { kind: 'new' as const, current, admission, receipt }
}
