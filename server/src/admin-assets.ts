import { NORMALIZED_PHOTO_MAX_BYTES } from '../../src/shared/mediaLimits'
import { randomUUID } from 'node:crypto'
import type { ManagedAsset, OrgAssetMetadata, UploadedOrgAsset } from '../../src/shared/api/admin'
import { parseUploadedOrgAsset } from '../../src/shared/api/admin'
import type { PreparedPhoto } from './photo-input'
import { HttpError, invalidInput } from './errors'

export const orgAssetLimits = { perOrg: 32, capacity: 128, maximumBytes: 32 * 1024 * 1024 }

export class DemoAssetStore {
  readonly mode = 'memory'
  private readonly assets = new Map<string, { asset: UploadedOrgAsset; bytes: Buffer }>()
  private readonly replays = new Map<string, { id: string; digest: string }>()
  private readonly windows = new Map<string, { start: number; count: number }>()
  private active = 0
  private bytes = 0
  private readonly capacity: number
  private readonly maximumBytes: number
  private readonly requestsPerMinute: number
  private readonly concurrentUploads: number
  private readonly now: () => number

  constructor(options: { capacity?: number; maximumBytes?: number; requestsPerMinute?: number; concurrentUploads?: number; now?: () => number } = {}) {
    this.capacity = options.capacity ?? orgAssetLimits.capacity
    this.maximumBytes = options.maximumBytes ?? orgAssetLimits.maximumBytes
    this.requestsPerMinute = options.requestsPerMinute ?? 10
    this.concurrentUploads = options.concurrentUploads ?? 2
    this.now = options.now ?? Date.now
    if (![[this.capacity, 128], [this.maximumBytes, 32 * 1024 * 1024], [this.requestsPerMinute, 60], [this.concurrentUploads, 4]]
      .every(([value, maximum]) => Number.isSafeInteger(value) && value > 0 && value <= maximum)) throw new Error('Invalid demo asset limits.')
  }

  acquire(uid: string): () => void {
    const now = this.now()
    if (!Number.isFinite(now)) throw this.full()
    for (const [key, window] of this.windows) if (now < window.start || now >= window.start + 60000) this.windows.delete(key)
    if (this.active >= this.concurrentUploads) throw new HttpError(429, 'RATE_LIMITED', '時間をおいて再試行してください。', true, 1)
    let window = this.windows.get(uid)
    if (!window) {
      if (this.windows.size >= 256) throw this.full()
      window = { start: now, count: 0 }; this.windows.set(uid, window)
    }
    if (window.count >= this.requestsPerMinute) throw new HttpError(429, 'RATE_LIMITED', '時間をおいて再試行してください。', true,
      Math.max(1, Math.ceil((window.start + 60000 - now) / 1000)))
    window.count++; this.active++
    let released = false
    return () => { if (!released) { released = true; this.active-- } }
  }

  findReplay(orgId: string, uid: string, key: string, digest: string): UploadedOrgAsset | null {
    const replay = this.replays.get(JSON.stringify([orgId, uid, key]))
    if (!replay) return null
    if (replay.digest !== digest) throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', '同じ素材キーで異なる内容は送信できません。')
    return { ...this.assets.get(replay.id)!.asset }
  }

  put(orgId: string, uid: string, key: string, digest: string, metadata: OrgAssetMetadata, photo: PreparedPhoto): { created: boolean; asset: UploadedOrgAsset } {
    const previous = this.findReplay(orgId, uid, key, digest)
    if (previous) return { created: false, asset: previous }
    if (!Buffer.isBuffer(photo.bytes) || photo.bytes.length < 4 || photo.bytes.length > NORMALIZED_PHOTO_MAX_BYTES) invalidInput()
    const orgCount = [...this.assets.values()].filter((item) => item.asset.orgId === orgId).length
    if (this.assets.size >= this.capacity || orgCount >= orgAssetLimits.perOrg || this.bytes + photo.bytes.length > this.maximumBytes) throw this.full()
    const asset = parseUploadedOrgAsset({ ...metadata, assetId: randomUUID(), orgId, contentType: 'image/jpeg', width: photo.width,
      height: photo.height, byteLength: photo.bytes.length, source: 'mock' })
    this.assets.set(asset.assetId, { asset, bytes: Buffer.from(photo.bytes) })
    this.bytes += photo.bytes.length
    this.replays.set(JSON.stringify([orgId, uid, key]), { id: asset.assetId, digest })
    return { created: true, asset: { ...asset } }
  }

  metadata(assetId: string): ManagedAsset | undefined {
    const asset = this.assets.get(assetId)?.asset
    return asset ? { assetId: asset.assetId, orgId: asset.orgId, purpose: asset.purpose } : undefined
  }

  getOwned(orgId: string, assetId: string): UploadedOrgAsset | null {
    const asset = this.assets.get(assetId)?.asset
    return asset?.orgId === orgId ? { ...asset } : null
  }

  getPhotoOwned(orgId: string, assetId: string): Buffer | null {
    const stored = this.assets.get(assetId)
    return stored?.asset.orgId === orgId ? Buffer.from(stored.bytes) : null
  }

  private full(): HttpError { return new HttpError(429, 'RATE_LIMITED', '開発用素材の上限に達しました。') }
}
