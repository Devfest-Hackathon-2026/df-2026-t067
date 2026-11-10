import { createHash } from 'node:crypto'
import type { DocumentSnapshot, Firestore, Transaction } from 'firebase-admin/firestore'
import { parseUploadedOrgAsset } from '../../src/shared/api/admin'
import type { OrgAssetMetadata } from '../../src/shared/api/admin'
import { photoApprovalDigest } from './admin-photo-approvals'
import { DemoAssetStore, orgAssetLimits } from './admin-assets'
import type { AssetHttpStore } from './admin-assets-http'
import type { AnswerPhotoStorage } from './answer-photo-storage'
import { HttpError } from './errors'
import { answerTransaction, processingError, validDigest, validGeneration } from './firestore-answer-data'
import { requireOrgMember } from './firestore-org-memberships'
import type { PreparedPhoto } from './photo-input'

type AssetPhotos = Pick<AnswerPhotoStorage, 'writeReference' | 'readReference' | 'writeHint' | 'readHint'>

export class FirestoreOrgAssetStore implements AssetHttpStore {
  readonly approvedAssets = true
  private readonly uploadLimiter = new DemoAssetStore()

  constructor(private readonly db: Firestore, private readonly photos: AssetPhotos) {}

  acquire(uid: string) { return this.uploadLimiter.acquire(uid) }

  async assertMember(uid: string, orgId: string): Promise<void> {
    await answerTransaction(this.db, (tx) => requireOrgMember(this.db, tx, uid, orgId), true)
  }

  findReplay(orgId: string, uid: string, key: string, digest: string) {
    return answerTransaction(this.db, async (tx) => {
      const ref = this.db.collection('orgAssets').doc(hash([orgId, uid, key]))
      const record = readOrgAssetRecord(await tx.get(ref), orgId)
      assertDigest(record, digest)
      return record?.generation ? record.asset : null
    }, true)
  }

  async put(orgId: string, uid: string, key: string, digest: string, metadata: OrgAssetMetadata, photo: PreparedPhoto, approvalDigest = photoApprovalDigest(photo.bytes)) {
    const assetId = hash([orgId, uid, key])
    const ref = this.db.collection('orgAssets').doc(assetId)
    const asset = parseUploadedOrgAsset({ ...metadata, assetId, orgId, contentType: 'image/jpeg', width: photo.width,
      height: photo.height, byteLength: photo.bytes.length, source: 'real' })

    const previous = await answerTransaction(this.db, async (tx) => {
      await requireOrgMember(this.db, tx, uid, orgId)
      const snapshot = await tx.get(ref)
      const record = readOrgAssetRecord(snapshot, orgId)
      assertDigest(record, digest)
      if (record?.generation) return record.asset
      if (!snapshot.exists) {
        await this.reserveCapacity(tx, orgId, asset.byteLength)
        tx.create(ref, { asset, digest, approvalDigest })
      } else if (!record) {
        throw processingError()
      }
      return null
    })
    if (previous) return { created: false, asset: previous }

    // Storage I/O stays outside the transaction. The reserved ID, digest and
    // generation precondition make an interrupted upload safe to resume.
    const { generation } = metadata.purpose === 'reference'
      ? await this.photos.writeReference(orgId, assetId, photo)
      : await this.photos.writeHint(orgId, assetId, photo)
    if (!usableGeneration(generation)) throw processingError()

    return answerTransaction(this.db, async (tx) => {
      await requireOrgMember(this.db, tx, uid, orgId)
      const record = readOrgAssetRecord(await tx.get(ref), orgId)
      if (!record) throw processingError()
      assertDigest(record, digest)
      if (record.generation !== undefined) {
        if (record.generation !== generation) throw processingError()
        return { created: false, asset: record.asset }
      }
      tx.update(ref, { generation })
      return { created: true, asset: record.asset }
    })
  }

  async getOwned(orgId: string, assetId: string) {
    const record = await this.readOwned(orgId, assetId)
    return record?.generation ? record.asset : null
  }

  async getPhotoOwned(orgId: string, assetId: string) {
    const record = await this.readOwned(orgId, assetId)
    if (!record?.generation) return null
    const image = record.asset.purpose === 'reference'
      ? await this.photos.readReference(orgId, assetId, record.generation)
      : await this.photos.readHint(orgId, assetId, record.generation)
    if (image.bytes.length !== record.asset.byteLength) throw processingError()
    return image.bytes
  }

  private readOwned(orgId: string, assetId: string) {
    return answerTransaction(this.db, async (tx) =>
      readOrgAssetRecord(await tx.get(this.db.collection('orgAssets').doc(assetId)), orgId), true)
  }

  private async reserveCapacity(tx: Transaction, orgId: string, byteLength: number) {
    const usage = this.db.collection('orgAssetUsage')
    const [global, org] = await tx.getAll(usage.doc('global'), usage.doc('org-' + orgId))
    const count = usageValue(global, 'count')
    const bytes = usageValue(global, 'bytes')
    const orgCount = usageValue(org, 'count')
    if (count >= orgAssetLimits.capacity || orgCount >= orgAssetLimits.perOrg || bytes + byteLength > orgAssetLimits.maximumBytes) {
      throw new HttpError(429, 'RATE_LIMITED', '開発用素材の上限に達しました。')
    }
    tx.set(global.ref, { count: count + 1, bytes: bytes + byteLength })
    tx.set(org.ref, { count: orgCount + 1 })
  }
}

function hash(parts: string[]) {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex')
}

export function readOrgAssetRecord(snapshot: DocumentSnapshot, orgId: string) {
  const data = snapshot.data()
  if (!data || data.asset?.orgId !== orgId) return null
  const asset = parseUploadedOrgAsset(data.asset)
  const digest: unknown = data.digest
  const generation: unknown = data.generation
  if (asset.source !== 'real' || asset.assetId !== snapshot.id || !validDigest(digest) ||
    (generation !== undefined && !usableGeneration(generation))) throw processingError()
  const approvalDigest: unknown = data.approvalDigest ?? digest
  if (!validDigest(approvalDigest)) throw processingError()
  return { asset, digest, generation, approvalDigest }
}

function usableGeneration(value: unknown): value is string {
  return validGeneration(value) && Number.isSafeInteger(Number(value))
}

function assertDigest(record: ReturnType<typeof readOrgAssetRecord>, digest: string) {
  if (record && record.digest !== digest) {
    throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', '同じ素材キーで異なる内容は送信できません。')
  }
}

function usageValue(snapshot: DocumentSnapshot, field: string): number {
  if (!snapshot.exists) return 0
  const value = snapshot.get(field)
  if (!Number.isSafeInteger(value) || value < 0) throw processingError()
  return value
}
