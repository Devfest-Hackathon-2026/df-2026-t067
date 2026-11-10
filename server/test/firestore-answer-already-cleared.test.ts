import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { Timestamp } from 'firebase-admin/firestore'
import type { Firestore } from 'firebase-admin/firestore'
import { runDurableAnswer } from '../src/durable-answer-worker'
import { discoveryKeyId } from '../src/firestore-answer-data'
import type { LocationPolicy } from '../src/location'

// D-64 の回帰テスト：クリア済み（discoveries に記録あり）の場所へ再び回答が
// 送られた時、ワーカーは写真照合（Vertex 送信＝試験カウンタの消費）に進まず、
// ALREADY_CLEARED で即座に完了させる。短絡は completeKnownDiscovery が
// verify 工程の先頭で担う。Firestore エミュレータ無しで常時走らせられるよう、
// 短絡パスが触る最小限の面だけを実装したフェイクで検証する。
const digest = 'a'.repeat(64)
const capturedAt = '2026-11-06T00:00:00.000Z'
const metadata = { capturedAt,
  position: { latitude: 0, longitude: 0, accuracyMeters: 4, measuredAt: capturedAt } }

type DocData = Record<string, unknown>

class FakeRef {
  constructor(readonly collectionName: string, readonly id: string) {}
  get path() { return `${this.collectionName}/${this.id}` }
}

function fakeFirestore(seed: Map<string, DocData>) {
  const store = new Map([...seed].map(([path, data]) => [path, { ...data }]))
  const snapshot = (ref: FakeRef) => {
    const data = store.get(ref.path)
    return { id: ref.id, ref, exists: data !== undefined, readTime: Timestamp.now(),
      data: () => data === undefined ? undefined : { ...data } }
  }
  const tx = {
    get: async (ref: FakeRef) => snapshot(ref),
    getAll: async (...refs: FakeRef[]) => refs.map((ref) => snapshot(ref)),
    update: (ref: FakeRef, data: DocData) => { store.set(ref.path, { ...store.get(ref.path), ...data }) },
    create: (ref: FakeRef, data: DocData) => { store.set(ref.path, { ...data }) },
    set: (ref: FakeRef, data: DocData) => { store.set(ref.path, { ...data }) },
  }
  const db = {
    collection: (name: string) => ({ doc: (id: string) => new FakeRef(name, id) }),
    runTransaction: async (work: (transaction: typeof tx) => Promise<unknown>) => work(tx),
  }
  return { db: db as unknown as Firestore, store }
}

function seedWorld() {
  const uid = 'owner-' + randomUUID()
  const questId = randomUUID()
  const placeId = randomUUID()
  const challengeId = randomUUID()
  const attemptId = randomUUID()
  const discoveryId = randomUUID()
  const docs = new Map<string, DocData>([
    [`quests/${questId}`, { publishedVersion: 1, status: 'published' }],
    [`questVersions/${questId}:1`, { placeId }],
    [`challenges/${challengeId}`, { uid, questId, version: 1 }],
    [`attempts/${attemptId}`, { uid, digest, challengeId, questId, version: 1, state: 'RECEIVED',
      sourcePhoto: { path: `answer-photos/${attemptId}/incoming-${digest}.jpg`, generation: '4321' },
      receivedAt: Timestamp.fromDate(new Date(capturedAt)), capture: metadata }],
  ])
  // clearedPlace の記録（discoveryKeys の対応付け＋記録本体）を足す。
  const withClear = (clearedPlaceId: string) => new Map([...docs,
    [`discoveryKeys/${discoveryKeyId(uid, clearedPlaceId)}`, { discoveryId }],
    [`discoveries/${discoveryId}`, { uid, placeId: clearedPlaceId, discoveryId,
      firstClearedAt: Timestamp.fromDate(new Date(capturedAt)),
      photoObject: { path: `answer-photos/${randomUUID()}/record.jpg`, generation: '1234' } }],
  ])
  return { uid, questId, placeId, attemptId, discoveryId, docs, withClear }
}

function countingOptions(db: Firestore) {
  const calls = { matcher: 0, readIncoming: 0, writeRecord: 0, locationPolicy: 0, loadReference: 0 }
  const outsidePolicy: LocationPolicy = { zones: [{ latitude: 10, longitude: 10, radiusMeters: 100 }],
    maxAccuracyMeters: 100, maxAgeMs: 600_000, maxFutureSkewMs: 60_000, maxCaptureMeasurementGapMs: 60_000 }
  const options = {
    db, leaseDurationMs: 180_000,
    authorize: async () => true,
    photos: {
      readIncoming: async () => { calls.readIncoming++; throw new Error('短絡時は受信写真を読まない') },
      writeRecord: async () => { calls.writeRecord++; throw new Error('短絡時は記録写真を書かない') },
    },
    locationPolicy: async () => { calls.locationPolicy++; return outsidePolicy },
    loadReference: async () => { calls.loadReference++; throw new Error('短絡時は照合素材を読まない') },
    matcher: async () => { calls.matcher++; return 'MATCH' },
  }
  return { calls, options }
}

test('an already-cleared place finishes as ALREADY_CLEARED without any photo matching work', async () => {
  const world = seedWorld()
  const { db, store } = fakeFirestore(world.withClear(world.placeId))
  const { calls, options } = countingOptions(db)
  const result = await runDurableAnswer({ uid: world.uid, attemptId: world.attemptId, digest }, options)
  assert.equal(result.kind, 'completed')
  assert(result.kind === 'completed')
  assert.equal(result.result.outcome, 'ALREADY_CLEARED')
  assert.equal(result.result.optionalDiscoveryId, world.discoveryId)
  assert.equal(result.result.nextAction, 'VIEW_DISCOVERY')
  // Vertex 送信（＝カウンタ消費）に至る経路はどれも呼ばれない。
  assert.deepEqual(calls, { matcher: 0, readIncoming: 0, writeRecord: 0, locationPolicy: 0, loadReference: 0 })
  const attempt = store.get(`attempts/${world.attemptId}`)
  assert.equal(attempt?.state, 'COMPLETED')
  assert.equal((attempt?.result as DocData | undefined)?.outcome, 'ALREADY_CLEARED')
  // 記録は増えない（初回の1件のまま）。
  assert.equal([...store.keys()].filter((path) => path.startsWith('discoveries/')).length, 1)
})

test('a discovery for a different place does not short-circuit the verification flow', async () => {
  const world = seedWorld()
  const { db } = fakeFirestore(world.withClear(randomUUID()))
  const { calls, options } = countingOptions(db)
  const result = await runDurableAnswer({ uid: world.uid, attemptId: world.attemptId, digest }, options)
  assert.equal(result.kind, 'completed')
  assert(result.kind === 'completed')
  // 短絡せず通常の検証へ進み、範囲外として確定する（照合には進まない）。
  assert.equal(result.result.outcome, 'OUTSIDE_AREA')
  assert.equal(calls.locationPolicy, 1)
  assert.equal(calls.matcher, 0)
})
