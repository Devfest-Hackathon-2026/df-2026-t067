import { createHash } from 'node:crypto'
import { GrpcStatus, Timestamp } from 'firebase-admin/firestore'
import type { DocumentData, DocumentSnapshot, Firestore, Transaction, UpdateData } from 'firebase-admin/firestore'
import { ContractError, parseAttemptResult, parseCaptureMetadata } from '../../src/shared/api/validation'
import { HttpError } from './errors'
import { parseId } from './query'

export async function answerTransaction<T>(db: Firestore, work: (tx: Transaction) => Promise<T>, readOnly = false): Promise<T> {
  try {
    return await db.runTransaction(work, readOnly ? { readOnly: true } : undefined)
  } catch (error) {
    if (error instanceof HttpError) throw error
    throw processingError(!(error instanceof ContractError))
  }
}

export async function updateAnswerSnapshot(snapshot: DocumentSnapshot, update: UpdateData<DocumentData>): Promise<boolean> {
  if (!snapshot.updateTime) return false
  try {
    await snapshot.ref.update(update, { lastUpdateTime: snapshot.updateTime })
    return true
  } catch (error) {
    if (error !== null && typeof error === 'object' && 'code' in error &&
      (error.code === GrpcStatus.FAILED_PRECONDITION || error.code === GrpcStatus.NOT_FOUND)) return false
    throw processingError(true)
  }
}

export async function readCurrentVersion(db: Firestore, tx: Transaction, data: DocumentData, uid: string) {
  const questId = storedId(data.questId)
  const version = storedVersion(data.version)
  const [challenge, quest, versionDoc] = await tx.getAll(
    db.collection('challenges').doc(storedId(data.challengeId)), ...versionDocuments(db, questId, version),
  )
  const accepted = challenge.data()
  if (!accepted || accepted.uid !== uid || accepted.questId !== questId || accepted.version !== version) throw notFound()
  return checkPublishedVersion(questId, version, quest.data(), versionDoc.data())
}

export async function readActiveChallenge(db: Firestore, tx: Transaction, uid: string, challengeId: string) {
  const challenge = (await tx.get(db.collection('challenges').doc(challengeId))).data()
  if (!challenge || challenge.uid !== uid) throw notFound()
  const questId = storedId(challenge.questId)
  const version = storedVersion(challenge.version)
  const [quest, versionDoc] = await tx.getAll(...versionDocuments(db, questId, version))
  return checkPublishedVersion(questId, version, quest.data(), versionDoc.data())
}

export async function assertChallengeCanStart(db: Firestore, tx: Transaction, questId: string, version: number): Promise<void> {
  const [quest, versionDoc] = await tx.getAll(...versionDocuments(db, questId, version))
  const publication = quest.data()
  if (!publication || (publication.publishedVersion === null && publication.status !== 'paused')) throw notFound()
  checkPublishedVersion(questId, version, publication, versionDoc.data())
}

function versionDocuments(db: Firestore, questId: string, version: number) {
  return [db.collection('quests').doc(questId), db.collection('questVersions').doc(`${questId}:${version}`)] as const
}

export function isPublicationStatus(status: unknown): boolean {
  return status === 'draft' || status === 'review_pending' || status === 'published'
}

function checkPublishedVersion(questId: string, version: number, publication?: DocumentData, snapshot?: DocumentData) {
  if (!publication || publication.publishedVersion === null || publication.status === 'paused') {
    throw new HttpError(409, 'QUEST_UNAVAILABLE', 'この問題は利用できません。')
  }
  if (!isPublicationStatus(publication.status)) throw processingError()
  if (storedVersion(publication.publishedVersion) !== version) throw questChanged()
  if (!snapshot) throw processingError()
  return { questId, version, snapshot, placeId: storedId(snapshot.placeId) }
}

export function storedAnswerResult(data: DocumentData, attemptId: string) {
  const result = parseAttemptResult(data.state === 'COMPLETED' ? data.result
    : { attemptId, state: data.state, outcome: null, nextAction: 'WAIT', source: 'real' })
  if (result.attemptId !== attemptId || result.source !== 'real' || result.state !== data.state) throw processingError()
  return result
}

export function incomingAnswerPhotoPath(attemptId: string, digest: string): string {
  return `answer-photos/${attemptId}/incoming-${digest}.jpg`
}

export function recordAnswerPhotoPath(attemptId: string): string {
  return `answer-photos/${attemptId}/record.jpg`
}

export function discoveryKeyId(uid: string, placeId: string): string {
  return createHash('sha256').update(JSON.stringify([uid, placeId])).digest('hex')
}

export function validRecordPhotoPath(value: unknown): value is string {
  return typeof value === 'string' && /^answer-photos\/[A-Za-z0-9][A-Za-z0-9_-]{0,127}\/record\.jpg$/.test(value)
}

export function readAnswerSource(data: DocumentData, attemptId: string) {
  const path = incomingAnswerPhotoPath(attemptId, data.digest)
  const generation: unknown = data.sourcePhoto?.generation
  if (data.sourcePhoto?.path !== path || !validGeneration(generation) || !(data.receivedAt instanceof Timestamp)) throw processingError()
  return { photoObject: { path, generation }, metadata: parseCaptureMetadata(data.capture), receivedAt: data.receivedAt.toDate().getTime() }
}

export function validAnswerUid(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 128
}

export function validDigest(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
}

export function validGeneration(value: unknown): value is string {
  return typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n
}

export function storedId(value: unknown): string {
  if (typeof value !== 'string') throw processingError()
  try { return parseId(value) } catch { throw processingError() }
}

function storedVersion(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw processingError()
  return value
}

export function notFound(): HttpError {
  return new HttpError(404, 'NOT_FOUND', '見つかりません。')
}

export function conflict(): HttpError {
  return new HttpError(409, 'IDEMPOTENCY_CONFLICT', '回答の内容が一致しません。')
}

export function questChanged(): HttpError {
  return new HttpError(409, 'QUEST_CHANGED', '問題の版が変更されています。')
}

export function processingError(retryable = false): HttpError {
  return new HttpError(503, 'SYSTEM_ERROR', '回答の処理を完了できませんでした。', retryable)
}
