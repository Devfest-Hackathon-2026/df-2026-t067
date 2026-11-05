import { createAdminHandler } from './admin-http'
import type { MembershipLookup } from './admin-http'
import { DemoAdminStore } from './admin'
import type { DemoAssetStore } from './admin-assets'
import type { AdminPhotoTestOptions } from './admin-photo-tests-http'
import type { FixtureDraftSuggester } from './demo-draft-suggestions'
import { createDiscoveryHandler } from './discoveries-http'
import type { DiscoveryRepository } from './discoveries'
import { randomUUID } from 'node:crypto'
import { createServer as createHttpServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { parsePage, parsePublicArea, parsePublicQuest, parseQuestHint } from '../../src/shared/api/validation'
import { assertDemoMode, assertNoAuthEmulator } from './config'
import { createDemoData } from './demo-data'
import { createDemoLocationValidation } from './demo-location'
import { DemoChallengeStore } from './challenges'
import { readChallengeInput } from './json-body'
import { answerKey, readAnswerInput } from './answer-input'
import { DemoAnswerStore } from './answers'
import { evaluateLocation } from './location'
import type { LocationValidation } from './location'
import { authUnavailable, HttpError, invalidInput, unauthenticated } from './errors'
import type { IdTokenVerifier } from './firebase-auth'
import { intersectsBbox, paginate, parseAreaQuery, parseId, validateQuery } from './query'

export interface ServerOptions {
  mode: 'demo'
  admin?: DemoAdminStore
  adminAssets?: DemoAssetStore
  adminPhotoTest?: AdminPhotoTestOptions
  suggestDraft?: FixtureDraftSuggester
  memberships?: MembershipLookup
  discoveries?: DiscoveryRepository
  nodeEnv?: string
  verifier?: IdTokenVerifier
  challenges?: DemoChallengeStore
  answers?: DemoAnswerStore
  locationValidation?: LocationValidation | 'demo'
}

function bearerToken(request: IncomingMessage): string {
  const count = request.rawHeaders.filter((_, index) => index % 2 === 0)
    .filter((name) => name.toLowerCase() === 'authorization').length
  const authorization = request.headers.authorization
  if (count !== 1 || !authorization || authorization.length > 8192) throw unauthenticated()
  const match = /^Bearer ([A-Za-z0-9._~-]+)$/i.exec(authorization)
  if (!match) throw unauthenticated()
  return match[1]
}

function requestTarget(request: IncomingMessage): { path: string; params: URLSearchParams } {
  const raw = request.url ?? ''
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('#')) invalidInput()
  try { decodeURIComponent(raw) } catch { invalidInput() }
  const split = raw.indexOf('?')
  const rawPath = split < 0 ? raw : raw.slice(0, split)
  return { path: rawPath, params: new URLSearchParams(split < 0 ? '' : raw.slice(split + 1)) }
}

function positiveRouteNumber(value: string): number {
  const parsed = Number(value)
  if (!/^[1-9]\d{0,15}$/.test(value) || !Number.isSafeInteger(parsed)) invalidInput()
  return parsed
}

