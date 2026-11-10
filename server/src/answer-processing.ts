import { PHOTO_UPLOAD_MAX_BYTES } from '../../src/shared/mediaLimits'
import { createHash } from 'node:crypto'
import type { CaptureMetadata, Challenge, Position } from '../../src/shared/api/types'
import { parseCaptureMetadata } from '../../src/shared/api/validation'
import type { DemoAnswerStore } from './answers'
import type { DemoChallengeStore } from './challenges'
import type { DemoDiscoveryStore } from './discoveries'
import type { FirstDiscoveryInput } from './discoveries'
import { evaluateLocation } from './location'
import type { LocationPolicy } from './location'
import { preparePhoto } from './photo-input'
import type { PhotoInput } from './photo-input'
import { comparePhotos, photoSystemError } from './photo-match'
import type { PhotoMatcher } from './photo-match'
import { authUnavailable, HttpError, unauthenticated } from './errors'
import { parseId } from './query'

export interface PrivateAnswerVersion {
  questId: string; version: number; status: 'published' | 'paused'
  placeId: string; areaId: string; placeName: string; descriptionSnapshot: string; revealedLocation: Position
  reference: PhotoInput; features: readonly string[]; locationPolicy: LocationPolicy
}
export interface ProcessingInput { digest: string; metadata: CaptureMetadata; photo: PhotoInput }
export interface DemoProcessingResult {
  source: 'mock'
  outcome: 'SAVED_IN_MEMORY' | 'ALREADY_SAVED_IN_MEMORY' | 'OUTSIDE_AREA' | 'LOCATION_UNCERTAIN' | 'WRONG_TARGET' | 'IMAGE_UNCERTAIN'
  discoveryId?: string
}
export interface ProcessorOptions {
  answers: DemoAnswerStore; challenges: DemoChallengeStore; discoveries: DemoDiscoveryStore
  currentQuest: (questId: string) => PrivateAnswerVersion | null
  authorize: (uid: string) => Promise<boolean>
  matcher?: PhotoMatcher; capacity?: number; concurrency?: number; timeoutMs?: number; maximumCheckpointBytes?: number
}

interface ProcessingJob {
  fingerprint: string; result?: Promise<DemoProcessingResult>; reservedBytes: number
  retryableSave: boolean; running: boolean; admissionRejected?: boolean
  checkpoint?: { versionHash: string; input: FirstDiscoveryInput }
}

export class DemoAnswerProcessor {
  private readonly jobs = new Map<string, ProcessingJob>()
  private active = 0
  private checkpointBytes = 0
  private readonly capacity: number
  private readonly concurrency: number
  private readonly maximumCheckpointBytes: number

  constructor(private readonly options: ProcessorOptions) {
    this.capacity = options.capacity ?? 256
    this.concurrency = options.concurrency ?? 1
    this.maximumCheckpointBytes = options.maximumCheckpointBytes ?? 32 * 1024 * 1024
    if (!Number.isSafeInteger(this.capacity) || this.capacity < 1 || this.capacity > 256 ||
      !Number.isSafeInteger(this.concurrency) || this.concurrency < 1 || this.concurrency > 4 ||
      !Number.isSafeInteger(this.maximumCheckpointBytes) || this.maximumCheckpointBytes < 1 || this.maximumCheckpointBytes > 32 * 1024 * 1024) throw new Error('Invalid demo processing limits.')
  }

