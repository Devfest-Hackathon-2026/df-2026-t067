import { createHash } from 'node:crypto'
import { FieldPath, Timestamp } from 'firebase-admin/firestore'
import type { DocumentData, Firestore, Transaction } from 'firebase-admin/firestore'
import type { Discovery, Page } from '../../src/shared/api/types'
import { parseAfterClearContent, parseDiscovery } from '../../src/shared/api/validation'
import type { AnswerPhotoStorage } from './answer-photo-storage'
import type { DiscoveryPhoto, DiscoveryQuery, DiscoveryReadRepository } from './discoveries'
import { HttpError, invalidInput } from './errors'
import { answerTransaction, processingError, storedId, validAnswerUid, validGeneration, validRecordPhotoPath } from './firestore-answer-data'
import { getDiscoveryDeletion, requestDiscoveryDeletion } from './firestore-discovery-deletions'
import { createScopedCursor, parseId, parseLimit, readScopedCursor } from './query'

export class FirestoreDiscoveryStore implements DiscoveryReadRepository {
  readonly storageMode = 'firestore' as const

  constructor(private readonly db: Firestore, private readonly photos: Pick<AnswerPhotoStorage, 'readRecord' | 'deleteRecord'>) {}

  deleteOwned(uid: string, discoveryId: string) {
    return requestDiscoveryDeletion(this.db, this.photos, uid, discoveryId)
  }

  getDeletionOwned(uid: string, deletionId: string) {
    return getDiscoveryDeletion(this.db, uid, deletionId)
  }

  async listOwned(uid: string, { areaId, limit: requestedLimit, cursor }: DiscoveryQuery): Promise<Page<Discovery>> {
    if (!validAnswerUid(uid) || (areaId !== undefined && typeof areaId !== 'string')) invalidInput()
    const params = new URLSearchParams()
    if (requestedLimit !== undefined) params.set('limit', String(requestedLimit))
    const limit = parseLimit(params)
    const scope = 'firestore-discoveries:' + createHash('sha256').update(JSON.stringify([uid, areaId ?? null])).digest('hex')
    let records = this.db.collection('discoveries').where('uid', '==', uid)
    if (areaId !== undefined) records = records.where('areaId', '==', parseId(areaId))
    records = records.orderBy('firstClearedAt', 'desc').orderBy(FieldPath.documentId(), 'desc')
    if (cursor !== undefined) records = records.startAfter(...readPosition(readScopedCursor(cursor, scope)))
    const snapshot = await records.select('uid', 'discoveryId', 'placeId', 'questId', 'questVersion', 'firstClearedAt',
      'placeName', 'descriptionSnapshot', 'revealedLocation').limit(limit + 1).get()
    const page = snapshot.docs.slice(0, limit)
    const items = page.map((doc) => publicDiscovery(doc.data(), uid, doc.id))
    const last = page.at(-1)
    if (!last || snapshot.size <= limit) return { items, nextCursor: null }
    const time = clearTime(last.data())
    return { items, nextCursor: createScopedCursor(scope, `${time.seconds}:${time.nanoseconds}:${last.id}`) }
  }

  async getOwned(uid: string, discoveryId: string): Promise<Discovery | null> {
    return answerTransaction(this.db, async (tx) => {
      const data = await this.readOwned(uid, discoveryId, tx)
      if (!data) return null
      const record = publicDiscovery(data, uid, discoveryId)
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

function publicDiscovery(data: DocumentData, uid: string, id: string): Discovery {
  const discoveryId = storedId(id)
  if (data.uid !== uid || data.discoveryId !== discoveryId) throw processingError()
  return parseDiscovery({
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

function readPosition(after: string): [Timestamp, string] {
  const match = /^(-?\d{1,12}):(\d{1,9}):([A-Za-z0-9][A-Za-z0-9_-]{0,127})$/.exec(after)
  if (!match) invalidInput()
  try { return [new Timestamp(Number(match[1]), Number(match[2])), match[3]] }
  catch { invalidInput() }
}
