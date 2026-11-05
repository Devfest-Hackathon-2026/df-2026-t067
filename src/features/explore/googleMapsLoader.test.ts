import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GoogleMapsApi } from './googleMapsLoader'

beforeEach(() => vi.resetModules())
afterEach(() => {
  delete window.google
  document.querySelectorAll('script[data-quest-google-maps]').forEach(script => script.remove())
  vi.useRealTimers()
})

describe('Google Maps loader', () => {
  it('uses an injected key, shares the script, and resolves through its callback without network access', async () => {
    const { loadGoogleMaps } = await import('./googleMapsLoader')
    const first = loadGoogleMaps('test-key')
    const second = loadGoogleMaps('ignored-second-key')
    const scripts = document.querySelectorAll<HTMLScriptElement>('script[data-quest-google-maps]')
    expect(scripts).toHaveLength(1)
    expect(scripts[0].src).toContain('key=test-key')
    const api = { Map: class {}, event: { addListener: () => ({ remove() {} }) } } as unknown as GoogleMapsApi
    window.google = { maps: api }
    const callback = new URL(scripts[0].src).searchParams.get('callback')!
    const ready = (window as unknown as Record<string, unknown>)[callback] as () => void
    ready()
    expect(await first).toBe(api)
    expect(await second).toBe(api)
    delete window.google
    scripts[0].remove()
  })
  it('removes a failed script and can retry through a new callback', async () => {
    const { loadGoogleMaps } = await import('./googleMapsLoader')
    const first = loadGoogleMaps('test-key')
    const script = document.querySelector<HTMLScriptElement>('script[data-quest-google-maps]')!
    const callback = new URL(script.src).searchParams.get('callback')!
    script.dispatchEvent(new Event('error'))
    await expect(first).rejects.toThrow('network')
    expect(script).not.toBeInTheDocument()
    expect((window as unknown as Record<string, unknown>)[callback]).toBeUndefined()
    const retry = loadGoogleMaps('test-key')
    const replacement = document.querySelector<HTMLScriptElement>('script[data-quest-google-maps]')!
    expect(replacement).not.toBe(script)
    window.google = { maps: { Map: class {}, event: { addListener: () => ({ remove() {} }) } } }
    const ready = (window as unknown as Record<string, unknown>)[new URL(replacement.src).searchParams.get('callback')!] as () => void
    ready()
    expect(await retry).toBe(window.google.maps)
  })
  it('times out a stalled script and removes its callback and auth handler', async () => {
    vi.useFakeTimers()
    const { loadGoogleMaps } = await import('./googleMapsLoader')
    const previousFailure = window.gm_authFailure
    const request = loadGoogleMaps('test-key', 100)
    const script = document.querySelector<HTMLScriptElement>('script[data-quest-google-maps]')!
    const callback = new URL(script.src).searchParams.get('callback')!
    const rejected = expect(request).rejects.toThrow('timeout')
    await vi.advanceTimersByTimeAsync(101)
    await rejected
    expect(script).not.toBeInTheDocument()
    expect((window as unknown as Record<string, unknown>)[callback]).toBeUndefined()
    expect(window.gm_authFailure).toBe(previousFailure)
  })
})
