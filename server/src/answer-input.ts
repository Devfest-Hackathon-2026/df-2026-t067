import { createHash } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import { ContractError, parseCaptureMetadata } from '../../src/shared/api/validation'
import type { CaptureMetadata } from '../../src/shared/api/types'
import { invalidInput } from './errors'
import { readPhotoForm } from './photo-form'
import { preparePhoto } from './photo-input'
import type { PreparedPhoto } from './photo-input'

export { readIdempotencyKey as answerKey } from './idempotency-key'

// Consume bounded bytes only for this call. Retain no photo, position, filename
// or raw multipart body in the receipt store; compare normalized content hashes.
export async function readAnswerInput(request: IncomingMessage): Promise<{ digest: string; metadata: CaptureMetadata; photo: PreparedPhoto }> {
  const { image, mimeType: mime, metadata } = await readPhotoForm(request)
  let capture: CaptureMetadata
  try { capture = parseCaptureMetadata(JSON.parse(metadata)) }
  catch (error) { if (error instanceof ContractError || error instanceof SyntaxError) invalidInput(); throw error }
  const digest = createHash('sha256').update(JSON.stringify([mime, capture])).update('\0').update(image).digest('hex')
  const photoInput = await preparePhoto({ bytes: image, mimeType: mime })
  return { digest, metadata: capture, photo: photoInput }
}
