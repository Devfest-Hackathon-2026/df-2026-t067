import { createHash } from 'node:crypto'
import { Timestamp } from 'firebase-admin/firestore'
import type { DocumentData, Firestore, Transaction } from 'firebase-admin/firestore'
import type { Discovery, Page } from '../../src/shared/api/types'
import { isPrefectureCode, parseAfterClearContent, parseDiscovery } from '../../src/shared/api/validation'
import type { AnswerPhotoStorage } from './answer-photo-storage'
import type { DiscoveryPhoto, DiscoveryQuery, DiscoveryReadRepository } from './discoveries'
import { HttpError, invalidInput } from './errors'
import { answerTransaction, processingError, storedId, validAnswerUid, validGeneration, validRecordPhotoPath } from './firestore-answer-data'
import { getDiscoveryDeletion, requestDiscoveryDeletion } from './firestore-discovery-deletions'
import { createScopedCursor, parseId, parseLimit, readScopedCursor } from './query'

import { areaPrefectureCode } from './municipal-areas'
import { compareDiscoveryPosition, parseDiscoverySort } from './discovery-sort'
import type { DiscoveryPosition } from './discovery-sort'

export class FirestoreDiscoveryStore implements DiscoveryReadRepository {
  readonly storageMode = 'firestore' as const

  constructor(private readonly db: Firestore, private readonly photos: Pick<AnswerPhotoStorage, 'readRecord' | 'deleteRecord'>) {}

  deleteOwned(uid: string, discoveryId: string) {
    return requestDiscoveryDeletion(this.db, this.photos, uid, discoveryId)
  }

  getDeletionOwned(uid: string, deletionId: string) {
    return getDiscoveryDeletion(this.db, uid, deletionId)
  }

  async listOwned(uid: string, { areaId, limit: requestedLimit, cursor, sort: requestedSort }: DiscoveryQuery): Promise<Page<Discovery>> {
    if (!validAnswerUid(uid) || (areaId !== undefined && typeof areaId !== 'string')) invalidInput()
    const sort = parseDiscoverySort(requestedSort)
    const params = new URLSearchParams()
    if (requestedLimit !== undefined) params.set('limit', String(requestedLimit))
    const limit = parseLimit(params)
    const scope = 'firestore-discoveries:' + createHash('sha256').update(JSON.stringify([uid, areaId ?? null, sort])).digest('hex')
    const position = cursor === undefined ? undefined : readPosition(readScopedCursor(cursor, scope))
    // 等価条件だけで引き、並び替えとページングは取得後にメモリ上で行う。
    // firstClearedAt の orderBy は uid との複合インデックスが必須で、インデックス
    // 未整備の DB（共有検証の名前付き DB には複合インデックスが無い）では
    // 一覧全体が SYSTEM_ERROR になり、ログイン済みでも記録が一切読めなかった
    // （D-57）。本人の記録は本人のクリア数に限られるため、全件取得でも足りる。
    let records = this.db.collection('discoveries').where('uid', '==', uid)
    if (areaId !== undefined) records = records.where('areaId', '==', parseId(areaId))
    const snapshot = await records.select('areaId', 'uid', 'discoveryId', 'placeId', 'questId', 'questVersion', 'firstClearedAt',
      'placeName', 'descriptionSnapshot', 'revealedLocation').get()
    const areaIds = [...new Set(snapshot.docs.map((doc) => storedId(doc.data().areaId)))]
    const areas = areaIds.length ? await this.db.getAll(...areaIds.map((id) => this.db.collection('areas').doc(id))) : []
    const codes = new Map(areas.map((doc) => [doc.id, areaPrefectureCode(doc.data())]))
    const key = (doc: typeof snapshot.docs[number]): DiscoveryPosition => ({
      seconds: clearTime(doc.data()).seconds, nanoseconds: clearTime(doc.data()).nanoseconds, id: doc.id, prefectureCode: codes.get(doc.data().areaId),
    })
    const sorted = [...snapshot.docs].sort((a, b) => compareDiscoveryPosition(sort, key(a), key(b)))
    const remaining = position === undefined ? sorted
      : sorted.filter((doc) => compareDiscoveryPosition(sort, key(doc), position) > 0)
    const page = remaining.slice(0, limit)
    const items = page.map((doc) => publicDiscovery(doc.data(), uid, doc.id, codes.get(doc.data().areaId)))
    const last = page.at(-1)
    if (!last || remaining.length <= limit) return { items, nextCursor: null }
    const positionKey = key(last)
    return { items, nextCursor: createScopedCursor(scope,
      `${positionKey.prefectureCode ?? ''}:${positionKey.seconds}:${positionKey.nanoseconds}:${positionKey.id}`) }
  }