  async process(uid: string, attemptId: string, input: ProcessingInput): Promise<DemoProcessingResult> {
    const receipt = this.options.answers.getAcceptedOwned(attemptId, uid)
    const challenge = receipt && this.options.challenges.getOwned(receipt.challengeId, uid)
    if (!receipt || !challenge) {
      const missing = new HttpError(404, 'NOT_FOUND', '見つかりません。')
      // Only a verified receipt owner may discard an expired recovery job.
      if (receipt) this.failRecovery(attemptId, missing)
      throw missing
    }
    if (receipt.digest !== input.digest) throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', '回答の内容が一致しません。')
    try { await this.authorize(uid) }
    catch (error) {
      if (!retryableSaveError(error)) this.failRecovery(attemptId, error)
      throw error
    }
    // Callers pass the unmodified server readAnswerInput output, not a browser
    // digest. Copy before awaiting decoding/matching; later edits cannot alter it.
    const metadata = parseCaptureMetadata(input.metadata)
    if (!input.photo || !Buffer.isBuffer(input.photo.bytes) || input.photo.bytes.length < 1 || input.photo.bytes.length > PHOTO_UPLOAD_MAX_BYTES) throw photoSystemError(false)
    const fingerprint = hash(JSON.stringify([metadata, input.photo.mimeType]), input.photo.bytes)
    const previous = this.jobs.get(attemptId)
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', '回答の内容が一致しません。')
      if (previous.retryableSave && !previous.running) {
        if (this.active >= this.concurrency) throw this.busy()
        this.execute(attemptId, previous, () => this.commit(uid, challenge, previous))
      }
      return { ...await previous.result! }
    }
    if (this.jobs.size >= this.capacity || this.active >= this.concurrency) throw this.busy()
    const photo = { bytes: Buffer.from(input.photo.bytes), mimeType: input.photo.mimeType }
    const job: ProcessingJob = { fingerprint, reservedBytes: 0, retryableSave: false, running: false }
    this.jobs.set(attemptId, job)
    return { ...await this.execute(attemptId, job,
      (track) => this.run(uid, challenge, receipt.receivedAt, receipt.result, metadata, photo, track, job)) }
  }

  private execute(attemptId: string, job: ProcessingJob,
    work: (track: (matcher: PhotoMatcher) => PhotoMatcher) => Promise<DemoProcessingResult>): Promise<DemoProcessingResult> {
    this.active++
    job.running = true
    job.retryableSave = false
    let finished = false
    let sending = false
    const release = () => { if (finished && !sending) this.active-- }
    // An uncooperative provider may settle after comparePhotos' deadline. Keep
    // its concurrency slot until it actually settles, ignoring its late result.
    const track = (matcher: PhotoMatcher): PhotoMatcher => ((value, call) => {
      sending = true
      const pending = Promise.resolve().then(() => matcher(value, call))
      const settle = () => { sending = false; release() }
      void pending.then(settle, settle)
      return pending
    })
    const result = Promise.resolve().then(() => work(track))
      .catch((error: unknown) => { throw error instanceof HttpError ? error : photoSystemError() })
    job.result = result
    const complete = () => {
      if (!job.retryableSave) this.discardCheckpoint(job)
      // Capacity rejection happens before any provider call. It is safe to
      // admit the same answer again after other checkpoints have been released.
      if (job.admissionRejected) this.jobs.delete(attemptId)
      job.running = false
      finished = true
      release()
    }
    void result.then(complete, complete)
    return result
  }

  private async run(uid: string, challenge: Challenge, receivedAt: number, accepted: { state: string; outcome: unknown },
    metadata: CaptureMetadata, photo: PhotoInput, track: (matcher: PhotoMatcher) => PhotoMatcher, job: ProcessingJob): Promise<DemoProcessingResult> {
    if (accepted.state === 'COMPLETED' && (accepted.outcome === 'OUTSIDE_AREA' || accepted.outcome === 'LOCATION_UNCERTAIN')) {
      return { source: 'mock', outcome: accepted.outcome }
    }
    const version = this.snapshot(challenge)
    const versionHash = versionFingerprint(version)
    const previous = this.options.discoveries.findByPlaceOwned(uid, version.placeId)
    if (previous) return { source: 'mock', outcome: 'ALREADY_SAVED_IN_MEMORY', discoveryId: previous.discoveryId }
    const location = evaluateLocation(metadata, version.locationPolicy, receivedAt)
    if (location !== 'WITHIN_AREA') return { source: 'mock', outcome: location }
    const candidate = await preparePhoto(photo)
    if (this.checkpointBytes + candidate.bytes.length > this.maximumCheckpointBytes) {
      job.admissionRejected = true
      throw this.busy()
    }
    this.checkpointBytes += candidate.bytes.length
    job.reservedBytes = candidate.bytes.length
    let gateFailure: HttpError | undefined
    const matcher = this.options.matcher
    const guarded = matcher && track(async (value, call) => {
      try {
        await this.authorize(uid)
        if (call.signal.aborted) throw new DOMException('中止しました。', 'AbortError')
        this.assertCurrent(challenge, versionHash)
      } catch (error) {
        if (error instanceof HttpError) gateFailure = error
        throw error
      }
      return matcher(value, call)
    })
    let decision
    try {
      decision = await comparePhotos({ reference: version.reference, candidate, features: version.features },
        { matcher: guarded, timeoutMs: this.options.timeoutMs })
    } catch (error) { throw gateFailure ?? error }
    // Both negative and matching image results must belong to a still-valid
    // owner and version. No result from a superseded task is committed.
    if (decision !== 'MATCH') {
      await this.authorize(uid)
      this.assertCurrent(challenge, versionHash)
      return { source: 'mock', outcome: decision }
    }
    job.checkpoint = { versionHash, input: {
      placeId: version.placeId, questId: version.questId, questVersion: version.version, areaId: version.areaId,
      placeName: version.placeName, descriptionSnapshot: version.descriptionSnapshot,
      revealedLocation: version.revealedLocation, photo: candidate.bytes,
    } }
    return this.commit(uid, challenge, job)
  }

  private async commit(uid: string, challenge: Challenge, job: ProcessingJob): Promise<DemoProcessingResult> {
    const checkpoint = job.checkpoint
    if (!checkpoint) throw photoSystemError(false)
    try {
      await this.authorize(uid)
      this.assertCurrent(challenge, checkpoint.versionHash)
      // No await between the synchronous version check and memory mutation.
      // Durable adapters must make the check and write atomic in their DB.
      const saved = await this.options.discoveries.saveFirstClear(uid, checkpoint.input, { location: 'WITHIN_AREA', photo: 'MATCH' })
      return { source: 'mock', outcome: saved.created ? 'SAVED_IN_MEMORY' : 'ALREADY_SAVED_IN_MEMORY', discoveryId: saved.discovery.discoveryId }
    } catch (error) {
      const failure = error instanceof HttpError ? error : photoSystemError()
      job.retryableSave = retryableSaveError(failure)
      throw failure
    }
  }

  private discardCheckpoint(job: ProcessingJob): void {
    this.checkpointBytes -= job.reservedBytes
    job.reservedBytes = 0
    job.checkpoint = undefined
  }

  private failRecovery(attemptId: string, error: unknown): void {
    const job = this.jobs.get(attemptId)
    if (!job?.retryableSave) return
    this.discardCheckpoint(job)
    job.retryableSave = false
    job.result = Promise.reject(error)
    void job.result.catch(() => {})
  }

  private busy(): HttpError {
    return new HttpError(429, 'RATE_LIMITED', '時間をおいて再試行してください。', true, 1)
  }

  private async authorize(uid: string): Promise<void> {
    let allowed: boolean
    try { allowed = await this.options.authorize(uid) } catch { throw authUnavailable() }
    if (allowed !== true) throw unauthenticated()
  }

  private assertCurrent(challenge: Challenge, fingerprint: string): void {
    if (versionFingerprint(this.snapshot(challenge)) !== fingerprint) throw new HttpError(409, 'QUEST_CHANGED', '問題の版が変更されています。')
  }

  private snapshot(challenge: Challenge): PrivateAnswerVersion {
    let version: PrivateAnswerVersion | null
    try { version = this.options.currentQuest(challenge.questId) } catch { throw photoSystemError(false) }
    if (!version || version.status !== 'published') throw new HttpError(409, 'QUEST_UNAVAILABLE', 'この問題は利用できません。')
    if (version.questId !== challenge.questId || version.version !== challenge.version) throw new HttpError(409, 'QUEST_CHANGED', '問題の版が変更されています。')
    try {
      parseId(version.placeId); parseId(version.areaId)
      if (typeof version.placeName !== 'string' || !version.placeName.trim() || version.placeName.length > 200 ||
        typeof version.descriptionSnapshot !== 'string' || version.descriptionSnapshot.length > 4000 ||
        !Number.isFinite(version.revealedLocation?.latitude) || Math.abs(version.revealedLocation.latitude) > 90 ||
        !Number.isFinite(version.revealedLocation.longitude) || Math.abs(version.revealedLocation.longitude) > 180 ||
        !Buffer.isBuffer(version.reference?.bytes) || version.reference.bytes.length < 1 || version.reference.bytes.length > PHOTO_UPLOAD_MAX_BYTES ||
        !Array.isArray(version.features) || version.features.length < 1 || version.features.length > 20 ||
        !version.features.every((value) => typeof value === 'string' && value.trim() && value.length <= 300)) throw photoSystemError(false)
      return { questId: version.questId, version: version.version, status: 'published', placeId: version.placeId, areaId: version.areaId,
        placeName: version.placeName, descriptionSnapshot: version.descriptionSnapshot, revealedLocation: { ...version.revealedLocation },
        reference: { bytes: Buffer.from(version.reference.bytes), mimeType: version.reference.mimeType },
        features: [...version.features], locationPolicy: structuredClone(version.locationPolicy) }
    } catch { throw photoSystemError(false) }
  }
}

function retryableSaveError(error: unknown): boolean {
  return error instanceof HttpError && error.status === 503 && error.retryable
}

function hash(text: string, bytes: Buffer): string { return createHash('sha256').update(text).update('\0').update(bytes).digest('hex') }
function versionFingerprint(version: PrivateAnswerVersion): string {
  const { reference, ...fields } = version
  return hash(JSON.stringify([fields, reference.mimeType]), reference.bytes)
}
