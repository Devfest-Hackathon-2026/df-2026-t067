import { expect, it, vi } from 'vitest'
import { createApiClient } from './client'
import { DISCOVERY_PHOTO_MAX_BYTES } from './types'
import { ContractError, parseDeletionReceipt, parseDeletionStatus } from './validation'
import { discovery } from './testFixtures'

const jpeg = new Uint8Array([255, 216, 255, 217])
const photo = (bytes = jpeg, headers: HeadersInit = {}) => new Response(bytes, { headers: { 'Content-Type': 'image/jpeg', ...headers } })
const json = (body: unknown, status = 200, headers: HeadersInit = {}) => new Response(JSON.stringify(body), { status, headers })

it('loads private photos with a fresh token and returns a Blob without following ownerPhoto URLs', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(photo())
  const api = createApiClient({ fetch: fetcher, getIdToken: async () => 'fresh-token' })
  const result = await api.getDiscoveryPhoto('demo-discovery')
  expect(result.type).toBe('image/jpeg')
  expect(result.size).toBe(4)
  const [url, options] = fetcher.mock.calls[0]
  expect(url).toBe('/api/v1/me/discoveries/demo-discovery/photo')
  expect(new Headers(options?.headers).get('Authorization')).toBe('Bearer fresh-token')
  expect(new Headers(options?.headers).get('Accept')).toBe('image/jpeg')
  expect(options?.redirect).toBe('error')
  expect(options?.cache).toBe('no-store')
})

it('requires explicit demo connection for memory records and rejects unexpected storage modes', async () => {
  for (const mode of ['memory', 'unknown']) {
    const api = createApiClient({ fetch: async () => json(discovery, 200, { 'X-Quest-Records-Mode': mode }), getIdToken: async () => 'token' })
    await expect(api.getDiscovery('demo-discovery')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  }
  const api = createApiClient({ expectedDataMode: 'demo', getIdToken: async () => 'token',
    fetch: async () => json(discovery, 200, { 'X-Quest-Records-Mode': 'memory', 'X-Quest-Data-Mode': 'demo' }) })
  expect(await api.getDiscovery('demo-discovery')).toEqual(discovery)
  await expect(api.getDiscovery('different')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
})

it('bounds image data even without Content-Length and refuses unsafe types, empty images and invalid signatures', async () => {
  const bodies = [photo(jpeg, { 'Content-Type': 'text/html' }), photo(new Uint8Array()), photo(new Uint8Array([1, 2, 3, 4])),
    photo(jpeg, { 'Content-Length': '5' }), photo(jpeg, { 'Content-Length': String(DISCOVERY_PHOTO_MAX_BYTES + 1) }),
    photo(new Uint8Array(DISCOVERY_PHOTO_MAX_BYTES + 1))]
  for (const body of bodies) {
    const api = createApiClient({ fetch: async () => body, getIdToken: async () => 'token' })
    await expect(api.getDiscoveryPhoto('demo-discovery')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  }
})

it('keeps photo authentication errors and cancellation distinct from malformed images', async () => {
  const api = createApiClient({ fetch: async () => json({ error: { code: 'UNAUTHENTICATED', retryable: false } }, 401), getIdToken: async () => 'token' })
  await expect(api.getDiscoveryPhoto('demo-discovery')).rejects.toMatchObject({ code: 'UNAUTHENTICATED', status: 401 })
  const controller = new AbortController()
  const interrupted = createApiClient({ getIdToken: async () => 'token', fetch: async () => { controller.abort(); return photo() } })
  await expect(interrupted.getDiscoveryPhoto('demo-discovery', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
  const noToken = createApiClient({ fetch: async () => { throw new Error('Must not send') } })
  await expect(noToken.getDiscoveryPhoto('demo-discovery')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
})

it('reads a JPEG signature split across stream chunks without requiring Content-Length', async () => {
  const body = new ReadableStream<Uint8Array>({ start(controller) {
    controller.enqueue(jpeg.slice(0, 1)); controller.enqueue(jpeg.slice(1, 2)); controller.enqueue(jpeg.slice(2)); controller.close()
  } })
  const api = createApiClient({ getIdToken: async () => 'token', fetch: async () => new Response(body, { headers: { 'Content-Type': 'image/jpeg' } }) })
  expect((await api.getDiscoveryPhoto('demo-discovery')).size).toBe(4)
})

it('cancels a stalled photo stream on abort instead of keeping private bytes and a pending request alive', async () => {
  let started!: () => void
  const reading = new Promise<void>((resolve) => { started = resolve })
  let cancelled = false
  const body = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(jpeg.slice(0, 1)) },
    pull() { started() },
    cancel() { cancelled = true },
  })
  const controller = new AbortController()
  const api = createApiClient({ getIdToken: async () => 'token', fetch: async () => new Response(body, { headers: { 'Content-Type': 'image/jpeg' } }) })
  const pending = api.getDiscoveryPhoto('demo-discovery', { signal: controller.signal })
  await reading
  controller.abort()
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  expect(cancelled).toBe(true)
})

it('uses DELETE once and then queries the returned deletion ID, with no request body', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ deletionId: 'deletion-a' }, 202))
    .mockResolvedValueOnce(json({ deletionId: 'deletion-a', state: 'pending', retryable: false }))
  const api = createApiClient({ fetch: fetcher, getIdToken: async () => 'token' })
  expect(await api.deleteDiscovery('demo-discovery')).toEqual({ deletionId: 'deletion-a' })
  expect(await api.getDeletion('deletion-a')).toEqual({ deletionId: 'deletion-a', state: 'pending', retryable: false })
  expect(fetcher.mock.calls[0][1]?.method).toBe('DELETE')
  expect(fetcher.mock.calls[0][1]?.body).toBeUndefined()
  expect(fetcher.mock.calls[1][0]).toBe('/api/v1/me/deletions/deletion-a')
  const wrong = createApiClient({ fetch: async () => json({ deletionId: 'other', state: 'completed', retryable: false }), getIdToken: async () => 'token' })
  await expect(wrong.getDeletion('deletion-a')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
})

it('rejects unknown deletion states, leaked private fields and contradictory completion flags', () => {
  expect(parseDeletionReceipt({ deletionId: 'deletion-a' })).toEqual({ deletionId: 'deletion-a' })
  for (const value of [{ deletionId: '' }, { deletionId: 'a/b' }, { deletionId: 'a', uid: 'private' }]) {
    expect(() => parseDeletionReceipt(value)).toThrow(ContractError)
  }
  for (const value of [{ deletionId: 'a', state: 'lost', retryable: true }, { deletionId: 'a', state: 'completed', retryable: true },
    { deletionId: 'a', state: 'pending', retryable: 'yes' }, { deletionId: 'a', state: 'failed', retryable: true, photoPath: 'private' }]) {
    expect(() => parseDeletionStatus(value)).toThrow(ContractError)
  }
})
