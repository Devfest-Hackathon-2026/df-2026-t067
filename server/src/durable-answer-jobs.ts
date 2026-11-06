import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import type { QueryDocumentSnapshot } from 'firebase-admin/firestore'
import { runDurableAnswer } from './durable-answer-worker'
import { HttpError, invalidInput } from './errors'
import { processingError, updateAnswerSnapshot, validAnswerUid, validDigest } from './firestore-answer-data'
import type { AnswerIdentity } from './firestore-answer-processing'
import { parseId } from './query'

interface JobSweepOptions {
  worker: Omit<Parameters<typeof runDurableAnswer>[1], 'retryVerification'>
  maximumJobs: number
  retryDelayMs: number
}

// One bounded pass. New receipts and post-match stages carry the schedule in
// Firestore, so this does not depend on an HTTP enqueue succeeding.
export async function runDueAnswerJobs({ worker, maximumJobs, retryDelayMs }: JobSweepOptions) {
  if (!Number.isSafeInteger(maximumJobs) || maximumJobs < 1 || maximumJobs > 256 ||
    !Number.isSafeInteger(retryDelayMs) || retryDelayMs < 1) invalidInput()
  const report = { examined: 0, completed: 0, deferred: 0, discarded: 0 }
  if (worker.signal?.aborted) return report
  let due
  try {
    due = await worker.db.collection('attempts').where('nextWorkAt', '<=', Timestamp.now()).orderBy('nextWorkAt')
      .limit(maximumJobs).select('uid', 'digest', 'state', 'nextWorkAt').get()
  } catch { throw processingError(true) }

  for (const job of due.docs) {
    if (worker.signal?.aborted) break
    report.examined++
    const identity = jobIdentity(job)
    if (!identity) {
      if (await updateAnswerSnapshot(job, { nextWorkAt: FieldValue.delete() })) report.discarded++
      continue
    }
    try {
      const result = await runDurableAnswer(identity, { ...worker, retryVerification: false })
      if (result.kind === 'completed') report.completed++
      else report.deferred++
    } catch (error) {
      if (worker.signal?.aborted) break
      if (error instanceof HttpError && !error.retryable) {
        if (await updateAnswerSnapshot(job, { nextWorkAt: FieldValue.delete() })) report.discarded++
      } else {
        // If this pass claimed or advanced the answer, that transaction owns
        // the schedule. Never reinsert work from an older query snapshot.
        await updateAnswerSnapshot(job, { nextWorkAt: Timestamp.fromMillis(Date.now() + retryDelayMs) })
        report.deferred++
      }
    }
  }
  return report
}

function jobIdentity(job: QueryDocumentSnapshot): AnswerIdentity | null {
  const { uid, digest, state, nextWorkAt } = job.data()
  if (!validAnswerUid(uid) || !validDigest(digest) || !(nextWorkAt instanceof Timestamp) ||
    !['RECEIVED', 'IMAGE_EVALUATED', 'COMMITTING'].includes(state)) return null
  try { return { uid, digest, attemptId: parseId(job.id) } }
  catch { return null }
}
