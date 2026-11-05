import { createHash } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { parseOrgAssetMetadata } from '../../src/shared/api/admin'
import { ContractError } from '../../src/shared/api/validation'
import type { DemoAssetStore } from './admin-assets'
import { HttpError, invalidInput } from './errors'
import { readIdempotencyKey } from './idempotency-key'
import { readPhotoForm } from './photo-form'
import { preparePhoto } from './photo-input'

export async function handleAssetRequest(request: IncomingMessage, response: ServerResponse, input: {
  store?: DemoAssetStore; uid: string; orgId: string; assetId?: string; photo: boolean
  recheck: () => Promise<void>; send: (response: ServerResponse, status: number, body: unknown) => void
}): Promise<void> {
  const store = input.store
  if (!store) throw new HttpError(503, 'SYSTEM_ERROR', '素材の保存先が未接続です。', true)
  response.setHeader('X-Quest-Assets-Mode', 'memory')
  if (input.assetId) {
    if (response.destroyed || response.writableEnded) return
    if (input.photo) {
      const bytes = store.getPhotoOwned(input.orgId, input.assetId)
      if (!bytes) throw new HttpError(404, 'NOT_FOUND', '見つかりません。')
      response.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': bytes.length, 'Content-Disposition': 'inline' })
      response.end(bytes)
    } else {
      const asset = store.getOwned(input.orgId, input.assetId)
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
    try { metadata = parseOrgAssetMetadata(JSON.parse(form.metadata)) }
    catch (error) { if (error instanceof ContractError || error instanceof SyntaxError) invalidInput(); throw error }
    const digest = createHash('sha256').update(JSON.stringify([input.orgId, metadata, form.mimeType])).update('\0').update(form.image).digest('hex')
    await input.recheck()
    const previous = store.findReplay(input.orgId, input.uid, key, digest)
    if (previous) { input.send(response, 200, previous); return }
    const prepared = await preparePhoto({ bytes: form.image, mimeType: form.mimeType })
    await input.recheck()
    if (response.destroyed) invalidInput()
    const result = store.put(input.orgId, input.uid, key, digest, metadata, prepared)
    input.send(response, result.created ? 201 : 200, result.asset)
  } finally { release() }
}
