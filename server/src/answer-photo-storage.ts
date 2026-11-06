import { createHash } from 'node:crypto'
import type { Storage } from 'firebase-admin/storage'
import { DISCOVERY_PHOTO_MAX_BYTES } from '../../src/shared/api/types'
import { HttpError, invalidInput } from './errors'
import { conflict, incomingAnswerPhotoPath, recordAnswerPhotoPath, validDigest, validGeneration, validRecordPhotoPath } from './firestore-answer-data'
import type { PhotoInput, PreparedPhoto } from './photo-input'
import { parseId } from './query'

export interface PhotoReference { path: string; generation: string }
interface ListedAnswerPhoto extends PhotoReference { attemptId: string; createdAt: number }
export interface IncomingPhotoObject extends ListedAnswerPhoto { kind: 'incoming'; digest: string }
export type AnswerPhotoObject = IncomingPhotoObject | (ListedAnswerPhoto & { kind: 'record' })
type Bucket = ReturnType<Storage['bucket']>
interface ObjectMetadata {
  generation?: unknown
  size?: unknown
  contentType?: unknown
  contentEncoding?: unknown
  metadata?: Record<string, unknown>
}

// A server-only adapter. Callers authorize the answer or discovery before
// asking for its object; the injected bucket must deny public access.
export class AnswerPhotoStorage {
  constructor(private readonly bucket: Bucket) {}

  async writeReference(orgId: string, assetId: string, photo: PreparedPhoto): Promise<PhotoReference> {
    return this.writePrepared(referencePath(orgId, assetId), photo)
  }

  async readReference(orgId: string, assetId: string, generation: string): Promise<PhotoInput> {
    return this.read({ path: referencePath(orgId, assetId), generation })
  }

  async writeHint(orgId: string, assetId: string, photo: PreparedPhoto): Promise<PhotoReference> {
    return this.writePrepared(hintPath(orgId, assetId), photo)
  }

  async readHint(orgId: string, assetId: string, generation: string): Promise<PhotoInput> {
    return this.read({ path: hintPath(orgId, assetId), generation })
  }

  async writeIncoming(attemptId: string, digest: string, photo: PreparedPhoto): Promise<PhotoReference> {
    return this.writePrepared(incomingPath(attemptId, digest), photo)
  }

  async readIncoming(attemptId: string, digest: string, reference: PhotoReference): Promise<PhotoInput> {
    if (reference?.path !== incomingPath(attemptId, digest)) invalidInput()
    return this.read(reference)
  }

  async listAnswerPhotos(maximum: number, cursor?: string) {
    return storageOperation(async () => {
      const [files, next] = await this.bucket.getFiles({ prefix: 'answer-photos/', matchGlob: 'answer-photos/*/{incoming-*.jpg,record.jpg}',
        autoPaginate: false, maxResults: maximum, pageToken: cursor })
      if (files.length > maximum) throw storageError(false)
      const photos = files.flatMap((file): AnswerPhotoObject[] => {
        const match = /^answer-photos\/([a-f0-9]{64})\/(?:incoming-([a-f0-9]{64})|record)\.jpg$/.exec(file.name)
        const createdAt = Date.parse(file.metadata.timeCreated ?? '')
        if (!match || !Number.isFinite(createdAt)) return []
        try {
          const { generation } = checkedMetadata(file.metadata)
          const [ , attemptId, digest] = match
          const reference = { attemptId, path: file.name, generation, createdAt }
          return [digest ? { ...reference, kind: 'incoming', digest } : { ...reference, kind: 'record' }]
        } catch (error) {
          if (error instanceof HttpError) return []
          throw error
        }
      })
      return { photos, cursor: next?.pageToken }
    })
  }

  async writeRecord(attemptId: string, digest: string, source: PhotoReference): Promise<PhotoReference> {
    const photo = await this.readIncoming(attemptId, digest, source)
    return this.writeOnce(recordAnswerPhotoPath(attemptId), photo.bytes)
  }

  async readRecord(reference: PhotoReference): Promise<PhotoInput> {
    if (!validRecordPhotoPath(reference?.path)) invalidInput()
    return this.read(reference)
  }

  async deleteRecord(reference: PhotoReference): Promise<void> {
    if (!validRecordPhotoPath(reference?.path)) invalidInput()
    return this.deleteGeneration(reference)
  }

  async deleteIncoming(attemptId: string, digest: string, reference: PhotoReference): Promise<void> {
    if (reference?.path !== incomingPath(attemptId, digest)) invalidInput()
    return this.deleteGeneration(reference)
  }

