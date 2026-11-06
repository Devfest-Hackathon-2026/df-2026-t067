import { createHash, randomUUID } from 'node:crypto'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import type { DocumentData, DocumentSnapshot, Firestore, Transaction } from 'firebase-admin/firestore'
import type { AttemptResult } from '../../src/shared/api/types'
import { parseDiscovery } from '../../src/shared/api/validation'
import { invalidInput } from './errors'
import { answerTransaction, conflict, discoveryKeyId, notFound, processingError, questChanged, readAnswerSource, readCurrentVersion, recordAnswerPhotoPath,
  storedAnswerResult, storedId, validAnswerUid, validDigest, validGeneration, validRecordPhotoPath } from './firestore-answer-data'
import { parseId } from './query'

export interface AnswerIdentity {
  uid: string
  attemptId: string
  digest: string
}

export interface LeasedAnswer extends AnswerIdentity { leaseId: string }
interface MatchProof { placeId: string; version: number; location: 'WITHIN_AREA'; photo: 'MATCH' }
export interface ClaimOptions { leaseDurationMs: number; retryVerification?: boolean }
type WorkStep = 'verify' | 'prepare-photo' | 'commit'
type ClaimedAnswer = { kind: 'claimed'; leaseId: string; questId: string; version: number; placeId: string } & (
  | { step: 'verify' | 'prepare-photo'; source: ReturnType<typeof readAnswerSource> }
  | { step: 'commit' }
)
type AnswerClaim =
  | ClaimedAnswer
  | { kind: 'busy' }
  | { kind: 'verification-expired' }
  | { kind: 'completed'; result: AttemptResult }

const rejectedOutcomes = ['OUTSIDE_AREA', 'LOCATION_UNCERTAIN', 'WRONG_TARGET', 'IMAGE_UNCERTAIN'] as const
type RejectedOutcome = typeof rejectedOutcomes[number]

// Firestore can retry transaction callbacks. The worker performs photo IO and
// model calls only after the transaction returns its assigned work step.
export async function claimAnswerWork(db: Firestore, input: AnswerIdentity, options: ClaimOptions): Promise<AnswerClaim> {
  const { leaseDurationMs, retryVerification } = options
  if (!Number.isSafeInteger(leaseDurationMs) || leaseDurationMs < 1) invalidInput()
  const leaseId = randomUUID()
  return withOwnedAnswer<AnswerClaim>(db, input, async (tx, receipt, data) => {
    if (data.state === 'COMPLETED') return { kind: 'completed', result: storedAnswerResult(data, input.attemptId) }
    const current = await readCurrentVersion(db, tx, data, input.uid)
    const lease = readLease(data)
    const step = workStep(data, current, lease !== undefined)
    const now = receipt.readTime.toMillis()
    if (lease && lease.expiresAt.toMillis() > now) return { kind: 'busy' }
    if (data.state === 'PROCESSING' && retryVerification !== true) return { kind: 'verification-expired' }
    const expiresAt = Timestamp.fromMillis(now + leaseDurationMs)
    const { questId, version, placeId } = current
    const claimed = { kind: 'claimed' as const, leaseId, questId, version, placeId }
    const result = step === 'commit' ? { ...claimed, step }
      : { ...claimed, step, source: readAnswerSource(data, input.attemptId) }
    tx.update(receipt.ref, {
      state: step === 'verify' ? 'PROCESSING' : data.state, lease: { id: leaseId, expiresAt },
      nextWorkAt: step === 'verify' ? FieldValue.delete() : expiresAt,
    })
    return result
  })
}

export async function recordAnswerMatch(db: Firestore, input: LeasedAnswer, proof: MatchProof): Promise<void> {
  if (typeof proof?.placeId !== 'string' || !Number.isSafeInteger(proof.version) || proof.version < 1 ||
    proof.location !== 'WITHIN_AREA' || proof.photo !== 'MATCH') invalidInput()
  parseId(proof.placeId)
  return withOwnedAnswer(db, input, async (tx, receipt, data) => {
    const lease = requireLiveLease(receipt, data, input.leaseId)
    const current = await readCurrentVersion(db, tx, data, input.uid)
    if (current.version !== proof.version) throw questChanged()
    if (current.placeId !== proof.placeId) throw processingError()
    if (data.state === 'IMAGE_EVALUATED' || data.state === 'COMMITTING') {
      workStep(data, current, true)
      return
    }
    if (data.state !== 'PROCESSING' || data.checkpoint !== undefined) throw processingError(true)
    const { placeId, version, location, photo } = proof
    tx.update(receipt.ref, { state: 'IMAGE_EVALUATED', checkpoint: { placeId, version, location, photo }, nextWorkAt: lease.expiresAt })
  })
}

