import { randomUUID } from 'node:crypto'
import { createServer as createHttpServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { parsePage, parsePublicArea, parsePublicQuest } from '../../src/shared/api/validation'
import { assertDemoMode, assertNoAuthEmulator } from './config'
import { createDemoData } from './demo-data'
import { authUnavailable, HttpError, invalidInput, unauthenticated } from './errors'
import type { IdTokenVerifier } from './firebase-auth'
import { intersectsBbox, paginate, parseAreaQuery, parseId, validateQuery } from './query'

export interface ServerOptions {
  mode: 'demo'
  nodeEnv?: string
  verifier?: IdTokenVerifier
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

export function createServer(options: ServerOptions) {
  assertDemoMode(options.mode, options.nodeEnv ?? process.env.NODE_ENV)
  assertNoAuthEmulator(process.env)
  const { areas, quests } = createDemoData()
  const server = createHttpServer({ maxHeaderSize: 16_384 }, (request, response) => {
    // No request bodies are interpreted, retained, or logged by this read-only server.
    request.resume()
    const requestId = randomUUID()
    response.setHeader('X-Request-Id', requestId)
    response.setHeader('X-Quest-Data-Mode', 'demo')
    response.setHeader('Cache-Control', 'private, no-store')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    void handle(request, response).catch((error: unknown) => {
      const failure = error instanceof HttpError ? error
        : new HttpError(500, 'SYSTEM_ERROR', '処理を完了できませんでした。', true)
      if (failure.status === 401) response.setHeader('WWW-Authenticate', 'Bearer')
      send(response, failure.status, {
        error: { code: failure.code, message: failure.message, requestId, retryable: failure.retryable },
      })
    })
  })
  server.requestTimeout = 10_000
  server.headersTimeout = 5_000
  server.keepAliveTimeout = 1_000
  return server

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const { path, params } = requestTarget(request)
    const isDetail = path.startsWith('/api/v1/quests/')
    const known = ['/health', '/api/v1/areas', '/api/v1/quests', '/api/v1/session'].includes(path) || isDetail
    if (!known) throw new HttpError(404, 'NOT_FOUND', '見つかりません。')
    if (request.method !== 'GET') {
      response.setHeader('Allow', 'GET')
      throw new HttpError(405, 'HTTP_ERROR', 'このメソッドは利用できません。')
    }
    if (path === '/health') {
      validateQuery(params, [])
      send(response, 200, {
        status: 'ok', dataMode: 'demo', fictionalData: true,
        auth: options.verifier ? 'configured' : 'unconfigured',
      })
    } else if (path === '/api/v1/areas') {
      const filter = parseAreaQuery(params)
      const items = filter.bbox ? areas.filter((area) => intersectsBbox(area, filter.bbox!)) : areas
      const page = paginate(items, params, 'areas:' + JSON.stringify(filter), (area) => area.areaId)
      send(response, 200, parsePage(page, parsePublicArea))
    } else if (path === '/api/v1/quests') {
      validateQuery(params, ['areaId', 'cursor', 'limit'])
      const rawAreaId = params.get('areaId')
      const areaId = rawAreaId === null ? undefined : parseId(rawAreaId)
      const items = areaId ? quests.filter((quest) => quest.areaId === areaId) : quests
      const page = paginate(items, params, 'quests:' + (areaId ?? ''), (quest) => quest.questId)
      send(response, 200, parsePage(page, parsePublicQuest))
    } else if (path === '/api/v1/session') {
      // Client-supplied query/body uid, role, and orgId never establish identity.
      if (!options.verifier) throw authUnavailable()
      const token = bearerToken(request)
      const identity = await options.verifier.verify(token)
      if (typeof identity.uid !== 'string' || !identity.uid.trim() || identity.uid.length > 128) throw authUnavailable()
      send(response, 200, { uid: identity.uid })
    } else {
      validateQuery(params, [])
      const questId = parseId(decodeURIComponent(path.slice('/api/v1/quests/'.length)))
      const quest = quests.find((item) => item.questId === questId)
      if (!quest) throw new HttpError(404, 'NOT_FOUND', '公開中の問題が見つかりません。')
      send(response, 200, parsePublicQuest(quest))
    }
  }
}

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(body))
}
