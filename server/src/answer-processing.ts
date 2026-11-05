import { createHash } from 'node:crypto'
import type { CaptureMetadata, Challenge, Position } from '../../src/shared/api/types'
import { parseCaptureMetadata } from '../../src/shared/api/validation'
import type { DemoAnswerStore } from './answers'
import type { DemoChallengeStore } from './challenges'
import type { DemoDiscoveryStore } from './discoveries'
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
  matcher?: PhotoMatcher; capacity?: number; concurrency?: number; timeoutMs?: number
}

export class DemoAnswerProcessor {
  private readonly jobs = new Map<string, { fingerprint: string; result: Promise<DemoProcessingResult> }>()
  private active = 0
  private readonly capacity: number
  private readonly concurrency: number

  constructor(private readonly options: ProcessorOptions) {
    this.capacity = options.capacity ?? 256
    this.concurrency = options.concurrency ?? 1
    if (!Number.isSafeInteger(this.capacity) || this.capacity < 1 || this.capacity > 256 ||
      !Number.isSafeInteger(this.concurrency) || this.concurrency < 1 || this.concurrency > 4) throw new Error('Invalid demo processing limits.')
  }

  async process(uid: string, attemptId: string, input: ProcessingInput): Promise<DemoProcessingResult> {
    const receipt = this.options.answers.getAcceptedOwned(attemptId, uid)
    const challenge = receipt && this.options.challenges.getOwned(receipt.challengeId, uid)
    if (!receipt || !challenge) throw new HttpError(404, 'NOT_FOUND', '見つかりません。')
    if (receipt.digest !== input.digest) throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', '回答の内容が一致しません。')
    await this.authorize(uid)
    // Callers pass the unmodified server readAnswerInput output, not a browser
    // digest. Copy before awaiting decoding/matching; later edits cannot alter it.
    const metadata = parseCaptureMetadata(input.metadata)
    if (!input.photo || !Buffer.isBuffer(input.photo.bytes) || input.photo.bytes.length < 1 || input.photo.bytes.length > 4 * 1024 * 1024) throw photoSystemError(false)
    const fingerprint = hash(JSON.stringify([metadata, input.photo.mimeType]), input.photo.bytes)
    const previous = this.jobs.get(attemptId)
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', '回答の内容が一致しません。')
      return { ...await previous.result }
    }
    if (this.jobs.size >= this.capacity || this.active >= this.concurrency) throw new HttpError(429, 'RATE_LIMITED', '時間をおいて再試行してください。', true, 1)
    const photo = { bytes: Buffer.from(input.photo.bytes), mimeType: input.photo.mimeType }
    this.active++
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
    const result = this.run(uid, challenge, receipt.receivedAt, receipt.result, metadata, photo, track)
      .catch((error: unknown) => { throw error instanceof HttpError ? error : photoSystemError() })
    this.jobs.set(attemptId, { fingerprint, result })
    const complete = () => { finished = true; release() }
    void result.then(complete, complete)
    return { ...await result }
  }

  private async run(uid: string, challenge: Challenge, receivedAt: number, accepted: { state: string; outcome: unknown },
    metadata: CaptureMetadata, photo: PhotoInput, track: (matcher: PhotoMatcher) => PhotoMatcher): Promise<DemoProcessingResult> {
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
    await this.authorize(uid)
    this.assertCurrent(challenge, versionHash)
    if (decision !== 'MATCH') return { source: 'mock', outcome: decision }
    // No await between the final synchronous version check and the memory
    // store's synchronous mutation. A durable adapter needs an atomic commit.
    const saved = await this.options.discoveries.saveFirstClear(uid, {
      placeId: version.placeId, questId: version.questId, questVersion: version.version, areaId: version.areaId,
      placeName: version.placeName, descriptionSnapshot: version.descriptionSnapshot,
      revealedLocation: version.revealedLocation, photo: candidate.bytes,
    }, { location, photo: decision })
    return { source: 'mock', outcome: saved.created ? 'SAVED_IN_MEMORY' : 'ALREADY_SAVED_IN_MEMORY', discoveryId: saved.discovery.discoveryId }
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
        !Buffer.isBuffer(version.reference?.bytes) || version.reference.bytes.length < 1 || version.reference.bytes.length > 4 * 1024 * 1024 ||
        !Array.isArray(version.features) || version.features.length < 1 || version.features.length > 20 ||
        !version.features.every((value) => typeof value === 'string' && value.trim() && value.length <= 300)) throw photoSystemError(false)
      return { questId: version.questId, version: version.version, status: 'published', placeId: version.placeId, areaId: version.areaId,
        placeName: version.placeName, descriptionSnapshot: version.descriptionSnapshot, revealedLocation: { ...version.revealedLocation },
        reference: { bytes: Buffer.from(version.reference.bytes), mimeType: version.reference.mimeType },
        features: [...version.features], locationPolicy: structuredClone(version.locationPolicy) }
    } catch { throw photoSystemError(false) }
  }
}

function hash(text: string, bytes: Buffer): string { return createHash('sha256').update(text).update('\0').update(bytes).digest('hex') }
function versionFingerprint(version: PrivateAnswerVersion): string {
  const { reference, ...fields } = version
  return hash(JSON.stringify([fields, reference.mimeType]), reference.bytes)
}