// The worker has already written this specific generation of the private JPEG.
export async function recordAnswerPhoto(db: Firestore, input: LeasedAnswer, generation: string): Promise<void> {
  if (!validGeneration(generation)) invalidInput()
  return withOwnedAnswer(db, input, async (tx, receipt, data) => {
    requireLiveLease(receipt, data, input.leaseId)
    if (data.state !== 'IMAGE_EVALUATED' && data.state !== 'COMMITTING') throw processingError(true)
    const current = await readCurrentVersion(db, tx, data, input.uid)
    assertMatchCheckpoint(data, current)
    if (data.state === 'COMMITTING') {
      if (preparedGeneration(data) !== generation) throw conflict()
      return
    }
    tx.update(receipt.ref, { state: 'COMMITTING', 'checkpoint.generation': generation })
  })
}

export async function assertAnswerWorkLive(db: Firestore, input: LeasedAnswer, step: WorkStep): Promise<void> {
  return withOwnedAnswer(db, input, async (tx, receipt, data) => {
    requireLiveLease(receipt, data, input.leaseId)
    const current = await readCurrentVersion(db, tx, data, input.uid)
    if (workStep(data, current, true) !== step) throw processingError(true)
  })
}

export async function recordRejectedAnswer(db: Firestore, input: LeasedAnswer, outcome: RejectedOutcome): Promise<AttemptResult> {
  if (!rejectedOutcomes.includes(outcome)) invalidInput()
  return withOwnedAnswer(db, input, async (tx, receipt, data) => {
    requireLiveLease(receipt, data, input.leaseId)
    const current = await readCurrentVersion(db, tx, data, input.uid)
    if (workStep(data, current, true) !== 'verify') throw processingError(true)
    return finishAttempt(tx, receipt, { attemptId: input.attemptId, state: 'COMPLETED', source: 'real', outcome,
      nextAction: outcome === 'OUTSIDE_AREA' ? 'MOVE_TO_AREA' : 'RETAKE' })
  })
}

export async function completeKnownDiscovery(db: Firestore, input: LeasedAnswer): Promise<AttemptResult | null> {
  return withOwnedAnswer(db, input, async (tx, receipt, data) => {
    requireLiveLease(receipt, data, input.leaseId)
    const current = await readCurrentVersion(db, tx, data, input.uid)
    if (workStep(data, current, true) !== 'verify') throw processingError(true)
    const { discovery, existing, deletedAt } = await readDiscovery(db, tx, input.uid, current.placeId)
    if (submittedBeforeDeletion(data, deletedAt)) return finishDeletedAnswer(tx, receipt)
    if (!existing) return null
    return finishAttempt(tx, receipt, { attemptId: input.attemptId, state: 'COMPLETED', source: 'real',
      outcome: 'ALREADY_CLEARED', optionalDiscoveryId: discovery.id, nextAction: 'VIEW_DISCOVERY' })
  })
}

export async function commitVerifiedAnswer(db: Firestore, input: LeasedAnswer): Promise<AttemptResult> {
  const { uid, attemptId, leaseId } = input
  validateLeaseId(leaseId)
  return withOwnedAnswer(db, input, async (tx, receipt, data) => {
    if (data.state === 'COMPLETED') return storedAnswerResult(data, attemptId)
    if (data.state !== 'COMMITTING') throw processingError(true)
    requireLiveLease(receipt, data, leaseId)
    const current = await readCurrentVersion(db, tx, data, uid)
    const { questId, version, placeId, snapshot } = current
    assertMatchCheckpoint(data, current)
    const generation = preparedGeneration(data)
    const { key, discovery, existing, deletedAt } = await readDiscovery(db, tx, uid, placeId)
    if (submittedBeforeDeletion(data, deletedAt)) return finishDeletedAnswer(tx, receipt)
    const discoveryId = existing ? discovery.id : createHash('sha256').update(JSON.stringify([uid, placeId, attemptId])).digest('hex')
    if (!existing) {
      const areaId = storedId(snapshot.areaId)
      if (typeof snapshot.placeName !== 'string' || !snapshot.placeName.trim() || snapshot.placeName.length > 200 ||
        typeof snapshot.descriptionSnapshot !== 'string' || snapshot.descriptionSnapshot.length > 4000) throw processingError()
      const record = parseDiscovery({
        discoveryId, placeId, questId, questVersion: version, placeName: snapshot.placeName,
        descriptionSnapshot: snapshot.descriptionSnapshot, revealedLocation: snapshot.revealedLocation,
        ownerPhoto: `/api/v1/me/discoveries/${discoveryId}/photo`, firstClearedAt: receipt.readTime.toDate().toISOString(),
      })
      tx.create(db.collection('discoveries').doc(discoveryId), {
        ...record, uid, areaId, firstClearedAt: FieldValue.serverTimestamp(),
        photoObject: { path: recordAnswerPhotoPath(attemptId), generation },
      })
      tx.set(key, { discoveryId })
    }
    return finishAttempt(tx, receipt, { attemptId, state: 'COMPLETED', outcome: existing ? 'ALREADY_CLEARED' : 'CORRECT',
      optionalDiscoveryId: discoveryId, source: 'real', nextAction: 'VIEW_DISCOVERY' })
  })
}