export function createServer(options: ServerOptions) {
  assertDemoMode(options.mode, options.nodeEnv ?? process.env.NODE_ENV)
  assertNoAuthEmulator(process.env)
  const { areas, quests, hints } = createDemoData()
  const challenges = options.challenges ?? new DemoChallengeStore()
  const answers = options.answers ?? new DemoAnswerStore()
  const admin = options.admin ?? new DemoAdminStore({ assetLookup: (assetId) => options.adminAssets?.metadata(assetId) })
  const findPublicQuest = (questId: string) => admin.getPublished(questId)?.quest ?? quests.find((item) => item.questId === questId)
  const location = options.locationValidation === 'demo' ? createDemoLocationValidation((questId, version) => {
    const publication = admin.getPublished(questId)
    return publication?.quest.version === version ? publication.zones : undefined
  }) : options.locationValidation
  const adminHandler = createAdminHandler({ store: admin, assets: options.adminAssets, memberships: options.memberships,
    photoTest: options.adminPhotoTest, acquirePhotoTest: (uid) => answers.acquire(uid), suggestDraft: options.suggestDraft,
    areaIds: new Set(areas.map((area) => area.areaId)), authenticate, send })
  const discoveryHandler = createDiscoveryHandler({ repository: options.discoveries, authenticate, send })
  const server = createHttpServer({ maxHeaderSize: 16_384 }, (request, response) => {
    // Keep POST bodies paused while authentication runs. Only bounded readers
    // consume them; ignored/error bodies are drained after handling.
    request.on('error', () => {})
    const requestId = randomUUID()
    response.setHeader('X-Request-Id', requestId)
    response.setHeader('X-Quest-Data-Mode', 'demo')
    response.setHeader('Cache-Control', 'private, no-store')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    void handle(request, response).catch((error: unknown) => {
      const failure = error instanceof HttpError ? error
        : new HttpError(500, 'SYSTEM_ERROR', '処理を完了できませんでした。', true)
      if (failure.status === 401) response.setHeader('WWW-Authenticate', 'Bearer')
      if (failure.retryAfterSeconds !== undefined) response.setHeader('Retry-After', String(failure.retryAfterSeconds))
      if (['POST', 'PATCH', 'PUT'].includes(request.method ?? '') && !request.readableEnded) {
        response.shouldKeepAlive = false
        response.setHeader('Connection', 'close')
      }
      send(response, failure.status, {
        error: { code: failure.code, message: failure.message, requestId, retryable: failure.retryable },
      })
    }).finally(() => { request.resume() })
  })
  server.requestTimeout = 10_000
  server.headersTimeout = 5_000
  server.keepAliveTimeout = 1_000
  return server

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const { path, params } = requestTarget(request)
    if (await discoveryHandler(request, response, path, params)) return
    if (await adminHandler(request, response, path, params)) return
    const hintPath = /^\/api\/v1\/quests\/([^/]+)\/hints\/([^/]+)$/.exec(path)
    const hintImagePath = /^\/api\/v1\/quests\/([^/]+)\/hint-image$/.exec(path)
    const isDetail = path.startsWith('/api/v1/quests/')
    const isStart = path === '/api/v1/challenges'
    const answerPath = /^\/api\/v1\/challenges\/([^/]+)\/answers$/.exec(path)
    const attemptPath = /^\/api\/v1\/attempts\/([^/]+)$/.exec(path)
    if (isDetail && !hintPath && !hintImagePath && path.slice('/api/v1/quests/'.length).includes('/')) throw new HttpError(404, 'NOT_FOUND', '見つかりません。')
    const known = ['/health', '/api/v1/areas', '/api/v1/quests', '/api/v1/session'].includes(path) || isDetail || isStart || answerPath || attemptPath
    if (!known) throw new HttpError(404, 'NOT_FOUND', '見つかりません。')
    const method = isStart || answerPath ? 'POST' : 'GET'
    if (request.method !== method) {
      response.setHeader('Allow', method)
      throw new HttpError(405, 'HTTP_ERROR', 'このメソッドは利用できません。')
    }
    if (hintPath || hintImagePath) {
      validateQuery(params, ['expectedVersion'])
      const questId = parseId(decodeURIComponent((hintPath ?? hintImagePath)![1]))
      const index = hintPath ? positiveRouteNumber(decodeURIComponent(hintPath[2])) : undefined
      const version = positiveRouteNumber(params.get('expectedVersion') ?? '')
      const publication = admin.getPublished(questId)
      const quest = publication?.quest ?? quests.find((item) => item.questId === questId)
      if (!quest) throw new HttpError(404, 'NOT_FOUND', '公開中の問題が見つかりません。')
      if (quest.version !== version) throw new HttpError(409, 'QUEST_CHANGED', '問題の版が変更されています。')
      if (index === undefined) {
        const assetId = publication?.hintAssetId
        if (!publication || !assetId || options.adminAssets?.getOwned(publication.orgId, assetId)?.purpose !== 'public_hint') {
          throw new HttpError(404, 'NOT_FOUND', 'ヒント画像が見つかりません。')
        }
        const bytes = options.adminAssets.getPhotoOwned(publication.orgId, assetId)
        if (!bytes) throw new HttpError(404, 'NOT_FOUND', 'ヒント画像が見つかりません。')
        response.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': bytes.length, 'Content-Disposition': 'inline' })
        response.end(bytes)
        return
      }
      const text = (publication?.hints ?? hints.get(questId))?.[index - 1]
      if (!text || index > quest.hintCount) throw new HttpError(404, 'NOT_FOUND', 'ヒントが見つかりません。')
      send(response, 200, parseQuestHint({ questId, version: quest.version, index, text }))
    } else if (answerPath) {
      const uid = await authenticate(request)
      validateQuery(params, [])
      const challenge = challenges.getOwned(parseId(decodeURIComponent(answerPath[1])), uid)
      if (!challenge) throw new HttpError(404, 'NOT_FOUND', '見つかりません。')
      if (admin.isPaused(challenge.questId)) throw new HttpError(409, 'QUEST_UNAVAILABLE', 'この問題は利用できません。')
      const key = answerKey(request)
      const release = answers.acquire(uid)
      try {
        const input = await readAnswerInput(request)
        const quest = findPublicQuest(challenge.questId)
        if (!quest) throw new HttpError(409, 'QUEST_UNAVAILABLE', 'この問題は利用できません。')
        if (quest.version !== challenge.version) throw new HttpError(409, 'QUEST_CHANGED', '問題の版が変更されています。')
        const decide = location ? () => {
          const policy = location.policyFor(challenge.questId, challenge.version)
          if (!policy) throw new HttpError(503, 'SYSTEM_ERROR', '位置確認の設定を利用できません。')
          return evaluateLocation(input.metadata, policy, (location.now ?? Date.now)())
        } : undefined
        const result = answers.receive(uid, challenge.challengeId, key, input.digest, decide)
        send(response, result.state === 'COMPLETED' ? 200 : 202, result)
      } finally { release() }
    } else if (attemptPath) {
      const uid = await authenticate(request)
      validateQuery(params, [])
      const result = answers.getOwned(parseId(decodeURIComponent(attemptPath[1])), uid)
      if (!result) throw new HttpError(404, 'NOT_FOUND', '見つかりません。')
      send(response, 200, result)
    } else if (isStart) {
      const uid = await authenticate(request)
      validateQuery(params, [])
      const input = await readChallengeInput(request)
      if (admin.isPaused(input.questId)) throw new HttpError(409, 'QUEST_UNAVAILABLE', 'この問題は利用できません。')
      const quest = findPublicQuest(input.questId)
      if (!quest) throw new HttpError(404, 'NOT_FOUND', '公開中の問題が見つかりません。')
      if (quest.version !== input.expectedVersion) throw new HttpError(409, 'QUEST_CHANGED', '問題の版が変更されています。')
      const result = challenges.start(uid, quest)
      send(response, result.created ? 201 : 200, result.challenge)
    } else if (path === '/health') {
      validateQuery(params, [])
      send(response, 200, {
        status: 'ok', dataMode: 'demo', fictionalData: true,
        auth: options.verifier ? 'configured' : 'unconfigured',
      })
    } else if (path === '/api/v1/areas') {
      const filter = parseAreaQuery(params)
      const published = admin.listPublished()
      const items = (filter.bbox ? areas.filter((area) => intersectsBbox(area, filter.bbox!)) : areas)
        .map((area) => ({ ...area, publishedCount: area.publishedCount + published.filter((quest) => quest.areaId === area.areaId).length }))
      const page = paginate(items, params, 'areas:' + JSON.stringify(filter), (area) => area.areaId)
      send(response, 200, parsePage(page, parsePublicArea))
    } else if (path === '/api/v1/quests') {
      validateQuery(params, ['areaId', 'cursor', 'limit'])
      const rawAreaId = params.get('areaId')
      const areaId = rawAreaId === null ? undefined : parseId(rawAreaId)
      const available = [...quests, ...admin.listPublished()]
      const items = areaId ? available.filter((quest) => quest.areaId === areaId) : available
      const page = paginate(items, params, 'quests:' + (areaId ?? ''), (quest) => quest.questId)
      send(response, 200, parsePage(page, parsePublicQuest))
    } else if (path === '/api/v1/session') {
      // Client-supplied query/body uid, role, and orgId never establish identity.
      send(response, 200, { uid: await authenticate(request) })
    } else {
      validateQuery(params, [])
      const questId = parseId(decodeURIComponent(path.slice('/api/v1/quests/'.length)))
      const quest = findPublicQuest(questId)
      if (!quest) throw new HttpError(404, 'NOT_FOUND', '公開中の問題が見つかりません。')
      send(response, 200, parsePublicQuest(quest))
    }
  }

  async function authenticate(request: IncomingMessage): Promise<string> {
    if (!options.verifier) throw authUnavailable()
    const identity = await options.verifier.verify(bearerToken(request))
    if (typeof identity.uid !== 'string' || !identity.uid.trim() || identity.uid.length > 128) throw authUnavailable()
    return identity.uid
  }
}

function send(response: ServerResponse, status: number, body: unknown): void {
  if (response.destroyed || response.writableEnded) return
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(body))
}
