import { createHash } from 'node:crypto'
import { Timestamp } from 'firebase-admin/firestore'
import type { Firestore } from 'firebase-admin/firestore'
import { parseChallenge } from '../../src/shared/api/validation'
import { invalidInput } from './errors'
import { readAdmission, validateAdmissionPolicy } from './firestore-admission'
import type { AdmissionPolicy } from './firestore-admission'
import { answerTransaction, assertChallengeCanStart, notFound, processingError, validAnswerUid } from './firestore-answer-data'
import { parseId } from './query'

export async function startDurableChallenge(db: Firestore, uid: string, input: { questId: string; expectedVersion: number }, policy: AdmissionPolicy) {
  const { questId, expectedVersion: version } = input
  if (!validAnswerUid(uid) || typeof questId !== 'string' || !Number.isSafeInteger(version) || version < 1) invalidInput()
  parseId(questId)
  validateAdmissionPolicy(policy)
  const challengeId = createHash('sha256').update(JSON.stringify([uid, questId, version])).digest('hex')
  const challenge = db.collection('challenges').doc(challengeId)
  return answerTransaction(db, async (tx) => {
    await assertChallengeCanStart(db, tx, questId, version)
    const snapshot = await tx.get(challenge)
    const existing = snapshot.data()
    if (existing && (existing.uid !== uid || existing.questId !== questId || existing.version !== version ||
      !(existing.createdAt instanceof Timestamp))) throw processingError()
    const createdAt = existing?.createdAt ?? snapshot.readTime
    const result = parseChallenge({ challengeId, questId, version, createdAt: createdAt.toDate().toISOString() })
    const admission = await readAdmission(db, tx, 'challengeAdmission', uid, policy)
    if (!existing) tx.create(challenge, { uid, questId, version, createdAt })
    tx.set(admission.ref, { windowStartedAt: admission.windowStartedAt, count: admission.count + 1 })
    return { challenge: result, created: !existing }
  })
}

export async function assertDurableChallengeOwner(db: Firestore, uid: string, challengeId: string): Promise<void> {
  const challenge = db.collection('challenges').doc(parseId(challengeId))
  await answerTransaction(db, async (tx) => {
    if ((await tx.get(challenge)).data()?.uid !== uid) throw notFound()
  }, true)
}
