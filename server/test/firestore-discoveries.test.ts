import assert from 'node:assert/strict'
import test from 'node:test'
import { Timestamp } from 'firebase-admin/firestore'
import type { Firestore } from 'firebase-admin/firestore'
import { DemoDiscoveryStore } from '../src/discoveries'
import type { DiscoverySort } from '../src/discovery-sort'
import { FirestoreDiscoveryStore } from '../src/firestore-discoveries'

// 本人の記録一覧は、複合インデックスが無い DB でも読めなければならない（D-57）。
// このフェイクは orderBy / startAfter / limit を実装しないため、listOwned が
// それらに頼る実装へ戻ると呼び出し時点で落ちて回帰に気づける。
type FakeDoc = { id: string; data: Record<string, unknown> }

class FakeQuery {
  constructor(private readonly docs: FakeDoc[], private readonly filters: [string, unknown][] = []) {}
  where(field: string, _op: string, value: unknown) {
    return new FakeQuery(this.docs, [...this.filters, [field, value]])
  }
  select() { return this }
  async get() {
    const matched = this.docs.filter((doc) => this.filters.every(([field, value]) => doc.data[field] === value))
    return { docs: matched.map((doc) => ({ id: doc.id, data: () => doc.data })), size: matched.length }
  }
}

function fakeDb(docs: FakeDoc[], areas: Record<string, unknown> = {}): Firestore {
  const snapshot = (id: string, data: unknown) => ({ id, data: () => data, get: (key: string) => (data as Record<string, unknown>)?.[key] })
  return {
    collection: (name: string) => {
      assert.ok(name === 'discoveries' || name === 'areas', 'prefecture resolution must not read quests or versions')
      return name === 'discoveries' ? Object.assign(new FakeQuery(docs), {
        doc: (id: string) => snapshot(id, docs.find((doc) => doc.id === id)?.data),
      }) : { doc: (id: string) => snapshot(id, areas[id]) }
    },
    getAll: async (...refs: { id: string }[]) => {
      assert.equal(new Set(refs.map((ref) => ref.id)).size, refs.length)
      return refs
    },
    runTransaction: async (fn: (tx: unknown) => unknown) => fn({ get: async (ref: unknown) => ref }),
  } as unknown as Firestore
}

function record(id: string, uid: string, seconds: number, nanoseconds = 0, areaId = 'area-1'): FakeDoc {
  return { id, data: { uid, discoveryId: id, areaId, placeId: 'place-1', questId: 'quest-1', questVersion: 1,
    firstClearedAt: new Timestamp(seconds, nanoseconds), placeName: '場所' + id,
    descriptionSnapshot: '', revealedLocation: { latitude: 35, longitude: 139 } } }
}

const photos = { readRecord: async () => { throw new Error('unused') }, deleteRecord: async () => { throw new Error('unused') } }

test('listOwned は複合インデックスなしで本人の記録を新しい順に返す', async () => {
  const store = new FirestoreDiscoveryStore(fakeDb([
    record('disc-b', 'user-1', 200),
    record('disc-a', 'user-1', 300),
    record('disc-c', 'user-1', 300),
    record('disc-z', 'user-2', 400),
  ]), photos)
  const page = await store.listOwned('user-1', {})
  // 同日時はドキュメントIDの降順（従来の orderBy と同じ並び）。
  assert.deepEqual(page.items.map((item) => item.discoveryId), ['disc-c', 'disc-a', 'disc-b'])
  assert.equal(page.nextCursor, null)
})

test('listOwned は保存済みレコードに案内があっても一覧へ含めない', async () => {
  // クリア後の案内（afterClear、スポットの正確な住所・位置を含む）は本人詳細
  // だけの項目で、一覧の応答には決して混ぜない（D-71）。
  const withGuidance = record('disc-a', 'user-1', 300)
  withGuidance.data.afterClear = { access: '', hours: '', promoComment: '', explanation: '解説',
    spot: { name: '架空の灯台', address: '架空県架空市1-1', position: { latitude: 35.5, longitude: 139.5 } } }
  const store = new FirestoreDiscoveryStore(fakeDb([withGuidance]), photos)
  const page = await store.listOwned('user-1', {})
  assert.equal(page.items.length, 1)
  assert.equal('afterClear' in page.items[0], false)
  assert.equal(JSON.stringify(page.items).includes('架空の灯台'), false)
})

test('listOwned はカーソルで続きを返し、地域でも絞れる', async () => {
  const store = new FirestoreDiscoveryStore(fakeDb([
    record('disc-a', 'user-1', 300, 0, 'area-1'),
    record('disc-b', 'user-1', 200, 0, 'area-2'),
    record('disc-c', 'user-1', 100, 0, 'area-1'),
  ]), photos)
  const first = await store.listOwned('user-1', { limit: 2 })
  assert.deepEqual(first.items.map((item) => item.discoveryId), ['disc-a', 'disc-b'])
  assert.ok(first.nextCursor)
  const rest = await store.listOwned('user-1', { limit: 2, cursor: first.nextCursor! })
  assert.deepEqual(rest.items.map((item) => item.discoveryId), ['disc-c'])
  assert.equal(rest.nextCursor, null)
  const area = await store.listOwned('user-1', { areaId: 'area-1' })
  assert.deepEqual(area.items.map((item) => item.discoveryId), ['disc-a', 'disc-c'])
})

