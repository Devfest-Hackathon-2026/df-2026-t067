import { randomUUID } from 'node:crypto'
import { DISCOVERY_PHOTO_MAX_BYTES } from '../../src/shared/api/types'
import type { DeletionReceipt, DeletionStatus, Discovery, Page, Position } from '../../src/shared/api/types'
import { parseDiscovery } from '../../src/shared/api/validation'
import { HttpError, invalidInput } from './errors'
import type { LocationDecision } from './location'
import { paginate, parseId } from './query'

export interface DiscoveryQuery { areaId?: string; cursor?: string; limit?: number }
export interface DiscoveryPhoto { bytes: Uint8Array; contentType: 'image/jpeg' }
export interface DiscoveryRepository {
  readonly storageMode: 'memory'
  listOwned(uid: string, query: DiscoveryQuery): Promise<Page<Discovery>>
  getOwned(uid: string, discoveryId: string): Promise<Discovery | null>
  getPhotoOwned(uid: string, discoveryId: string): Promise<DiscoveryPhoto | null>
  deleteOwned(uid: string, discoveryId: string): Promise<DeletionReceipt | null>
  getDeletionOwned(uid: string, deletionId: string): Promise<DeletionStatus | null>
}
export interface FirstDiscoveryInput {
  placeId: string; questId: string; questVersion: number; areaId: string
  placeName: string; descriptionSnapshot: string; revealedLocation: Position; photo: Uint8Array
}
export interface ClearVerification { location: LocationDecision; photo: 'MATCH' | 'WRONG_TARGET' | 'IMAGE_UNCERTAIN' }
interface StoredDiscovery { uid: string; areaId: string; discovery: Discovery; photo: Buffer }

// Development-only storage. There is no HTTP record creation route. The answer
// worker must recheck authorization, published version and pause immediately
// before invoking saveFirstClear with its server-verified outcomes and JPEG.
export class DemoDiscoveryStore implements DiscoveryRepository {
  readonly storageMode = 'memory' as const
  private readonly records = new Map<string, StoredDiscovery>()
  private readonly places = new Map<string, string>()
  private readonly deletions = new Map<string, { uid: string; status: DeletionStatus }>()
  private readonly deleted = new Map<string, string>()
  private usedBytes = 0
  private readonly capacity: number
  private readonly maximumBytes: number
  private readonly now: () => number

  constructor(options: { capacity?: number; maximumBytes?: number; now?: () => number } = {}) {
    this.capacity = options.capacity ?? 256
    this.maximumBytes = options.maximumBytes ?? 32 * 1024 * 1024
    this.now = options.now ?? Date.now
    if (!Number.isSafeInteger(this.capacity) || this.capacity < 1 || this.capacity > 256 ||
      !Number.isSafeInteger(this.maximumBytes) || this.maximumBytes < 1 || this.maximumBytes > 32 * 1024 * 1024) {
      throw new Error('Demo discovery limits must be positive integers, at most 256 records and 32 MiB.')
    }
  }

