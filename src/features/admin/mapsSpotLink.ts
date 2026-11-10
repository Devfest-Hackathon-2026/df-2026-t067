import type { ConfirmedSpot, Position } from '../../shared/api/types'

export interface SpotInput {
  url: string
  name: string
  address: string
  latitude: string
  longitude: string
  googlePlaceId?: string
  hasImportedLink?: boolean
}

export function initialSpotInput(spot?: ConfirmedSpot): SpotInput {
  return { url: '', name: spot?.name ?? '', address: spot?.address ?? '',
    latitude: spot ? String(spot.position.latitude) : '', longitude: spot ? String(spot.position.longitude) : '',
    googlePlaceId: spot?.googlePlaceId }
}

export function spotForDraft(input: SpotInput): ConfirmedSpot | null | 'incomplete' {
  if (![input.name, input.address, input.latitude, input.longitude, input.googlePlaceId ?? ''].some((value) => value.trim())) {
    return input.hasImportedLink ? 'incomplete' : null
  }
  const position = spotPosition(input.latitude, input.longitude)
  if (!position || !input.name.trim() || !input.address.trim()) return 'incomplete'
  return { name: input.name.trim(), address: input.address.trim(), position,
    ...(input.googlePlaceId ? { googlePlaceId: input.googlePlaceId } : {}) }
}

const mapsHosts = new Set(['google.com', 'www.google.com', 'maps.google.com',
  'google.co.jp', 'www.google.co.jp', 'maps.google.co.jp'])

export function spotPosition(latitude: string, longitude: string): Position | null {
  if (![latitude, longitude].every((value) => /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim()))) return null
  const lat = Number(latitude), lng = Number(longitude)
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { latitude: lat, longitude: lng } : null
}

function httpsLink(input: string): URL | null {
  if (input.length > 4096 || input.includes('\\') || Array.from(input).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) return null
  const url = URL.parse(input.trim())
  return url?.protocol === 'https:' && !url.username && !url.password && !url.port ? url : null
}

function mapsPath(url: URL) {
  return mapsHosts.has(url.hostname) && (/^\/maps(?:\/|$)/.test(url.pathname) ||
    (url.hostname.startsWith('maps.google.') && url.pathname === '/'))
}

function coordinatePair(value: string) {
  const [lat, lng, extra] = value.split(',')
  return lng !== undefined && extra === undefined ? spotPosition(lat, lng) : null
}

function placeCoordinates(path: string) {
  if (!path.startsWith('/maps/place/')) return null
  const pairs = [...path.matchAll(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)(?=!|$)/g)]
  return pairs.length === 1 ? spotPosition(pairs[0][1], pairs[0][2]) : null
}

function validPlaceId(id: string) { return /^[A-Za-z0-9_-]{1,512}$/.test(id) }

export function parseMapsSpotLink(input: string): { message: string; position?: Position | null; googlePlaceId?: string } {
  const invalid = { message: 'Google MapsのHTTPS共有リンクを入力してください。' }
  const url = httpsLink(input)
  if (!url) return invalid
  if (url.hostname === 'maps.app.goo.gl' || (url.hostname === 'goo.gl' && url.pathname.startsWith('/maps/'))) {
    return { message: '短縮リンクはこの画面で展開できません。Google Mapsで開いた後のURLを貼るか、地図または数値入力で位置を指定してください。' }
  }
  if (!mapsPath(url)) return invalid
  if (/^\/maps\/dir(?:\/|$)/.test(url.pathname)) return { message: '経路リンクから対象スポットを特定できません。スポットの共有リンクを指定してください。' }
  // The @lat,lng portion describes the map viewport. It is never used as a spot.
  const query = url.searchParams.get('query') ?? url.searchParams.get('q') ?? ''
  const position = coordinatePair(query) ?? placeCoordinates(url.pathname)
  const id = url.searchParams.get('query_place_id') ?? (/^place_id:([A-Za-z0-9_-]+)$/.exec(query)?.[1])
  const googlePlaceId = id && validPlaceId(id) ? id : undefined
  return { position, googlePlaceId, message: position
    ? '位置候補を入力しました。位置・スポット名・住所を確認してください。'
    : 'リンクから対象の座標を特定できませんでした。地図または数値入力で位置を指定してください。' }
}

export type DurableMapsLink =
  | { kind: 'invalid' | 'unsupported' }
  | { kind: 'short'; href: string }
  | { kind: 'place'; position: Position | null; googlePlaceId?: string; label?: string }

export function parseDurableMapsLink(input: string): DurableMapsLink {
  const url = httpsLink(input)
  if (!url) return { kind: 'invalid' }
  if ((url.hostname === 'maps.app.goo.gl' && /^\/[A-Za-z0-9_-]{1,256}\/?$/.test(url.pathname)) ||
    (url.hostname === 'goo.gl' && /^\/maps\/[A-Za-z0-9_-]{1,256}\/?$/.test(url.pathname))) {
    return { kind: 'short', href: url.origin + url.pathname }
  }
  if (!mapsPath(url)) return { kind: 'invalid' }
  let path: string
  try { path = decodeURIComponent(url.pathname) } catch { return { kind: 'invalid' } }
  if (path !== '/' && !/^\/maps(?:\/?$|\/(?:place|search)\/)/.test(path)) return { kind: 'unsupported' }

  const keys = ['query', 'q', 'query_place_id', 'place_id']
  if (keys.some((key) => url.searchParams.getAll(key).length > 1) ||
    (url.searchParams.has('query') && url.searchParams.has('q'))) return { kind: 'unsupported' }
  const query = url.searchParams.get('query') ?? url.searchParams.get('q') ?? ''
  const pathLabel = /^\/maps\/(?:place|search)\/([^/@]+)/.exec(path)?.[1]?.replaceAll('+', ' ') ?? ''
  const pins = [coordinatePair(query), placeCoordinates(path), coordinatePair(pathLabel)].filter((pin) => pin !== null)
  const position = pins[0] ?? null
  if (position && pins.some((pin) => position.latitude !== pin.latitude || position.longitude !== pin.longitude)) return { kind: 'unsupported' }

  const embeddedIds = path.startsWith('/maps/place/')
    ? [...path.matchAll(/!1s(ChIJ[A-Za-z0-9_-]{1,508})(?=!|$)/g)].map((match) => match[1]) : []
  const ids = [url.searchParams.get('query_place_id'), url.searchParams.get('place_id'), /^place_id:(.*)$/.exec(query)?.[1], ...embeddedIds]
    .filter((id) => id !== null && id !== undefined)
  const googlePlaceId = ids[0]
  if (ids.some((id) => !validPlaceId(id) || id !== googlePlaceId)) return { kind: 'unsupported' }
  const label = (query && !coordinatePair(query) && !query.startsWith('place_id:') ? query : pathLabel).trim()
  return { kind: 'place', position, googlePlaceId, ...(label && label.length <= 200 && !coordinatePair(label) ? { label } : {}) }
}