test('listOwned は該当0件でもカーソルの本人・地域と形式を検証する', async () => {
  const store = new FirestoreDiscoveryStore(fakeDb([
    record('disc-a', 'user-1', 300), record('disc-b', 'user-1', 200),
  ]), photos)
  const first = await store.listOwned('user-1', { areaId: 'area-1', limit: 1 })
  assert.ok(first.nextCursor)
  for (const [uid, areaId] of [['user-1', 'different-area'], ['other-owner', 'area-1']]) {
    assert.deepEqual(await store.listOwned(uid, { areaId }), { items: [], nextCursor: null })
    await assert.rejects(store.listOwned(uid, { areaId, cursor: first.nextCursor }), { code: 'INVALID_INPUT' })
    await assert.rejects(store.listOwned(uid, { areaId, cursor: 'malformed' }), { code: 'INVALID_INPUT' })
  }
  const empty = new FirestoreDiscoveryStore(fakeDb([]), photos)
  assert.deepEqual(await empty.listOwned('user-1', { areaId: 'area-1', cursor: first.nextCursor }),
    { items: [], nextCursor: null })
  const invalidPosition = JSON.parse(Buffer.from(first.nextCursor, 'base64url').toString())
  invalidPosition.after = 'invalid-position'
  await assert.rejects(empty.listOwned('user-1', { areaId: 'area-1',
    cursor: Buffer.from(JSON.stringify(invalidPosition)).toString('base64url') }), { code: 'INVALID_INPUT' })
})

test('four sorts agree across repositories, paginate ties and retain unknown prefectures', async () => {
  const codes: Record<string, string | undefined> = { north: '01', south: '47', invalid: '48' }
  const memory = new DemoDiscoveryStore({ now: () => 300000, prefectureCodeOf: (id) => codes[id] })
  const docs: FakeDoc[] = []
  for (const [index, areaId] of ['north', 'south', 'north', 'north', 'missing', 'invalid', 'unclassified'].entries()) {
    const saved = await memory.saveFirstClear('user-1', {
      placeId: 'place-' + index, questId: 'retired-quest', questVersion: 7, areaId,
      placeName: '合成記録', descriptionSnapshot: '', revealedLocation: { latitude: 0, longitude: 0 },
      photo: Buffer.from([255, 216, 255, 0]),
    }, { location: 'WITHIN_AREA', photo: 'MATCH' })
    const doc = record(saved.discovery.discoveryId, 'user-1', 300, 0, areaId)
    doc.data.afterClear = { access: '', hours: '', promoComment: '', explanation: '' }
    docs.push(doc)
  }
  docs.push(record('other-record', 'other', 999))
  const firestore = new FirestoreDiscoveryStore(fakeDb(docs, {
    north: { prefectureCode: '01' }, south: { prefectureCode: '47' },
    invalid: { prefectureCode: '48' }, unclassified: {},
  }), photos)
  for (const sort of ['cleared-desc', 'cleared-asc', 'prefecture-asc', 'prefecture-desc'] as DiscoverySort[]) {
    const descending = docs.filter((d) => d.data.uid === 'user-1').sort((a, b) => a.id < b.id ? 1 : -1)
    const expected = sort === 'cleared-asc' ? [...descending].reverse() : sort === 'cleared-desc' ? descending
      : [...descending.filter((d) => d.data.areaId === (sort === 'prefecture-asc' ? 'north' : 'south')),
        ...descending.filter((d) => d.data.areaId === (sort === 'prefecture-asc' ? 'south' : 'north')),
        ...descending.filter((d) => !['north', 'south'].includes(String(d.data.areaId)))]
    for (const store of [memory, firestore]) {
      const ids: string[] = []
      let cursor: string | undefined
      do {
        const page = await store.listOwned('user-1', { sort, limit: 2, cursor })
        ids.push(...page.items.map((d) => d.discoveryId))
        for (const item of page.items) {
          const doc = docs.find((d) => d.id === item.discoveryId)!
          const code = codes[String(doc.data.areaId)]
          if (code === '01' || code === '47') assert.equal(item.prefectureCode, code)
          else assert.equal('prefectureCode' in item, false)
          const detail = await store.getOwned('user-1', item.discoveryId)
          assert.equal(detail?.prefectureCode, item.prefectureCode)
        }
        cursor = page.nextCursor ?? undefined
      } while (cursor)
      assert.deepEqual(ids, expected.map((d) => d.id))
      const first = await store.listOwned('user-1', { sort, limit: 1 })
      for (const query of [{ sort: sort === 'cleared-asc' ? 'cleared-desc' as const : 'cleared-asc' as const },
        { sort, areaId: 'north' }]) {
        await assert.rejects(store.listOwned('user-1', { ...query, cursor: first.nextCursor! }), { code: 'INVALID_INPUT' })
      }
      await assert.rejects(store.listOwned('other', { sort, cursor: first.nextCursor! }), { code: 'INVALID_INPUT' })
    }
  }
  for (const store of [memory, firestore]) {
    assert.deepEqual(await store.listOwned('user-1', {}), await store.listOwned('user-1', { sort: 'cleared-desc' }))
  }
})

test('nanosecond ordering survives cursor round trips for every sort', async () => {
  const store = new FirestoreDiscoveryStore(fakeDb([
    record('a', 'user-1', 300, 1), record('z', 'user-1', 300, 0), record('b', 'user-1', 300, 1),
  ], { 'area-1': { prefectureCode: '13' } }), photos)
  for (const sort of ['cleared-desc', 'cleared-asc', 'prefecture-asc', 'prefecture-desc'] as DiscoverySort[]) {
    const ids: string[] = []
    let cursor: string | undefined
    do {
      const page = await store.listOwned('user-1', { sort, limit: 1, cursor })
      ids.push(...page.items.map((d) => d.discoveryId))
      cursor = page.nextCursor ?? undefined
    } while (cursor)
    assert.deepEqual(ids, sort === 'cleared-asc' ? ['z', 'a', 'b'] : ['b', 'a', 'z'])
  }
})
