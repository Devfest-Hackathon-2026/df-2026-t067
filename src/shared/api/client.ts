import type { AttemptResult, CaptureMetadata, Decoder } from './types'
import {
  ContractError, parseAttemptResult, parseCaptureMetadata, parseChallenge,
  parseDiscovery, parsePage, parsePublicArea, parsePublicQuest, parseSessionIdentity,
} from './validation'

const ERROR_CODES = [
  'INVALID_INPUT', 'MEDIA_TOO_LARGE', 'UNAUTHENTICATED', 'FORBIDDEN', 'RATE_LIMITED',
  'IDEMPOTENCY_CONFLICT', 'QUEST_UNAVAILABLE', 'QUEST_CHANGED', 'SYSTEM_ERROR',
  'NOT_FOUND', 'HTTP_ERROR', 'NETWORK_ERROR', 'INVALID_RESPONSE', 'AUTH_UNAVAILABLE',
] as const
export type ApiErrorCode = typeof ERROR_CODES[number]

export class ApiError extends Error {
  readonly code: ApiErrorCode
  readonly status: number
  readonly retryable: boolean
  readonly requestId?: string
  readonly retryAfterSeconds?: number

  constructor(code: ApiErrorCode, details: {
    status?: number; retryable?: boolean; requestId?: string; retryAfterSeconds?: number
  } = {}) {
    const messages: Partial<Record<ApiErrorCode, string>> = {
      UNAUTHENTICATED: 'ログインが必要です。',
      INVALID_INPUT: '送信内容を確認してください。',
      INVALID_RESPONSE: 'データを読み取れませんでした。',
      NETWORK_ERROR: '通信状況を確認してください。',
    }
    super(messages[code] ?? '処理を完了できませんでした。')
    this.name = 'ApiError'
    this.code = code
    this.status = details.status ?? 0
    this.retryable = details.retryable ?? false
    this.requestId = details.requestId
    this.retryAfterSeconds = details.retryAfterSeconds
  }
}

export interface ApiClientOptions {
  fetch?: typeof globalThis.fetch
  getIdToken?: () => Promise<string | null>
  basePath?: string
  expectedDataMode?: 'demo'
}
export interface CallOptions { signal?: AbortSignal }
export interface ListQuery { areaId?: string; cursor?: string; limit?: number }
export interface AreaQuery {
  bbox?: [west: number, south: number, east: number, north: number]
  zoom?: number
  cursor?: string
  limit?: number
}
interface RequestOptions extends CallOptions {
  authenticated?: boolean
  method?: 'GET' | 'POST'
  body?: BodyInit
  headers?: HeadersInit
  attempt?: boolean
}

function id(input: unknown): string {
  if (typeof input !== 'string' || !input.trim() || input === '.' || input === '..' ||
    input.includes('/') || input.includes('\\') ||
    Array.from(input).some((char) => char.charCodeAt(0) < 32)) throw new ApiError('INVALID_INPUT')
  return encodeURIComponent(input)
}

function positiveInteger(input: unknown): number {
  if (typeof input !== 'number' || !Number.isSafeInteger(input) || input < 1) throw new ApiError('INVALID_INPUT')
  return input
}

