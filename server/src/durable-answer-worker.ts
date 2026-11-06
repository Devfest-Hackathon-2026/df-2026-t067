import type { Firestore } from 'firebase-admin/firestore'
import type { AttemptResult } from '../../src/shared/api/types'
import type { AnswerPhotoStorage } from './answer-photo-storage'
import { authUnavailable, HttpError, unauthenticated } from './errors'
import { processingError } from './firestore-answer-data'
import { assertAnswerWorkLive, claimAnswerWork, commitVerifiedAnswer, completeKnownDiscovery, recordAnswerMatch,
  recordAnswerPhoto, recordRejectedAnswer, settleInvalidatedAnswer } from './firestore-answer-processing'
import type { AnswerIdentity, ClaimOptions, LeasedAnswer } from './firestore-answer-processing'
import { evaluateLocation } from './location'
import type { LocationPolicy } from './location'
import type { PhotoInput } from './photo-input'
import { comparePhotos, photoSystemError } from './photo-match'
import type { PhotoMatcher } from './photo-match'

export interface VerificationVersion { questId: string; version: number; placeId: string }
interface WorkerOptions extends ClaimOptions {
  db: Firestore
  photos: Pick<AnswerPhotoStorage, 'readIncoming' | 'writeRecord'>
  authorize(uid: string): Promise<boolean>
  locationPolicy(version: VerificationVersion): Promise<LocationPolicy>
  loadReference(version: VerificationVersion): Promise<{ reference: PhotoInput; features: readonly string[] }>
  matcher: PhotoMatcher
  signal?: AbortSignal
  matchTimeoutMs?: number
}

type WorkerResult = { kind: 'busy' | 'verification-expired' } | { kind: 'completed'; result: AttemptResult }

// The scheduler passes an authenticated owner and resolves private material
// for the published version. This worker does not select a provider or policy.
export async function runDurableAnswer(input: AnswerIdentity, options: WorkerOptions): Promise<WorkerResult> {
  const { db, photos } = options
  let lease: LeasedAnswer | undefined
  let writtenGeneration: string | undefined
  try {
    await requireAuthorization(input.uid, options)
    const work = await claimAnswerWork(db, input, options)
    if (work.kind !== 'claimed') return work
    lease = { ...input, leaseId: work.leaseId }
    if (work.step === 'verify') {
      await requireAuthorization(input.uid, options)
      const existing = await completeKnownDiscovery(db, lease)
      if (existing) return { kind: 'completed', result: existing }
      const version = { questId: work.questId, version: work.version, placeId: work.placeId }
      let policy: LocationPolicy
      try { policy = await options.locationPolicy(version) }
      catch (error) { throw error instanceof HttpError ? error : processingError(true) }
      const location = evaluateLocation(work.source.metadata, policy, work.source.receivedAt)
      if (location !== 'WITHIN_AREA') {
        await requireAuthorization(input.uid, options)
        return { kind: 'completed', result: await recordRejectedAnswer(db, lease, location) }
      }
      const decision = await matchAnswer(lease, version, work.source.photoObject, options)
      await requireAuthorization(input.uid, options)
      if (decision !== 'MATCH') return { kind: 'completed', result: await recordRejectedAnswer(db, lease, decision) }
      await recordAnswerMatch(db, lease, { placeId: work.placeId, version: work.version, location, photo: decision })
    }
    if (work.step !== 'commit') {
      await requireAuthorization(input.uid, options)
      await assertAnswerWorkLive(db, lease, 'prepare-photo')
      throwIfAborted(options.signal)
      const photo = await photos.writeRecord(input.attemptId, input.digest, work.source.photoObject)
      writtenGeneration = photo.generation
      await requireAuthorization(input.uid, options)
      await recordAnswerPhoto(db, lease, writtenGeneration)
    }
    await requireAuthorization(input.uid, options)
    return { kind: 'completed', result: await commitVerifiedAnswer(db, lease) }
  } catch (error) {
    return settleInvalidatedAnswer(db, input, error, lease?.leaseId, writtenGeneration)
  }
}

async function matchAnswer(lease: LeasedAnswer, version: VerificationVersion,
  source: Parameters<AnswerPhotoStorage['readIncoming']>[2], options: WorkerOptions) {
  if (typeof options.matcher !== 'function') throw photoSystemError(false)
  await requireAuthorization(lease.uid, options)
  await assertAnswerWorkLive(options.db, lease, 'verify')
  throwIfAborted(options.signal)
  const candidate = await options.photos.readIncoming(lease.attemptId, lease.digest, source)
  let material
  try { material = await options.loadReference(version) }
  catch (error) { throw error instanceof HttpError ? error : photoSystemError() }
  let gateFailure: HttpError | undefined
  try {
    return await comparePhotos({ ...material, candidate }, {
      signal: options.signal, timeoutMs: options.matchTimeoutMs,
      matcher: async (photos, call) => {
        try {
          await requireAuthorization(lease.uid, options, call.signal)
          await assertAnswerWorkLive(options.db, lease, 'verify')
          throwIfAborted(call.signal)
        } catch (error) {
          if (error instanceof HttpError) gateFailure = error
          throw error
        }
        return options.matcher(photos, call)
      },
    })
  } catch (error) { throw gateFailure ?? error }
}

async function requireAuthorization(uid: string, options: WorkerOptions, signal = options.signal): Promise<void> {
  throwIfAborted(signal)
  let allowed: boolean
  try { allowed = await options.authorize(uid) } catch { throw authUnavailable() }
  throwIfAborted(signal)
  if (allowed !== true) throw unauthenticated()
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('回答の処理を中止しました。', 'AbortError')
}
