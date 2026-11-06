import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { authUnavailable, HttpError, invalidInput, unauthenticated } from './errors'
import type { IdTokenVerifier } from './firebase-auth'

export function createQuestHttpServer(mode: 'demo' | 'real' | 'durable-local' | 'team-preview', handle: (request: IncomingMessage, response: ServerResponse) => Promise<void>) {
  const server = createServer({ maxHeaderSize: 16_384 }, (request, response) => {
    // Keep POST bodies paused until authentication and a bounded reader.
    request.on('error', () => {})
    const requestId = randomUUID()
    response.setHeader('X-Request-Id', requestId)
    response.setHeader('X-Quest-Data-Mode', mode)
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
}

export async function authenticateRequest(request: IncomingMessage, verifier?: IdTokenVerifier): Promise<string> {
  if (!verifier) throw authUnavailable()
  const count = request.rawHeaders.filter((_, index) => index % 2 === 0)
    .filter((name) => name.toLowerCase() === 'authorization').length
  const authorization = request.headers.authorization
  if (count !== 1 || !authorization || authorization.length > 8192) throw unauthenticated()
  const match = /^Bearer ([A-Za-z0-9._~-]+)$/i.exec(authorization)
  if (!match) throw unauthenticated()
  const { uid } = await verifier.verify(match[1])
  if (typeof uid !== 'string' || !uid.trim() || uid.length > 128) throw authUnavailable()
  return uid
}

export function requestTarget(request: IncomingMessage): { path: string; params: URLSearchParams } {
  const raw = request.url ?? ''
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('#')) invalidInput()
  try { decodeURIComponent(raw) } catch { invalidInput() }
  const split = raw.indexOf('?')
  const rawPath = split < 0 ? raw : raw.slice(0, split)
  return { path: rawPath, params: new URLSearchParams(split < 0 ? '' : raw.slice(split + 1)) }
}

export function send(response: ServerResponse, status: number, body: unknown): void {
  if (response.destroyed || response.writableEnded) return
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(body))
}
