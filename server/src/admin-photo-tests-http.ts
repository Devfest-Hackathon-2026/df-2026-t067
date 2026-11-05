import { createHash, randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { parsePhotoTestMetadata } from '../../src/shared/api/admin'
import type { ManagedQuest } from '../../src/shared/api/admin'
import { ContractError } from '../../src/shared/api/validation'
import type { DemoAssetStore } from './admin-assets'
import type { DemoPhotoTestStore } from './admin-photo-tests'
import { HttpError, invalidInput } from './errors'
import { readIdempotencyKey } from './idempotency-key'
import { comparePhotos, draftPhotoFeatures } from './photo-match'
import type { PhotoMatcher } from './photo-match'
import { readPhotoForm } from './photo-form'

export interface AdminPhotoTestOptions { matcher: PhotoMatcher; timeoutMs?: number; capacity?: number }

export async function handlePhotoTest(request: IncomingMessage, response: ServerResponse, input: {
  uid: string; orgId: string; questId: string; store?: DemoPhotoTestStore; assets?: DemoAssetStore; options?: AdminPhotoTestOptions
  acquire?: (uid: string) => () => void
  recheck: (expectedRevision: number) => Promise<ManagedQuest>
  send: (response: ServerResponse, status: number, body: unknown) => void
}): Promise<void> {
  const { store, assets, options, acquire } = input
  if (!store || !assets || typeof options?.matcher !== 'function' || !acquire) {
    throw new HttpError(503, 'SYSTEM_ERROR', '写真試験の照合が未接続です。')
  }
  const matcher = options.matcher
  const key = readIdempotencyKey(request)
  if (response.destroyed) invalidInput()
  const release = acquire(input.uid)
  const controller = new AbortController()
  const disconnect = () => { if (!response.writableEnded) controller.abort() }
  response.on('close', disconnect)
  try {
    const form = await readPhotoForm(request)
    let metadata
    try { metadata = parsePhotoTestMetadata(JSON.parse(form.metadata)) }
    catch (error) { if (error instanceof ContractError || error instanceof SyntaxError) invalidInput(); throw error }
    const quest = await input.recheck(metadata.expectedDraftRevision)
    controller.signal.throwIfAborted()
    const assetId = quest.draft.referenceAssetId
    const reference = assetId && assets.getOwned(input.orgId, assetId)
    const bytes = assetId && assets.getPhotoOwned(input.orgId, assetId)
    const features = draftPhotoFeatures(quest.draft.content.verifiedFeatures)
    if (!reference || reference.purpose !== 'reference' || !bytes || !features) invalidInput()
    const digest = createHash('sha256').update(JSON.stringify([input.orgId, input.questId, metadata, assetId, features, form.mimeType]))
      .update('\0').update(form.image).digest('hex')
    const index = JSON.stringify([input.uid, input.orgId, input.questId, key])
    const result = await store.execute(index, digest, async (track) => {
      let gateFailure: unknown
      const guarded = track(async (value, call) => {
        try {
          await input.recheck(metadata.expectedDraftRevision)
          call.signal.throwIfAborted()
        } catch (error) { gateFailure = error; throw error }
        return matcher(value, call)
      })
      let outcome
      try {
        outcome = await comparePhotos({ reference: { bytes, mimeType: 'image/jpeg' },
          candidate: { bytes: form.image, mimeType: form.mimeType }, features },
        { matcher: guarded, signal: controller.signal, timeoutMs: options.timeoutMs })
      } catch (error) { throw gateFailure ?? error }
      await input.recheck(metadata.expectedDraftRevision)
      controller.signal.throwIfAborted()
      return { testId: randomUUID(), orgId: input.orgId, questId: input.questId,
        draftRevision: metadata.expectedDraftRevision, outcome, source: 'mock' }
    })
    await input.recheck(metadata.expectedDraftRevision)
    controller.signal.throwIfAborted()
    input.send(response, 200, result)
  } finally { response.off('close', disconnect); release() }
}
