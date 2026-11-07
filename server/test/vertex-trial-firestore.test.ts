import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Firestore } from 'firebase-admin/firestore'
import { seedVertexTrialCounter, withFirestoreTrialSlot } from '../src/vertex-trial-firestore'

const identity = { version: 1, trial: 'vertex-photo-2026-11-05', project: 'tour-513804', model: 'gemini-3.8-flash', location: 'global', limit: 20 }

function fakeDb(initial?: Record<string, unknown>) {
  let stored = initial
  const ref = { path: 'vertexTrialCounters/vertex-photo-2026-11-05' }
  const db = {
    collection: () => ({ doc: () => ref }),
    runTransaction: async (work: (tx: unknown) => Promise<unknown>) => work({
      get: async () => ({ exists: stored !== undefined, data: () => stored }),
      update: (_ref: unknown, data: Record<string, unknown>) => { stored = { ...stored, ...data } },
    }),
  }
  return { db: db as unknown as Firestore, read: () => stored,
    create: async (data: Record<string, unknown>) => { if (stored !== undefined) throw new Error('already exists'); stored = data } }
}

function seedableDb(initial?: Record<string, unknown>) {
  const fake = fakeDb(initial)
  const ref = { create: fake.create }
  const db = { collection: () => ({ doc: () => ref }), runTransaction: (fake.db as unknown as Firestore).runTransaction }
  return { db: db as unknown as Firestore, read: fake.read }
}

const signal = () => new AbortController().signal

test('seeding records the inherited usage once and never overwrites it', async () => {
  const { db, read } = seedableDb()
  await seedVertexTrialCounter(db, 7)
  assert.deepEqual(read(), { ...identity, used: 7 })
  await assert.rejects(() => seedVertexTrialCounter(db, 7))
  assert.deepEqual(read(), { ...identity, used: 7 })
  await assert.rejects(() => seedVertexTrialCounter(db, 0))
  await assert.rejects(() => seedVertexTrialCounter(db, 21))
})

test('a slot reservation increments before the work runs and reports the new count', async () => {
  const { db, read } = fakeDb({ ...identity, used: 7 })
  let observed = 0
  const result = await withFirestoreTrialSlot(db, signal(), async (used) => { observed = used; return 'sent' })
  assert.equal(result, 'sent')
  assert.equal(observed, 8)
  assert.equal(read()?.used, 8)
})

test('the shared allowance fails closed at the limit, when unseeded and when tampered', async () => {
  const work = async () => 'sent'
  const atLimit = fakeDb({ ...identity, used: 20 })
  await assert.rejects(() => withFirestoreTrialSlot(atLimit.db, signal(), work))
  assert.equal(atLimit.read()?.used, 20)
  const missing = fakeDb()
  await assert.rejects(() => withFirestoreTrialSlot(missing.db, signal(), work))
  const tampered = fakeDb({ ...identity, used: 3, model: 'another-model' })
  await assert.rejects(() => withFirestoreTrialSlot(tampered.db, signal(), work))
  assert.equal(tampered.read()?.used, 3)
  const extraField = fakeDb({ ...identity, used: 3, note: 'free' })
  await assert.rejects(() => withFirestoreTrialSlot(extraField.db, signal(), work))
})

test('a failed send still consumes its reserved slot, like the file ledger', async () => {
  const { db, read } = fakeDb({ ...identity, used: 19 })
  await assert.rejects(() => withFirestoreTrialSlot(db, signal(), async () => { throw new Error('network down') }))
  assert.equal(read()?.used, 20)
  await assert.rejects(() => withFirestoreTrialSlot(db, signal(), async () => 'sent'))
})
