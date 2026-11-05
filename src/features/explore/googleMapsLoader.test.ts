import { describe, expect, it } from 'vitest'
import { loadGoogleMaps, type GoogleMapsApi } from './googleMapsLoader'

describe('Google Maps loader', () => {
  it('uses an injected key, shares the script, and resolves through its callback without network access', async () => {
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
})
