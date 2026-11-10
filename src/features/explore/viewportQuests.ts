import type { PublicArea, PublicQuest } from '../../shared/api/types'

// ピンは問題の対象座標ではなく、公開探索エリアの代表点（外周リングの重心）に置く。
// MultiPolygon は最初に有効なポリゴンの外周を使う。
export function areaPinPosition(area: PublicArea): { lat: number; lng: number } | null {
  const geometry = area.publicGeometry
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
  for (const polygon of polygons) {
    const ring = polygon?.[0]
    if (!ring || ring.length < 4) continue
    if (!ring.every(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat) && Math.abs(lng) <= 180 && Math.abs(lat) <= 90)) continue
    const [firstLng, firstLat] = ring[0]
    const [lastLng, lastLat] = ring[ring.length - 1]
    const points = firstLng === lastLng && firstLat === lastLat ? ring.slice(0, -1) : ring
    if (!points.length) continue
    let lat = 0
    let lng = 0
    for (const [pointLng, pointLat] of points) { lng += pointLng; lat += pointLat }
    return { lat: lat / points.length, lng: lng / points.length }
  }
  return null
}

export function questThumbnail(quest: PublicQuest): string | undefined {
  if (quest.optionalHintImage) return quest.optionalHintImage
  return quest.hintImages?.find((image) => typeof image === 'string' && image.length > 0) ?? undefined
}
