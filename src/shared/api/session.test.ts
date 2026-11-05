import { describe, expect, it, vi } from 'vitest'
import { createApiClient } from './client'

const json = (body: unknown, mode?: string) => new Response(JSON.stringify(body), {
  headers: { 'Content-Type': 'application/json', ...(mode ? { 'X-Quest-Data-Mode': mode } : {}) },
})

describe('server identity confirmation', () => {
  it('uses the current ID token for each confirmation and exposes only the validated uid', async () => {
    const getIdToken = vi.fn().mockResolvedValueOnce('token-one').mockResolvedValueOnce('token-two')
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => json({ uid: 'verified-user' }))
    const api = createApiClient({ fetch: fetcher, getIdToken })
    expect(await api.getSession()).toEqual({ uid: 'verified-user' })
    expect(await api.getSession()).toEqual({ uid: 'verified-user' })
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual(['/api/v1/session', '/api/v1/session'])
    expect(new Headers(fetcher.mock.calls[0][1]?.headers).get('Authorization')).toBe('Bearer token-one')
    expect(new Headers(fetcher.mock.calls[1][1]?.headers).get('Authorization')).toBe('Bearer token-two')
  })

  it('does not call the protected endpoint without a token', async () => {
    const fetcher = vi.fn<typeof fetch>()
    await expect(createApiClient({ fetch: fetcher }).getSession()).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it.each([{ uid: '' }, { uid: ' ' }, { uid: 'x'.repeat(129) }, { uid: 'user', role: 'admin' }, { email: 'test@example.invalid' }])(
    'rejects invalid or extra identity fields: %j', async (body) => {
      const api = createApiClient({ fetch: vi.fn(async () => json(body)), getIdToken: async () => 'token' })
      await expect(api.getSession()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
    },
  )

  it('requires demo provenance only when explicitly configured', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ uid: 'user' }))
      .mockResolvedValueOnce(json({ uid: 'user' }, 'real')).mockResolvedValueOnce(json({ uid: 'user' }, 'demo'))
    const api = createApiClient({ fetch: fetcher, getIdToken: async () => 'token', expectedDataMode: 'demo' })
    await expect(api.getSession()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
    await expect(api.getSession()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
    expect(await api.getSession()).toEqual({ uid: 'user' })
  })
})