  private async deleteGeneration(reference: PhotoReference): Promise<void> {
    if (!readableGeneration(reference.generation)) invalidInput()
    const { path, generation } = reference
    return storageOperation(async () => {
      const file = this.bucket.file(path, { generation })
      try { await file.delete({ ifGenerationMatch: generation, ignoreNotFound: true }) }
      catch (error) {
        if (statusCode(error) !== 412) throw error
        try { await file.getMetadata() }
        catch (lookupError) { if (statusCode(lookupError) === 404) return; throw lookupError }
        throw error
      }
    })
  }

  private async writeOnce(path: string, bytes: Buffer): Promise<PhotoReference> {
    // Copy before IO so the bytes and their checksum cannot drift apart.
    const data = Buffer.from(bytes)
    const sha256 = photoHash(data)
    const file = this.bucket.file(path)
    return storageOperation(async () => {
      try {
        await file.save(data, { resumable: false, validation: 'crc32c', preconditionOpts: { ifGenerationMatch: 0 },
          metadata: { contentType: 'image/jpeg', cacheControl: 'private, no-store', metadata: { answerSha256: sha256 } } })
      } catch (error) {
        // If another worker wrote first or the upload reply was lost, compare
        // the existing object. A different image cannot replace it.
        if (statusCode(error) !== 412) throw error
      }
      const [metadata] = await file.getMetadata()
      const stored = checkedMetadata(metadata)
      if (stored.sha256 !== sha256 || stored.size !== data.length) throw conflict()
      return { path, generation: stored.generation }
    })
  }

  private async writePrepared(path: string, photo: PreparedPhoto): Promise<PhotoReference> {
    if (photo?.mimeType !== 'image/jpeg' || !validJpeg(photo.bytes)) invalidInput()
    return this.writeOnce(path, photo.bytes)
  }

  private async read({ path, generation }: PhotoReference): Promise<PhotoInput> {
    if (!readableGeneration(generation)) invalidInput()
    return storageOperation(async () => {
      const file = this.bucket.file(path, { generation })
      const [metadata] = await file.getMetadata()
      const stored = checkedMetadata(metadata)
      if (stored.generation !== generation) throw storageError(false)
      const chunks: Buffer[] = []
      let size = 0
      for await (const chunk of file.createReadStream({ validation: 'crc32c', decompress: false })) {
        const bytes = Buffer.from(chunk)
        size += bytes.length
        if (size > stored.size) throw storageError(false)
        chunks.push(bytes)
      }
      const bytes = Buffer.concat(chunks, size)
      if (size !== stored.size || !validJpeg(bytes) || photoHash(bytes) !== stored.sha256) throw storageError(false)
      return { bytes, mimeType: 'image/jpeg' }
    })
  }
}

function referencePath(orgId: string, assetId: string): string {
  return `reference-photos/${parseId(orgId)}/${parseId(assetId)}.jpg`
}

function hintPath(orgId: string, assetId: string): string {
  return `hint-photos/${parseId(orgId)}/${parseId(assetId)}.jpg`
}

function incomingPath(attemptId: string, digest: string): string {
  if (typeof attemptId !== 'string' || !validDigest(digest)) invalidInput()
  return incomingAnswerPhotoPath(parseId(attemptId), digest)
}

function checkedMetadata(metadata: ObjectMetadata): { generation: string; size: number; sha256: string } {
  const generation = typeof metadata.generation === 'number' ? String(metadata.generation) : metadata.generation
  const size = Number(metadata.size)
  const sha256 = metadata.metadata?.answerSha256
  if (!readableGeneration(generation) || !Number.isSafeInteger(size) || size < 4 || size > DISCOVERY_PHOTO_MAX_BYTES ||
    metadata.contentType !== 'image/jpeg' || metadata.contentEncoding || !validDigest(sha256)) throw storageError(false)
  return { generation, size, sha256 }
}

function readableGeneration(value: unknown): value is string {
  // The installed SDK converts FileOptions.generation to a Number.
  return validGeneration(value) && Number.isSafeInteger(Number(value))
}

function validJpeg(bytes: unknown): bytes is Buffer {
  return Buffer.isBuffer(bytes) && bytes.length >= 4 && bytes.length <= DISCOVERY_PHOTO_MAX_BYTES &&
    bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
}

function photoHash(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

async function storageOperation<T>(work: () => Promise<T>): Promise<T> {
  try { return await work() }
  catch (error) {
    if (error instanceof HttpError) throw error
    throw storageError(![401, 403, 404, 412].includes(statusCode(error)))
  }
}

function statusCode(error: unknown): number {
  return error !== null && typeof error === 'object' && 'code' in error && typeof error.code === 'number' ? error.code : 0
}

function storageError(retryable: boolean): HttpError {
  return new HttpError(503, 'SYSTEM_ERROR', '写真の保存先を確認できませんでした。', retryable)
}
