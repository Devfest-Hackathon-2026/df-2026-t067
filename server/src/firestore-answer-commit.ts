import { createHash } from 'node:crypto'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import type { Firestore } from 'firebase-admin/firestore'
import type { AttemptResult } from '../../src/shared/api/types'
import { ContractError, parseAttemptResult, parseDiscovery } from '../../src/shared/api/validation'
import { HttpError, invalidInput } from './errors'
import { parseId } from './query'

interface AnswerCommit {
  uid: string
  attemptId: string
  digest: string
  leaseId: string
}

// The authenticated worker stages verified evidence and an immutable private
// photo generation before calling this. Keep all external calls out of the
// transaction callback because Firestore may run it more than once.
export async function commitVerifiedAnswer(db: Firestore, input: AnswerCommit): Promise<AttemptResult> {
  const { uid, attemptId, digest, leaseId } = input
  if (typeof uid !== 'string' || !uid.trim() || uid.length > 128 ||
    typeof attemptId !== 'string' || typeof leaseId !== 'string' ||
    typeof digest !== 'string' || !/^[a-f0-9]{64}$/.test(digest)) invalidInput()
  const attempt = db.collection('attempts').doc(parseId(attemptId))
  parseId(leaseId)
  try {
    return await db.runTransaction(async (tx) => {
      const receipt = await tx.get(attempt)
      const data = receipt.data()
      if (!data || data.uid !== uid) throw notFound()
      if (data.digest !== digest) throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', '回答の内容が一致しません。')
      if (data.state === 'COMPLETED') {
        const result = parseAttemptResult(data.result)
        if (result.attemptId !== attemptId || result.source !== 'real' || result.state !== 'COMPLETED') throw commitError()
        return result
      }
      if (data.state !== 'COMMITTING' || data.lease?.id !== leaseId || !(data.lease.expiresAt instanceof Timestamp) ||
        data.lease.expiresAt.toMillis() <= receipt.readTime.toMillis()) throw commitError(true)

      const checkpoint = data.checkpoint
      if (checkpoint?.location !== 'WITHIN_AREA' || checkpoint.photo !== 'MATCH' ||
        checkpoint.version !== data.version || !validGeneration(checkpoint.generation)) throw commitError()
      const questId = storedId(data.questId)
      const challengeId = storedId(data.challengeId)
      const version: unknown = data.version
      if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1) throw commitError()

      const [challenge, quest, publishedVersion] = await tx.getAll(
        db.collection('challenges').doc(challengeId),
        db.collection('quests').doc(questId),
        db.collection('questVersions').doc(`${questId}:${version}`),
      )
      const accepted = challenge.data()
      if (!accepted || accepted.uid !== uid || accepted.questId !== questId || accepted.version !== version) throw notFound()
      const publication = quest.data()
      if (!publication || publication.publishedVersion === null || publication.status === 'paused') {
        throw new HttpError(409, 'QUEST_UNAVAILABLE', 'この問題は利用できません。')
      }
      const activeVersion: unknown = publication.publishedVersion
      if (typeof activeVersion !== 'number' || !Number.isSafeInteger(activeVersion) || activeVersion < 1 ||
        !['draft', 'review_pending', 'published'].includes(publication.status)) throw commitError()
      if (activeVersion !== version) throw new HttpError(409, 'QUEST_CHANGED', '問題の版が変更されています。')

      const snapshot = publishedVersion.data()
      if (!snapshot || snapshot.placeId !== checkpoint.placeId) throw commitError()
      const placeId = storedId(snapshot.placeId)
      const discoveryId = createHash('sha256').update(JSON.stringify([uid, placeId])).digest('hex')
      const discovery = db.collection('discoveries').doc(discoveryId)
      const existing = (await tx.get(discovery)).data()
      if (existing) {
        if (existing.uid !== uid || existing.placeId !== placeId || existing.discoveryId !== discoveryId ||
          !(existing.firstClearedAt instanceof Timestamp) || !validGeneration(existing.photoObject?.generation) ||
          typeof existing.photoObject.path !== 'string' ||
          !/^answer-photos\/[A-Za-z0-9][A-Za-z0-9_-]{0,127}\/record\.jpg$/.test(existing.photoObject.path)) throw commitError()
      } else {
        const areaId = storedId(snapshot.areaId)
        if (typeof snapshot.placeName !== 'string' || !snapshot.placeName.trim() || snapshot.placeName.length > 200 ||
          typeof snapshot.descriptionSnapshot !== 'string' || snapshot.descriptionSnapshot.length > 4000) throw commitError()
        const record = parseDiscovery({
          discoveryId, placeId, questId, questVersion: version, placeName: snapshot.placeName,
          descriptionSnapshot: snapshot.descriptionSnapshot, revealedLocation: snapshot.revealedLocation,
          ownerPhoto: `/api/v1/me/discoveries/${discoveryId}/photo`, firstClearedAt: receipt.readTime.toDate().toISOString(),
        })
        tx.create(discovery, {
          ...record, uid, areaId, firstClearedAt: FieldValue.serverTimestamp(),
          photoObject: { path: `answer-photos/${attemptId}/record.jpg`, generation: checkpoint.generation },
        })
      }
      const result: AttemptResult = { attemptId, state: 'COMPLETED', outcome: existing ? 'ALREADY_CLEARED' : 'CORRECT',
        optionalDiscoveryId: discoveryId, source: 'real', nextAction: 'VIEW_DISCOVERY' }
      tx.update(attempt, { state: 'COMPLETED', result, lease: FieldValue.delete(), checkpoint: FieldValue.delete() })
      return result
    })
  } catch (error) {
    if (error instanceof HttpError) throw error
    throw commitError(!(error instanceof ContractError))
  }
}

function storedId(value: unknown): string {
  if (typeof value !== 'string') throw commitError()
  try { return parseId(value) } catch { throw commitError() }
}

function validGeneration(value: unknown): value is string {
  return typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n
}

function notFound(): HttpError {
  return new HttpError(404, 'NOT_FOUND', '見つかりません。')
}

function commitError(retryable = false): HttpError {
  return new HttpError(503, 'SYSTEM_ERROR', '回答の確定を完了できませんでした。', retryable)
}