async function readDiscovery(db: Firestore, tx: Transaction, uid: string, placeId: string) {
  const key = db.collection('discoveryKeys').doc(discoveryKeyId(uid, placeId))
  const mapping = (await tx.get(key)).data()
  if (mapping && mapping.discoveryId === undefined && !(mapping.deletedAt instanceof Timestamp)) throw processingError()
  const discoveryId = mapping?.discoveryId === undefined ? key.id : storedId(mapping.discoveryId)
  const discovery = db.collection('discoveries').doc(discoveryId)
  const existing = (await tx.get(discovery)).data()
  if (mapping?.discoveryId !== undefined && !existing) throw processingError()
  if (mapping?.deletedAt instanceof Timestamp && existing) throw processingError()
  if (existing && (existing.uid !== uid || existing.placeId !== placeId || existing.discoveryId !== discoveryId ||
    !(existing.firstClearedAt instanceof Timestamp) || !validGeneration(existing.photoObject?.generation) ||
    !validRecordPhotoPath(existing.photoObject.path))) throw processingError()
  return { key, discovery, existing, deletedAt: mapping?.deletedAt instanceof Timestamp ? mapping.deletedAt : undefined }
}

function submittedBeforeDeletion(data: DocumentData, deletedAt?: Timestamp): boolean {
  return deletedAt !== undefined && (!(data.receivedAt instanceof Timestamp) || data.receivedAt.toMillis() <= deletedAt.toMillis())
}

function finishDeletedAnswer(tx: Transaction, receipt: DocumentSnapshot): AttemptResult {
  return finishAttempt(tx, receipt, { attemptId: receipt.id, state: 'COMPLETED', source: 'real', outcome: 'SYSTEM_ERROR', nextAction: 'RETAKE' })
}

function finishAttempt(tx: Transaction, receipt: DocumentSnapshot, result: AttemptResult): AttemptResult {
  tx.update(receipt.ref, {
    state: 'COMPLETED', result, lease: FieldValue.delete(), checkpoint: FieldValue.delete(), capture: FieldValue.delete(),
    nextWorkAt: FieldValue.delete(),
  })
  return result
}

async function withOwnedAnswer<T>(db: Firestore, input: AnswerIdentity,
  work: (tx: Transaction, receipt: DocumentSnapshot, data: DocumentData) => Promise<T>): Promise<T> {
  const { uid, attemptId, digest } = input
  if (!validAnswerUid(uid) || typeof attemptId !== 'string' || !validDigest(digest)) invalidInput()
  const attempt = db.collection('attempts').doc(parseId(attemptId))
  return answerTransaction(db, async (tx) => {
    const receipt = await tx.get(attempt)
    const data = receipt.data()
    if (!data || data.uid !== uid) throw notFound()
    if (data.digest !== digest) throw conflict()
    return work(tx, receipt, data)
  })
}

function workStep(data: DocumentData, current: Pick<MatchProof, 'placeId' | 'version'>, hasLease: boolean): WorkStep {
  switch (data.state) {
    case 'RECEIVED':
    case 'PROCESSING':
      if (hasLease !== (data.state === 'PROCESSING') || data.checkpoint !== undefined) throw processingError()
      return 'verify'
    case 'IMAGE_EVALUATED':
    case 'COMMITTING':
      if (!hasLease) throw processingError()
      assertMatchCheckpoint(data, current)
      if (data.state === 'IMAGE_EVALUATED') return 'prepare-photo'
      preparedGeneration(data)
      return 'commit'
    default:
      throw processingError()
  }
}

function assertMatchCheckpoint(data: DocumentData, current: Pick<MatchProof, 'placeId' | 'version'>): void {
  const checkpoint = data.checkpoint
  if (checkpoint?.location !== 'WITHIN_AREA' || checkpoint.photo !== 'MATCH' ||
    checkpoint.version !== current.version || checkpoint.placeId !== current.placeId) throw processingError()
  if (data.state === 'IMAGE_EVALUATED' && checkpoint.generation !== undefined) throw processingError()
}

function preparedGeneration(data: DocumentData): string {
  const generation: unknown = data.checkpoint?.generation
  if (!validGeneration(generation)) throw processingError()
  return generation
}

function readLease(data: DocumentData): { id: string; expiresAt: Timestamp } | undefined {
  if (data.lease === undefined) return undefined
  if (!(data.lease?.expiresAt instanceof Timestamp)) throw processingError()
  return { id: storedId(data.lease.id), expiresAt: data.lease.expiresAt }
}

function requireLiveLease(receipt: DocumentSnapshot, data: DocumentData, leaseId: string) {
  validateLeaseId(leaseId)
  const lease = readLease(data)
  if (lease?.id !== leaseId || lease.expiresAt.toMillis() <= receipt.readTime.toMillis()) throw processingError(true)
  return lease
}

function validateLeaseId(leaseId: string): void {
  if (typeof leaseId !== 'string') invalidInput()
  parseId(leaseId)
}
