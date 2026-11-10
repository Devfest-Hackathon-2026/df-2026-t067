import { parseSpotAddressInput } from '../../src/shared/api/admin-spot-address'
import type { SpotAddressCandidate, SpotAddressInput } from '../../src/shared/api/admin-spot-address'
import type { Position } from '../../src/shared/api/types'

function record(input: unknown): Record<string, unknown> | undefined {
  return input !== null && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : undefined
}

function addressOf(input: unknown): string | undefined {
  const value = record(input)?.formattedAddress
  return typeof value === 'string' && value.length <= 1000 ? value.trim() || undefined : undefined
}

function matchesPin(pin: Position, location: unknown): boolean {
  try {
    const { position } = parseSpotAddressInput({ position: location })
    if (!position) return false
    // Compare the two pins locally. A nearby address is still a candidate only.
    const east = ((position.longitude - pin.longitude + 540) % 360) - 180
    const longitudeScale = Math.cos((position.latitude + pin.latitude) * Math.PI / 360)
    return Math.hypot(position.latitude - pin.latitude, east * longitudeScale) * 111_195 <= 50
  } catch { return false }
}

async function readGoogleJson(response: Response): Promise<unknown> {
  if (!response.body) throw new Error('Missing geocode response body')
  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let body = '', bytes = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) return JSON.parse(body + decoder.decode()) as unknown
      bytes += value.byteLength
      if (bytes > 32_768) throw new Error('Geocode response exceeded its limit')
      body += decoder.decode(value, { stream: true })
    }
  } finally { await reader.cancel().catch(() => {}) }
}

export function createSpotAddressGeocoder(apiKey: string, fetchGoogle: typeof fetch = fetch) {
  return async ({ position, googlePlaceId }: SpotAddressInput, callerSignal: AbortSignal): Promise<SpotAddressCandidate> => {
    const signal = AbortSignal.any([callerSignal, AbortSignal.timeout(4500)])
    const url = new URL(googlePlaceId ? '/v4/geocode/places/' + encodeURIComponent(googlePlaceId) : '/v4/geocode/location',
      'https://geocode.googleapis.com')
    url.searchParams.set('languageCode', 'ja')
    url.searchParams.set('regionCode', 'JP')
    if (!googlePlaceId && position) {
      url.searchParams.set('location.latitude', String(position.latitude))
      url.searchParams.set('location.longitude', String(position.longitude))
    }
    try {
      signal.throwIfAborted()
      const response = await fetchGoogle(url, { signal, redirect: 'error', cache: 'no-store', headers: {
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': googlePlaceId ? (position ? 'formattedAddress,placeId,location' : 'formattedAddress,placeId') : 'results.formattedAddress',
      } })
      if (!response.ok) {
        await response.body?.cancel()
        return { status: response.status === 404 ? 'no-result' : 'unavailable' }
      }
      const data = record(await readGoogleJson(response))
      if (!data) return { status: 'unavailable' }
      if (googlePlaceId) {
        const address = addressOf(data)
        if (!address) return { status: 'no-result' }
        if (data.placeId !== googlePlaceId || (position && !matchesPin(position, data.location))) return { status: 'conflict' }
        return { status: 'candidate', source: 'place', address }
      }
      if (data.results !== undefined && !Array.isArray(data.results)) return { status: 'unavailable' }
      const address = Array.isArray(data.results) ? addressOf(data.results[0]) : undefined
      return address ? { status: 'candidate', source: 'nearby', address } : { status: 'no-result' }
    } catch { return { status: 'unavailable' } }
  }
}
