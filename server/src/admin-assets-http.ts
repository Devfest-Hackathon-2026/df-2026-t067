import { createHash } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { photoApprovalDigest } from './admin-photo-approvals'
import { parseOrgAssetMetadata } from '../../src/shared/api/admin'
import type { OrgAssetMetadata, UploadedOrgAsset } from '../../src/shared/api/admin'
import { ContractError } from '../../src/shared/api/validation'
import { HttpError, invalidInput } from './errors'
import { readIdempotencyKey } from './idempotency-key'
import { readPhotoForm } from './photo-form'
import { preparePhoto } from './photo-input'
import type { PreparedPhoto } from './photo-input'

interface AssetWrite { created: boolean; asset: UploadedOrgAsset }
export interface AssetHttpStore {
  readonly mode?: 'memory'
  readonly approvedAssets?: true
  acquire(uid: string): () => void
  findReplay(orgId: string, uid: string, key: string, digest: string): UploadedOrgAsset | null | Promise<UploadedOrgAsset | null>
  put(orgId: string, uid: string, key: string, digest: string, metadata: OrgAssetMetadata, photo: PreparedPhoto, approvalDigest?: string): AssetWrite | Promise<AssetWrite>
  getOwned(orgId: string, assetId: string): UploadedOrgAsset | null | Promise<UploadedOrgAsset | null>
  getPhotoOwned(orgId: string, assetId: string): Buffer | null | Promise<Buffer | null>
}

export function matchAssetRoute(path: string) {
  return /^\/api\/v1\/orgs\/([^/]+)\/assets(?:\/([^/]+)(\/photo)?)?$/.exec(path)
}

export async function handleAssetRequest(request: IncomingMessage, response: ServerResponse, input: {
  store?: AssetHttpStore; uid: string; orgId: string; assetId?: string; photo: boolean
  recheck: () => Promise<void>; send: (response: ServerResponse, status: number, body: unknown) => void
}): Promise<void> {
  const store = input.store
  if (!store) throw new HttpError(503, 'SYSTEM_ERROR', '素材の保存先が未接続です。', true)
  if (store.mode) response.setHeader('X-Quest-Assets-Mode', store.mode)
  if (input.assetId) {
    if (response.destroyed || response.writableEnded) return
    if (input.photo) {
      const bytes = await store.getPhotoOwned(input.orgId, input.assetId)
      await input.recheck()
      if (!bytes) throw new HttpError(404, 'NOT_FOUND', '見つかりません。')
      if (response.destroyed || response.writableEnded) return
      response.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': bytes.length, 'Content-Disposition': 'inline' })
      response.end(bytes)
    } else {
      const asset = await store.getOwned(input.orgId, input.assetId)
      await input.recheck()
      if (!asset) throw new HttpError(404, 'NOT_FOUND', '見つかりません。')
      input.send(response, 200, asset)
    }
    return
  }
  const key = readIdempotencyKey(request)
  const release = store.acquire(input.uid)
  try {
    const form = await readPhotoForm(request)
    let metadata
    try { metadata = parseOrgAssetMetadata(JSON.parse(form.metadata), store.approvedAssets === true) }
    catch (error) { if (error instanceof ContractError || error instanceof SyntaxError) invalidInput(); throw error }
    const digest = createHash('sha256').update(JSON.stringify([input.orgId, metadata, form.mimeType])).update('\0').update(form.image).digest('hex')
    await input.recheck()
    const previous = await store.findReplay(input.orgId, input.uid, key, digest)
    if (previous) { await input.recheck(); input.send(response, 200, previous); return }
    const prepared = await preparePhoto({ bytes: form.image, mimeType: form.mimeType })
    await input.recheck()
    if (response.destroyed) invalidInput()
    const result = await store.put(input.orgId, input.uid, key, digest, metadata, prepared, photoApprovalDigest(form.image))
    input.send(response, result.created ? 201 : 200, result.asset)
  } finally { release() }
}