  async saveFirstClear(uid: string, input: FirstDiscoveryInput, verification: ClearVerification): Promise<{ source: 'mock'; created: boolean; discovery: Discovery }> {
    if (verification.location !== 'WITHIN_AREA' || verification.photo !== 'MATCH') {
      throw new HttpError(503, 'SYSTEM_ERROR', '確認済みの条件がそろわず保存できません。')
    }
    if (typeof uid !== 'string' || !uid.trim() || uid.length > 128) invalidInput()
    parseId(input.placeId); parseId(input.questId); parseId(input.areaId)
    const key = JSON.stringify([uid, input.placeId])
    const existing = this.places.get(key)
    if (existing) return { source: 'mock', created: false, discovery: structuredClone(this.records.get(existing)!.discovery) }
    if (!(input.photo instanceof Uint8Array) || input.photo.byteLength < 4 || input.photo.byteLength > DISCOVERY_PHOTO_MAX_BYTES ||
      input.photo[0] !== 0xff || input.photo[1] !== 0xd8 || input.photo[2] !== 0xff ||
      input.placeName.length > 200 || input.descriptionSnapshot.length > 4000) invalidInput()
    if (this.records.size >= this.capacity || this.usedBytes + input.photo.byteLength > this.maximumBytes) throw this.full()
    const now = this.now()
    if (!Number.isFinite(now) || !Number.isFinite(new Date(now).getTime())) {
      throw new HttpError(503, 'SYSTEM_ERROR', '保存日時を確定できません。', true)
    }
    const discoveryId = randomUUID()
    const discovery = parseDiscovery({ discoveryId, placeId: input.placeId, questId: input.questId, questVersion: input.questVersion,
      firstClearedAt: new Date(now).toISOString(), placeName: input.placeName, descriptionSnapshot: input.descriptionSnapshot,
      revealedLocation: input.revealedLocation, ownerPhoto: '/api/v1/me/discoveries/' + discoveryId + '/photo' })
    const photo = Buffer.from(input.photo)
    this.records.set(discoveryId, { uid, areaId: input.areaId, discovery, photo })
    this.places.set(key, discoveryId)
    this.usedBytes += photo.byteLength
    return { source: 'mock', created: true, discovery: structuredClone(discovery) }
  }

  async listOwned(uid: string, query: DiscoveryQuery): Promise<Page<Discovery>> {
    const params = new URLSearchParams()
    if (query.cursor !== undefined) params.set('cursor', query.cursor)
    if (query.limit !== undefined) params.set('limit', String(query.limit))
    const items = [...this.records.values()].filter((record) => record.uid === uid && (!query.areaId || record.areaId === query.areaId))
      .map((record) => record.discovery).sort((a, b) => b.firstClearedAt.localeCompare(a.firstClearedAt) || a.discoveryId.localeCompare(b.discoveryId))
    return structuredClone(paginate(items, params, JSON.stringify(['discoveries', uid, query.areaId ?? null]), (item) => item.discoveryId))
  }

  async getOwned(uid: string, discoveryId: string): Promise<Discovery | null> {
    const record = this.records.get(discoveryId)
    return record?.uid === uid ? structuredClone(record.discovery) : null
  }

  // Internal first-clear lookup. Never expose another owner's place index or
  // use a public quest response as the source of private place identifiers.
  findByPlaceOwned(uid: string, placeId: string): Discovery | null {
    const id = this.places.get(JSON.stringify([uid, placeId]))
    const record = id && this.records.get(id)
    return record ? structuredClone(record.discovery) : null
  }

  async getPhotoOwned(uid: string, discoveryId: string): Promise<DiscoveryPhoto | null> {
    const record = this.records.get(discoveryId)
    return record?.uid === uid ? { bytes: Buffer.from(record.photo), contentType: 'image/jpeg' } : null
  }

  async deleteOwned(uid: string, discoveryId: string): Promise<DeletionReceipt | null> {
    const key = JSON.stringify([uid, discoveryId])
    const previous = this.deleted.get(key)
    if (previous) return { deletionId: previous }
    const record = this.records.get(discoveryId)
    if (!record || record.uid !== uid) return null
    if (this.deletions.size >= this.capacity) throw this.full()
    const deletionId = randomUUID()
    this.usedBytes -= record.photo.byteLength
    this.records.delete(discoveryId)
    this.places.delete(JSON.stringify([uid, record.discovery.placeId]))
    this.deletions.set(deletionId, { uid, status: { deletionId, state: 'completed', retryable: false } })
    this.deleted.set(key, deletionId)
    return { deletionId }
  }

  async getDeletionOwned(uid: string, deletionId: string): Promise<DeletionStatus | null> {
    const job = this.deletions.get(deletionId)
    return job?.uid === uid ? { ...job.status } : null
  }

  private full(): HttpError { return new HttpError(429, 'RATE_LIMITED', '開発用記録の上限に達しました。') }
}
