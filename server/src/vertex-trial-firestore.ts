import type { Firestore } from 'firebase-admin/firestore'
import { photoSystemError } from './photo-match'
import { createVertexTransport, type TransportOptions, type VertexTransport } from './vertex-transport'

// Firestore-backed counterpart of the local trial ledger
// (vertex-trial-ledger.ts). The D-13 trial identity and limit are identical:
// the same 50-send allowance is shared between the local CLI runs and this
// cloud runtime, so the counter document must be seeded once by an operator
// with the sends already used before the cloud trial is enabled. Seeding and
// reservation both fail closed: a missing or unexpected document never lets
// a send through, and a send that fails after reservation still consumes its
// slot, exactly like the file ledger.
const identity = { version: 1, trial: 'vertex-photo-2026-11-05', project: 'tour-513804', model: 'gemini-3.8-flash', location: 'global', limit: 50 }
const counterPath = { collection: 'vertexTrialCounters', document: identity.trial }

function assertUsedCount(value: unknown): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > identity.limit) throw photoSystemError(false)
}

function readUsed(data: Record<string, unknown> | undefined): number {
  if (!data || Object.keys(data).sort().join(',') !== [...Object.keys(identity), 'used'].sort().join(',') ||
    Object.entries(identity).some(([key, value]) => data[key] !== value)) throw photoSystemError(false)
  assertUsedCount(data.used)
  if ((data.used as number) >= identity.limit) throw photoSystemError(false)
  return data.used as number
}

export async function seedVertexTrialCounter(db: Firestore, alreadyUsed: number): Promise<void> {
  assertUsedCount(alreadyUsed)
  const ref = db.collection(counterPath.collection).doc(counterPath.document)
  try {
    // create() rejects when the document already exists, so an allowance is
    // never silently reset or double-seeded.
    await ref.create({ ...identity, used: alreadyUsed })
  } catch { throw photoSystemError(false) }
}

export async function withFirestoreTrialSlot<T>(db: Firestore, signal: AbortSignal,
  work: (used: number) => Promise<T>): Promise<T> {
  signal.throwIfAborted()
  const ref = db.collection(counterPath.collection).doc(counterPath.document)
  let count: number
  try {
    count = await db.runTransaction(async (tx) => {
      const snapshot = await tx.get(ref)
      if (!snapshot.exists) throw photoSystemError(false)
      const used = readUsed(snapshot.data())
      const next = used + 1
      tx.update(ref, { used: next })
      return next
    })
  } catch { signal.throwIfAborted(); throw photoSystemError(false) }
  signal.throwIfAborted()
  return await work(count)
}

export function createFirestoreVertexTrialTransport(db: Firestore, options: TransportOptions = {}): VertexTransport {
  return createVertexTransport((signal, work) => withFirestoreTrialSlot(db, signal, work), options)
}
