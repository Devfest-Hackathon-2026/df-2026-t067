import type { Firestore } from 'firebase-admin/firestore'
import type { IncomingMessage } from 'node:http'
import type { AttemptResult } from '../../src/shared/api/types'
import type { AnswerPhotoStorage } from './answer-photo-storage'
import { handleAssetRequest, matchAssetRoute } from './admin-assets-http'
import { answerKey, readAnswerInput } from './answer-input'
import { assertNoAuthEmulator } from './config'
import { createDiscoveryHandler } from './discoveries-http'
import { createDurableDraftHandler } from './durable-admin-drafts-http'
import { HttpError } from './errors'
import type { IdTokenVerifier } from './firebase-auth'
import type { AdmissionPolicy } from './firestore-admission'
import { processingError } from './firestore-answer-data'
import { acceptDurableAnswer, getDurableAnswer, prepareAnswerIntake } from './firestore-answer-intake'
import type { AnswerIdentity } from './firestore-answer-processing'
import { assertDurableChallengeOwner, startDurableChallenge } from './firestore-challenges'
import { FirestoreDiscoveryStore } from './firestore-discoveries'
import type { FirestoreManagedDraftStore } from './firestore-managed-drafts'
import type { FirestoreOrgAssetStore } from './firestore-org-assets'
import { authenticateRequest, createQuestHttpServer, requestTarget, send } from './http-server'
import { readChallengeInput } from './json-body'
import { handlePublicCatalog } from './public-catalog-http'
import { parseId, validateQuery } from './query'

interface DurableAnswerHttpOptions {
  db: Firestore
  photos: Pick<AnswerPhotoStorage, 'writeIncoming' | 'readRecord' | 'deleteRecord'>
  verifier: IdTokenVerifier
  challengePolicy: AdmissionPolicy
  answerPolicy: AdmissionPolicy
  dataMode?: 'durable-local'
  assets?: FirestoreOrgAssetStore
  drafts?: FirestoreManagedDraftStore
  acquireUpload(uid: string): () => void
  enqueue?(input: AnswerIdentity): Promise<void>
}

// Durable routes have no dependency on the development server's in-memory state.
export function createDurableAnswerServer(options: DurableAnswerHttpOptions) {
  assertNoAuthEmulator(process.env)
  const authenticate = (request: IncomingMessage) => authenticateRequest(request, options.verifier)
  const discoveryHandler = createDiscoveryHandler({ repository: new FirestoreDiscoveryStore(options.db, options.photos), authenticate, send })
  const draftHandler = options.drafts && createDurableDraftHandler(options.drafts, authenticate)
  const dataMode = options.dataMode ?? 'real'
  const assets = options.assets
  return createQuestHttpServer(dataMode, async (request, response) => {
    const { path, params } = requestTarget(request)
    if (await handlePublicCatalog(options.db, request, response, path, params)) return
    if (await discoveryHandler(request, response, path, params)) return
    if (await draftHandler?.(request, response, path, params)) return
    const asset = assets && matchAssetRoute(path)
    if (asset) {
      const method = asset[2] ? 'GET' : 'POST'
      if (request.method !== method) {
        response.setHeader('Allow', method)
        throw new HttpError(405, 'HTTP_ERROR', 'このメソッドは利用できません。')
      }
      const uid = await authenticate(request)
      const orgId = parseId(decodeURIComponent(asset[1]))
      const recheck = () => assets.assertMember(uid, orgId)
      await recheck()
      validateQuery(params, [])
      const assetId = asset[2] === undefined ? undefined : parseId(decodeURIComponent(asset[2]))
      await handleAssetRequest(request, response, { store: assets, uid, orgId, assetId, photo: Boolean(asset[3]), recheck, send })
      return
    }
    const session = path === '/api/v1/session'
    const start = path === '/api/v1/challenges'
    const answer = /^\/api\/v1\/challenges\/([^/]+)\/answers$/.exec(path)
    const attempt = /^\/api\/v1\/attempts\/([^/]+)$/.exec(path)
    const health = path === '/health'
    if (!health && !session && !start && !answer && !attempt) throw new HttpError(404, 'NOT_FOUND', '見つかりません。')
    const method = start || answer ? 'POST' : 'GET'
    if (request.method !== method) {
      response.setHeader('Allow', method)
      throw new HttpError(405, 'HTTP_ERROR', 'このメソッドは利用できません。')
    }
    if (health) {
      validateQuery(params, [])
      send(response, 200, { status: 'ok', dataMode })
      return
    }
    const uid = await authenticate(request)
    validateQuery(params, [])
    if (session) {
      send(response, 200, { uid })
    } else if (start) {
      const input = await readChallengeInput(request)
      const result = await startDurableChallenge(options.db, uid, input, options.challengePolicy)
      send(response, result.created ? 201 : 200, result.challenge)
    } else if (answer) {
      const { result, digest } = await receive(options, request, uid, parseId(decodeURIComponent(answer[1])))
      if (result.state !== 'COMPLETED' && options.enqueue) {
        // Keep the receipt even if dispatch fails. The same submission can
        // enqueue it again and the worker lease deduplicates execution.
        try { await options.enqueue({ uid, attemptId: result.attemptId, digest }) }
        catch { throw processingError(true) }
      }
      send(response, result.state === 'COMPLETED' ? 200 : 202, result)
    } else if (attempt) {
      send(response, 200, await getDurableAnswer(options.db, uid, parseId(decodeURIComponent(attempt[1]))))
    }
  })
}

async function receive(options: DurableAnswerHttpOptions, request: IncomingMessage, uid: string, challengeId: string):
  Promise<{ result: AttemptResult; digest: string }> {
  const idempotencyKey = answerKey(request)
  await assertDurableChallengeOwner(options.db, uid, challengeId)
  const release = options.acquireUpload(uid)
  try {
    const { digest, metadata, photo } = await readAnswerInput(request)
    const submission = { uid, challengeId, idempotencyKey, digest }
    const target = await prepareAnswerIntake(options.db, submission, options.answerPolicy)
    if (target.kind === 'replay') return { result: target.result, digest }
    const stored = await options.photos.writeIncoming(target.attemptId, digest, photo)
    if (stored.path !== target.objectPath) throw processingError()
    const result = await acceptDurableAnswer(options.db, { ...submission, metadata, generation: stored.generation }, options.answerPolicy)
    return { result, digest }
  } finally { release() }
}