  async getOwned(uid: string, discoveryId: string): Promise<Discovery | null> {
    return answerTransaction(this.db, async (tx) => {
      const data = await this.readOwned(uid, discoveryId, tx)
      if (!data) return null
      const area = await tx.get(this.db.collection('areas').doc(storedId(data.areaId)))
      const record = publicDiscovery(data, uid, discoveryId, areaPrefectureCode(area.data()))
      if (data.afterClear !== undefined) return { ...record, afterClear: parseAfterClearContent(data.afterClear) }

      // Records saved before afterClear was copied can still use their immutable version.
      const version = await tx.get(this.db.collection('questVersions').doc(storedId(record.questId) + ':' + record.questVersion))
      const afterClear = version.get('afterClear')
      if (afterClear === undefined) return record
      if (version.get('placeId') !== record.placeId) throw processingError()
      return { ...record, afterClear: parseAfterClearContent(afterClear) }
    }, true)
  }

  async getPhotoOwned(uid: string, discoveryId: string): Promise<DiscoveryPhoto | null> {
    const data = await this.readOwned(uid, discoveryId)
    if (!data) return null
    const { path, generation } = data.photoObject ?? {}
    if (!validRecordPhotoPath(path) || !validGeneration(generation)) throw processingError()
    let photo
    try { photo = await this.photos.readRecord({ path, generation }) }
    catch (error) {
      if (error instanceof HttpError && error.code === 'INVALID_INPUT') throw processingError()
      throw error
    }
    if (photo.mimeType !== 'image/jpeg') throw processingError()
    return { bytes: photo.bytes, contentType: photo.mimeType }
  }

  private async readOwned(uid: string, discoveryId: string, tx?: Transaction): Promise<DocumentData | null> {
    if (!validAnswerUid(uid) || typeof discoveryId !== 'string') invalidInput()
    const ref = this.db.collection('discoveries').doc(parseId(discoveryId))
    const data = (await (tx ? tx.get(ref) : ref.get())).data()
    if (!data || data.uid !== uid) return null
    if (data.discoveryId !== discoveryId) throw processingError()
    return data
  }
}

function publicDiscovery(data: DocumentData, uid: string, id: string, prefectureCode?: string): Discovery {
  const discoveryId = storedId(id)
  if (data.uid !== uid || data.discoveryId !== discoveryId) throw processingError()
  return parseDiscovery({
    ...(prefectureCode === undefined ? {} : { prefectureCode }),
    discoveryId, placeId: data.placeId, questId: data.questId, questVersion: data.questVersion,
    firstClearedAt: clearTime(data).toDate().toISOString(), placeName: data.placeName,
    descriptionSnapshot: data.descriptionSnapshot, revealedLocation: data.revealedLocation,
    ownerPhoto: `/api/v1/me/discoveries/${discoveryId}/photo`,
  })
}

function clearTime(data: DocumentData): Timestamp {
  if (!(data.firstClearedAt instanceof Timestamp)) throw processingError()
  return data.firstClearedAt
}

function readPosition(after: string): DiscoveryPosition {
  const match = /^(\d{2}|):(-?\d{1,12}):(\d{1,9}):([A-Za-z0-9][A-Za-z0-9_-]{0,127})$/.exec(after)
  if (!match || (match[1] !== '' && !isPrefectureCode(match[1]))) invalidInput()
  try {
    const time = new Timestamp(Number(match[2]), Number(match[3]))
    return { seconds: time.seconds, nanoseconds: time.nanoseconds, id: match[4], prefectureCode: match[1] || undefined }
  } catch { return invalidInput() }
}
