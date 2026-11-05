import { expect, it, vi } from 'vitest'
import { createApiClient } from './client'
import { parseOrgAssetMetadata, parseUploadedOrgAsset } from './admin'
import { ContractError } from './validation'

const asset = { assetId: 'asset-a', orgId: 'demo-org', purpose: 'reference', photoRights: '自作の合成画像',
  contentType: 'image/jpeg', width: 2, height: 2, byteLength: 100, source: 'mock' }
const input = { purpose: 'reference' as const, photoRights: '自作の合成画像',
  photo: new Blob([new Uint8Array([255, 216, 255, 217])], { type: 'image/jpeg' }), idempotencyKey: 'asset-a' }
const headers = { 'X-Quest-Data-Mode': 'demo', 'X-Quest-Assets-Mode': 'memory' }
const json = (value: unknown) => new Response(JSON.stringify(value), { headers })

it('uploads only photo and validated purpose/rights metadata with a stable request key and fresh token', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json(asset))
  const api = createApiClient({ fetch: fetcher, expectedDataMode: 'demo', getIdToken: async () => 'token' })
  expect(await api.uploadOrgAsset('demo-org', input)).toEqual(asset)
  const [url, options] = fetcher.mock.calls[0]
  expect(url).toBe('/api/v1/orgs/demo-org/assets')
  expect(new Headers(options?.headers).get('Idempotency-Key')).toBe('asset-a')
  expect(new Headers(options?.headers).get('Authorization')).toBe('Bearer token')
  expect(new Headers(options?.headers).has('Content-Type')).toBe(false)
  const form = options?.body as FormData
  expect(JSON.parse(String(form.get('metadata')))).toEqual({ purpose: 'reference', photoRights: '自作の合成画像' })
  expect(Array.from(form.keys()).sort()).toEqual(['metadata', 'photo'])
})

it('rejects mock, wrong organization, wrong asset ID and wrong upload purpose responses', async () => {
  const plain = createApiClient({ fetch: async () => json(asset), getIdToken: async () => 'token' })
  await expect(plain.getOrgAsset('demo-org', 'asset-a')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  const api = createApiClient({ fetch: async () => json(asset), expectedDataMode: 'demo', getIdToken: async () => 'token' })
  await expect(api.getOrgAsset('other-org', 'asset-a')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  await expect(api.getOrgAsset('demo-org', 'other-asset')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  await expect(api.uploadOrgAsset('demo-org', { ...input, purpose: 'public_hint' })).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
})

it('validates image, purpose, rights and keys before an upload can reach the network', async () => {
  const fetcher = vi.fn<typeof fetch>()
  const api = createApiClient({ fetch: fetcher, getIdToken: async () => 'token', expectedDataMode: 'demo' })
  for (const patch of [{ photo: new Blob() }, { purpose: 'answer' as never }, { photoRights: '' }, { idempotencyKey: 'has space' },
    { photo: new Blob(['<svg/>'], { type: 'image/svg+xml' }) }]) {
    await expect(api.uploadOrgAsset('demo-org', { ...input, ...patch })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  }
  await expect(api.uploadOrgAsset('demo-org', { ...input, photo: new Blob([new Uint8Array(4 * 1024 * 1024 + 1)], { type: 'image/jpeg' }) })).rejects.toMatchObject({ code: 'MEDIA_TOO_LARGE' })
  await expect(api.uploadOrgAsset('demo-org', { ...input, photoRights: 'あ'.repeat(1400) })).rejects.toMatchObject({ code: 'MEDIA_TOO_LARGE' })
  expect(fetcher).not.toHaveBeenCalled()
})

it('gets an asset photo only through its org-scoped authenticated endpoint', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(new Uint8Array([255, 216, 255, 217]), {
    headers: { ...headers, 'Content-Type': 'image/jpeg' },
  }))
  const api = createApiClient({ fetch: fetcher, expectedDataMode: 'demo', getIdToken: async () => 'token' })
  expect((await api.getOrgAssetPhoto('demo-org', 'asset-a')).size).toBe(4)
  expect(fetcher.mock.calls[0][0]).toBe('/api/v1/orgs/demo-org/assets/asset-a/photo')
  expect(new Headers(fetcher.mock.calls[0][1]?.headers).get('Authorization')).toBe('Bearer token')
})

it('validates asset dimensions, content type and allowed fields without exposing rejected values', () => {
  expect(parseUploadedOrgAsset(asset)).toEqual(asset)
  for (const patch of [{ width: 0 }, { height: 1601 }, { byteLength: 2 * 1024 * 1024 + 1 }, { contentType: 'text/html' }, { source: 'unknown' }, { privatePath: 'secret' }]) {
    expect(() => parseUploadedOrgAsset({ ...asset, ...patch })).toThrow(ContractError)
  }
  expect(() => parseOrgAssetMetadata({ purpose: 'reference', photoRights: 'ok', orgId: 'other' })).toThrow(ContractError)
})
