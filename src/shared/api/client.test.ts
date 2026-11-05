import { describe, expect, it, vi } from 'vitest'
import { ApiError, createApiClient } from './client'
import { area, capture, challenge, correct, discovery, processing, quest } from './testFixtures'
import { parseCaptureMetadata } from './validation'

const json = (body: unknown, status = 200, headers?: HeadersInit) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })

describe('public and authenticated requests', () => {
  it('does nothing until called and never sends an auth token to public endpoints', async () => {
    const getIdToken = vi.fn(async () => 'private-token')
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json(quest))
    const api = createApiClient({ fetch: fetcher, getIdToken })
    expect(fetcher).not.toHaveBeenCalled()
    expect(await api.getQuest('demo-quest')).toEqual(quest)
    expect(fetcher.mock.calls[0][0]).toBe('/api/v1/quests/demo-quest')
    expect(new Headers(fetcher.mock.calls[0][1]?.headers).has('Authorization')).toBe(false)
    expect(getIdToken).not.toHaveBeenCalled()
  })

  it('encodes public filters and keeps empty pages distinct from failures', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ items: [area], nextCursor: 'page+2' }))
      .mockResolvedValueOnce(json({ items: [], nextCursor: null }))
    const api = createApiClient({ fetch: fetcher })
    expect((await api.listAreas({ bbox: [0, 0, 1, 1], zoom: 5, cursor: 'a&b', limit: 10 })).items).toEqual([area])
    const requestUrl = new URL(String(fetcher.mock.calls[0][0]), 'https://app.example')
    expect(requestUrl.searchParams.get('bbox')).toBe('0,0,1,1')
    expect(requestUrl.searchParams.get('cursor')).toBe('a&b')
    expect(requestUrl.searchParams.get('limit')).toBe('10')
    expect(await api.listQuests({ areaId: 'demo-area' })).toEqual({ items: [], nextCursor: null })
  })

  it('does not send a protected request without an ID token', async () => {
    const fetcher = vi.fn<typeof fetch>()
    const api = createApiClient({ fetch: fetcher, getIdToken: async () => null })
    await expect(api.createChallenge({ questId: 'demo-quest', expectedVersion: 1 })).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('sends only the selected quest/version and gets a fresh token on each private call', async () => {
    const getIdToken = vi.fn().mockResolvedValueOnce('token-1').mockResolvedValueOnce('token-2')
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json(challenge, 201)).mockResolvedValueOnce(json(discovery))
    const api = createApiClient({ fetch: fetcher, getIdToken })
    expect(await api.createChallenge({ questId: 'demo-quest', expectedVersion: 1 })).toEqual(challenge)
    expect(await api.getDiscovery('demo-discovery')).toEqual(discovery)
    const first = fetcher.mock.calls[0][1]!
    expect(JSON.parse(String(first.body))).toEqual({ questId: 'demo-quest', expectedVersion: 1 })
    expect(new Headers(first.headers).get('Authorization')).toBe('Bearer token-1')
    expect(new Headers(fetcher.mock.calls[1][1]?.headers).get('Authorization')).toBe('Bearer token-2')
    expect(first.cache).toBe('no-store')
    expect(first.redirect).toBe('error')
  })

  it.each(['https://other.example/api', '//other.example', '/api/../external', '/api\\evil', '/api?x=1'])('rejects unsafe API base %s', (basePath) => {
    expect(() => createApiClient({ basePath })).toThrow(ApiError)
  })

  it('rejects invalid identifiers and filters before any network request', async () => {
    const fetcher = vi.fn<typeof fetch>()
    const api = createApiClient({ fetch: fetcher })
    await expect(api.getQuest('..')).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    await expect(api.listQuests({ limit: 0 })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    await expect(api.listAreas({ bbox: [0, -91, 1, 1] })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    expect(fetcher).not.toHaveBeenCalled()
  })
})

describe('photo answers and recovery', () => {
  it.each([
    ['OUTSIDE_AREA', 'MOVE_TO_AREA'], ['LOCATION_UNCERTAIN', 'RETAKE'],
  ])('accepts only an explicitly marked demo GPS failure: %s', async (outcome, nextAction) => {
    const result = { attemptId: 'demo-gps', state: 'COMPLETED', outcome, nextAction, source: 'mock' }
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => json(result, 200, { 'X-Quest-Data-Mode': 'demo' }))
    const api = createApiClient({ fetch: fetcher, getIdToken: async () => 'token', expectedDataMode: 'demo' })
    expect(await api.getAttempt('demo-gps')).toEqual(result)
    await expect(createApiClient({ fetch: fetcher, getIdToken: async () => 'token' }).getAttempt('demo-gps')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
    fetcher.mockResolvedValueOnce(json(result))
    await expect(api.getAttempt('demo-gps')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
    fetcher.mockResolvedValueOnce(json({ ...result, nextAction: 'OPEN_DISCOVERY' }, 200, { 'X-Quest-Data-Mode': 'demo' }))
    await expect(api.getAttempt('demo-gps')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
    fetcher.mockResolvedValueOnce(json({ ...correct, source: 'mock' }, 200, { 'X-Quest-Data-Mode': 'demo' }))
    await expect(api.getAttempt('demo-gps')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  })

  it('accepts an explicit demo receipt but rejects mock correct and processing results', async () => {
    const receipt = { attemptId: 'demo-receipt', state: 'RECEIVED', outcome: null, nextAction: 'WAIT', source: 'mock' }
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => json(receipt, 202, { 'X-Quest-Data-Mode': 'demo' }))
    const api = createApiClient({ fetch: fetcher, getIdToken: async () => 'token', expectedDataMode: 'demo' })
    expect(await api.getAttempt('demo-receipt')).toEqual(receipt)
    await expect(createApiClient({ fetch: fetcher, getIdToken: async () => 'token' }).getAttempt('demo-receipt')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
    fetcher.mockResolvedValueOnce(json(receipt, 202))
    await expect(api.getAttempt('demo-receipt')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
    fetcher.mockResolvedValueOnce(json({ ...correct, source: 'mock' }, 200, { 'X-Quest-Data-Mode': 'demo' }))
    await expect(api.getAttempt('demo-receipt')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
    fetcher.mockResolvedValueOnce(json({ ...receipt, state: 'PROCESSING' }, 202, { 'X-Quest-Data-Mode': 'demo' }))
    await expect(api.getAttempt('demo-receipt')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  })

  it('sends photo/metadata with a stable key and leaves multipart boundaries to fetch', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json(processing, 202))
    const api = createApiClient({ fetch: fetcher, getIdToken: async () => 'token' })
    const metadata = parseCaptureMetadata(capture)
    expect(await api.submitAnswer({ challengeId: 'demo-challenge', photo: new Blob(['photo'], { type: 'image/jpeg' }), metadata, idempotencyKey: 'answer-key' })).toEqual(processing)
    const [url, options] = fetcher.mock.calls[0]
    expect(url).toBe('/api/v1/challenges/demo-challenge/answers')
    expect(new Headers(options?.headers).get('Idempotency-Key')).toBe('answer-key')
    expect(new Headers(options?.headers).has('Content-Type')).toBe(false)
    const form = options?.body as FormData
    const photoText = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(reader.error)
      reader.readAsText(form.get('photo') as Blob)
    })
    expect(photoText).toBe('photo')
    expect(JSON.parse(String(form.get('metadata')))).toEqual(capture)
  })

  it.each([
    [409, 'QUEST_CHANGED'], [409, 'QUEST_UNAVAILABLE'], [503, 'SYSTEM_ERROR'],
  ])('retains the attempt ID in a %s %s result', async (status, outcome) => {
    const result = { ...processing, state: 'COMPLETED', outcome }
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json(result, status))
    const api = createApiClient({ fetch: fetcher, getIdToken: async () => 'token' })
    expect(await api.getAttempt('demo-attempt')).toEqual(result)
  })

  it('does not accept a success result hidden behind an error HTTP status', async () => {
    const api = createApiClient({ fetch: vi.fn<typeof fetch>().mockResolvedValue(json(correct, 503)), getIdToken: async () => 'token' })
    await expect(api.getAttempt('demo-attempt')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  })

  it('never automatically retries a photo POST after a network failure', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('connection lost'))
    const api = createApiClient({ fetch: fetcher, getIdToken: async () => 'token' })
    await expect(api.submitAnswer({
      challengeId: 'demo-challenge', photo: new Blob(['photo']), metadata: parseCaptureMetadata(capture), idempotencyKey: 'same-key',
    })).rejects.toMatchObject({ code: 'NETWORK_ERROR' })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('rejects an invalid capture and a missing answer key before sending a photo', async () => {
    const fetcher = vi.fn<typeof fetch>()
    const api = createApiClient({ fetch: fetcher, getIdToken: async () => 'token' })
    await expect(api.submitAnswer({
      challengeId: 'demo-challenge', photo: new Blob(['photo']), metadata: { ...capture, position: { ...capture.position, latitude: 99 } }, idempotencyKey: 'key',
    })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    await expect(api.submitAnswer({
      challengeId: 'demo-challenge', photo: new Blob(['photo']), metadata: capture, idempotencyKey: '',
    })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('rejects mock results received through the real API client', async () => {
    const api = createApiClient({ fetch: vi.fn<typeof fetch>().mockResolvedValue(json({ ...correct, source: 'mock' })), getIdToken: async () => 'token' })
    await expect(api.getAttempt('demo-attempt')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  })
})

describe('errors and cancellation', () => {
  it('preserves machine-readable rate limiting but does not echo server messages', async () => {
    const api = createApiClient({ fetch: vi.fn<typeof fetch>().mockResolvedValue(json({
      error: { code: 'RATE_LIMITED', message: 'server-private-value', requestId: 'req-1', retryable: true },
    }, 429, { 'Retry-After': '12' })) })
    await expect(api.getQuest('demo-quest')).rejects.toMatchObject({
      code: 'RATE_LIMITED', status: 429, requestId: 'req-1', retryable: true, retryAfterSeconds: 12,
    })
    const api2 = createApiClient({ fetch: vi.fn<typeof fetch>().mockResolvedValue(json({ error: {
      code: 'FORBIDDEN', message: 'server-private-value', requestId: 'req-2', retryable: false,
    } }, 403)) })
    await expect(api2.getQuest('demo-quest')).rejects.not.toThrow('server-private-value')
  })

  it('rejects malformed JSON and private fields without falling back to sample data', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('<html>not an API</html>'))
      .mockResolvedValueOnce(json({ ...quest, answerCoordinates: [0, 0] }))
    const api = createApiClient({ fetch: fetcher })
    await expect(api.getQuest('demo-quest')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
    await expect(api.getQuest('demo-quest')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  })

  it('preserves an aborted request as AbortError', async () => {
    const controller = new AbortController()
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, options) => {
      expect(options?.signal).toBe(controller.signal)
      controller.abort()
      throw new DOMException('cancelled', 'AbortError')
    })
    const api = createApiClient({ fetch: fetcher })
    await expect(api.getQuest('demo-quest', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
  })
})
