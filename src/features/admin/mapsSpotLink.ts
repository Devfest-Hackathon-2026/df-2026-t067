import type { ConfirmedSpot, Position } from '../../shared/api/types'

export interface SpotInput {
  url: string
  name: string
  address: string
  latitude: string
  longitude: string
  googlePlaceId?: string
  confirmed: boolean
}

export function initialSpotInput(spot?: ConfirmedSpot): SpotInput {
  return { url: '', name: spot?.name ?? '', address: spot?.address ?? '',
    latitude: spot ? String(spot.position.latitude) : '', longitude: spot ? String(spot.position.longitude) : '',
    googlePlaceId: spot?.googlePlaceId, confirmed: Boolean(spot) }
}

export function confirmedSpot(input: SpotInput): ConfirmedSpot | null | 'incomplete' {
  if (![input.name, input.address, input.latitude, input.longitude, input.googlePlaceId ?? ''].some((value) => value.trim())) return null
  const position = spotPosition(input.latitude, input.longitude)
  if (!position || !input.name.trim() || !input.address.trim() || !input.confirmed) return 'incomplete'
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

export function parseMapsSpotLink(input: string): { message: string; position?: Position | null; googlePlaceId?: string } {
  const invalid = { message: 'Google MapsのHTTPS共有リンクを入力してください。' }
  if (input.length > 4096) return invalid
  let url: URL
  try { url = new URL(input.trim()) } catch { return invalid }
  if (!url || url.protocol !== 'https:' || url.username || url.password || url.port) return invalid
  if (url.hostname === 'maps.app.goo.gl' || (url.hostname === 'goo.gl' && url.pathname.startsWith('/maps/'))) {
    return { message: '短縮リンクはこの画面で展開できません。Google Mapsで開いた後のURLを貼るか、地図または数値入力で位置を指定してください。' }
  }
  if (!mapsHosts.has(url.hostname) || (!/^\/maps(?:\/|$)/.test(url.pathname) &&
    !(url.hostname.startsWith('maps.google.') && url.pathname === '/'))) return invalid
  if (/^\/maps\/dir(?:\/|$)/.test(url.pathname)) return { message: '経路リンクから対象スポットを特定できません。スポットの共有リンクを指定してください。' }
  // The @lat,lng portion describes the map viewport. It is never used as a spot.
  const query = url.searchParams.get('query') ?? url.searchParams.get('q') ?? ''
  const [lat, lng, extra] = query.split(',')
  const queryPosition = lng !== undefined && extra === undefined ? spotPosition(lat, lng) : null
  const placePath = url.pathname.startsWith('/maps/place/')
  const pairs = placePath ? [...url.pathname.matchAll(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)(?=!|$)/g)] : []
  const placePosition = pairs.length === 1 ? spotPosition(pairs[0][1], pairs[0][2]) : null
  const position = queryPosition ?? placePosition
  const id = url.searchParams.get('query_place_id') ?? (/^place_id:([A-Za-z0-9_-]+)$/.exec(query)?.[1])
  const googlePlaceId = id && /^[A-Za-z0-9_-]{1,512}$/.test(id) ? id : undefined
  return { position, googlePlaceId, message: position
    ? '位置候補を入力しました。位置・スポット名・住所を確認してください。'
    : 'リンクから対象の座標を特定できませんでした。地図または数値入力で位置を指定してください。' }
}