function queryString(query: ListQuery | AreaQuery): string {
  const params = new URLSearchParams()
  if ('areaId' in query && query.areaId !== undefined) {
    id(query.areaId)
    params.set('areaId', query.areaId)
  }
  if (query.cursor !== undefined) {
    if (typeof query.cursor !== 'string' || !query.cursor.trim()) throw new ApiError('INVALID_INPUT')
    params.set('cursor', query.cursor)
  }
  if (query.limit !== undefined) params.set('limit', String(positiveInteger(query.limit)))
  if ('zoom' in query && query.zoom !== undefined) {
    if (!Number.isFinite(query.zoom) || query.zoom < 0) throw new ApiError('INVALID_INPUT')
    params.set('zoom', String(query.zoom))
  }
  if ('bbox' in query && query.bbox !== undefined) {
    const b = query.bbox
    if (!Array.isArray(b) || b.length !== 4 || b.some((v) => typeof v !== 'number' || !Number.isFinite(v)) ||
      Math.abs(b[0]) > 180 || Math.abs(b[2]) > 180 || Math.abs(b[1]) > 90 || Math.abs(b[3]) > 90 ||
      b[1] > b[3]) throw new ApiError('INVALID_INPUT')
    params.set('bbox', b.join(','))
  }
  return params.size ? '?' + params.toString() : ''
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function retryAfter(response: Response): number | undefined {
  const value = response.headers.get('Retry-After')
  if (value === null) return undefined
  if (/^\d+$/.test(value)) {
    const seconds = Number(value)
    return Number.isSafeInteger(seconds) ? seconds : undefined
  }
  const time = Date.parse(value)
  return Number.isFinite(time) ? Math.max(0, Math.ceil((time - Date.now()) / 1000)) : undefined
}

function httpError(response: Response, payload: unknown): ApiError {
  const d = record(payload) && record(payload.error) ? payload.error : {}
  const fallback: Partial<Record<number, ApiErrorCode>> = {
    401: 'UNAUTHENTICATED', 403: 'FORBIDDEN', 404: 'NOT_FOUND',
    413: 'MEDIA_TOO_LARGE', 429: 'RATE_LIMITED', 503: 'SYSTEM_ERROR',
  }
  const code = typeof d.code === 'string' && ERROR_CODES.includes(d.code as ApiErrorCode)
    ? d.code as ApiErrorCode : fallback[response.status] ?? 'HTTP_ERROR'
  return new ApiError(code, {
    status: response.status, requestId: typeof d.requestId === 'string' ? d.requestId : undefined,
    retryable: typeof d.retryable === 'boolean' ? d.retryable : response.status >= 500,
    retryAfterSeconds: retryAfter(response),
  })
}

function liveAttempt(input: unknown, allowDemoReceipt = false): AttemptResult {
  const result = parseAttemptResult(input)
  const demoReceipt = allowDemoReceipt && result.source === 'mock' && result.state === 'RECEIVED' && result.nextAction === 'WAIT'
  if (result.source !== 'real' && !demoReceipt) throw new ContractError('source')
  return result
}

export function createApiClient(options: ApiClientOptions = {}) {
  const decodeAttempt = (input: unknown) => liveAttempt(input, options.expectedDataMode === 'demo')
  const base = (options.basePath ?? '/api/v1').replace(/\/+$/, '')
  if (!/^\/[A-Za-z0-9/_-]+$/.test(base) || base.includes('//')) throw new ApiError('INVALID_INPUT')

  async function request<T>(path: string, decode: Decoder<T>, init: RequestOptions = {}): Promise<T> {
    init.signal?.throwIfAborted()
    const headers = new Headers(init.headers)
    headers.set('Accept', 'application/json')
    if (init.authenticated) {
      let token: string | null | undefined
      try { token = await options.getIdToken?.() }
      catch (error) {
        if (init.signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw error
        throw new ApiError('AUTH_UNAVAILABLE', { retryable: true })
      }
      if (!token) throw new ApiError('UNAUTHENTICATED')
      if (!/^[A-Za-z0-9._~-]+$/.test(token)) throw new ApiError('AUTH_UNAVAILABLE')
      headers.set('Authorization', 'Bearer ' + token)
    }
    init.signal?.throwIfAborted()
    let response: Response
    try {
      const fetcher = options.fetch ?? globalThis.fetch
      response = await fetcher(base + path, {
        method: init.method ?? 'GET', headers, body: init.body, signal: init.signal,
        credentials: 'same-origin', cache: 'no-store', redirect: 'error',
      })
    } catch (error) {
      if (init.signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw error
      throw new ApiError('NETWORK_ERROR', { retryable: (init.method ?? 'GET') === 'GET' })
    }
    if (response.ok && options.expectedDataMode && response.headers.get('X-Quest-Data-Mode') !== options.expectedDataMode) {
      throw new ApiError('INVALID_RESPONSE', { status: response.status })
    }
    let payload: unknown
    try { payload = await response.json() }
    catch (error) {
      if (init.signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw error
      if (!response.ok) throw httpError(response, null)
      throw new ApiError('INVALID_RESPONSE', { status: response.status })
    }
    if (!response.ok && record(payload) && 'error' in payload) throw httpError(response, payload)
    if (!response.ok && !(init.attempt && (response.status === 409 || response.status === 503))) throw httpError(response, payload)
    try {
      if (!response.ok) {
        const result = liveAttempt(payload)
        const expected = response.status === 503 ? result.outcome === 'SYSTEM_ERROR'
          : result.outcome === 'QUEST_CHANGED' || result.outcome === 'QUEST_UNAVAILABLE'
        if (!expected) throw new ContractError('outcome')
      }
      return decode(payload)
    } catch (error) {
      if (error instanceof ContractError) throw new ApiError('INVALID_RESPONSE', { status: response.status })
      throw error
    }
  }

  return {
    async getSession(call: CallOptions = {}) {
      return request('/session', parseSessionIdentity, { ...call, authenticated: true })
    },
    async listAreas(query: AreaQuery = {}, call: CallOptions = {}) {
      return request('/areas' + queryString(query), (data) => parsePage(data, parsePublicArea), call)
    },
    async listQuests(query: ListQuery = {}, call: CallOptions = {}) {
      return request('/quests' + queryString(query), (data) => parsePage(data, parsePublicQuest), call)
    },
    async getQuest(questId: string, call: CallOptions = {}) {
      return request('/quests/' + id(questId), parsePublicQuest, call)
    },
    async createChallenge(input: { questId: string; expectedVersion: number }, call: CallOptions = {}) {
      id(input.questId)
      positiveInteger(input.expectedVersion)
      return request('/challenges', parseChallenge, {
        ...call, authenticated: true, method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questId: input.questId, expectedVersion: input.expectedVersion }),
      })
    },
    async submitAnswer(input: {
      challengeId: string; photo: Blob; metadata: CaptureMetadata; idempotencyKey: string
    }, call: CallOptions = {}) {
      const challengeId = id(input.challengeId)
      if (!(input.photo instanceof Blob) || input.photo.size === 0 ||
        typeof input.idempotencyKey !== 'string' || !/^[\x21-\x7e]+$/.test(input.idempotencyKey)) throw new ApiError('INVALID_INPUT')
      let metadata: CaptureMetadata
      try { metadata = parseCaptureMetadata(input.metadata) }
      catch (error) { if (error instanceof ContractError) throw new ApiError('INVALID_INPUT'); throw error }
      const body = new FormData()
      body.append('photo', input.photo, 'capture')
      body.append('metadata', JSON.stringify(metadata))
      return request('/challenges/' + challengeId + '/answers', decodeAttempt, {
        ...call, authenticated: true, method: 'POST', body, attempt: true,
        headers: { 'Idempotency-Key': input.idempotencyKey },
      })
    },
    async getAttempt(attemptId: string, call: CallOptions = {}) {
      return request('/attempts/' + id(attemptId), decodeAttempt, { ...call, authenticated: true, attempt: true })
    },
    async listDiscoveries(query: ListQuery = {}, call: CallOptions = {}) {
      return request('/me/discoveries' + queryString(query), (data) => parsePage(data, parseDiscovery), { ...call, authenticated: true })
    },
    async getDiscovery(discoveryId: string, call: CallOptions = {}) {
      return request('/me/discoveries/' + id(discoveryId), parseDiscovery, { ...call, authenticated: true })
    },
  }
}

export type ApiClient = ReturnType<typeof createApiClient>
