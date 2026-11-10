import assert from 'node:assert/strict'
import test from 'node:test'
import type { Firestore, Transaction } from 'firebase-admin/firestore'
import type { ManagedQuest } from '../../src/shared/api/admin'
import { ensureQuestNumber } from '../src/firestore-admin-publication'

type Doc = Record<string, unknown>

function fakeDb() {
  return { collection: (name: string) => ({ doc: (id: string) => ({ path: `${name}/${id}` }) }) } as unknown as Firestore
}

function fakeTx(store: Map<string, Doc>) {
  return {
    get: async (ref: { path: string }) => ({ get: (key: string) => store.get(ref.path)?.[key] }),
    set: (ref: { path: string }, value: Doc) => { store.set(ref.path, value) },
  } as unknown as Transaction
}

const quest = (questNumber?: string) => ({ questNumber }) as ManagedQuest

test('allocates sequential numbers within each prefecture code without duplicates', async () => {
  const store = new Map<string, Doc>()
  const db = fakeDb()
  assert.equal(await ensureQuestNumber(fakeTx(store), db, quest(), '40'), '40-01')
  assert.equal(await ensureQuestNumber(fakeTx(store), db, quest(), '40'), '40-02')
  assert.equal(await ensureQuestNumber(fakeTx(store), db, quest(), '07'), '07-01')
  assert.deepEqual(store.get('questNumberCounters/40'), { lastSerial: 2 })
  assert.deepEqual(store.get('questNumberCounters/07'), { lastSerial: 1 })
})

test('keeps an already assigned number and does not consume a serial', async () => {
  const store = new Map<string, Doc>()
  const db = fakeDb()
  assert.equal(await ensureQuestNumber(fakeTx(store), db, quest('40-01'), '40'), '40-01')
  assert.equal(store.size, 0)
})

test('assigns nothing when the area has no valid prefecture code', async () => {
  const store = new Map<string, Doc>()
  const db = fakeDb()
  assert.equal(await ensureQuestNumber(fakeTx(store), db, quest(), undefined), undefined)
  assert.equal(await ensureQuestNumber(fakeTx(store), db, quest(), '99'), undefined)
  assert.equal(await ensureQuestNumber(fakeTx(store), db, quest(), 40), undefined)
  assert.equal(store.size, 0)
})
