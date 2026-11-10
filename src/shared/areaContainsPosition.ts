import type { LngLat, Position, PublicGeometry } from './api/types'

function ringContains(ring: LngLat[], x: number, y: number): boolean | 'edge' {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, ay] = ring[j], [bx, by] = ring[i]
    const cross = (x - ax) * (by - ay) - (y - ay) * (bx - ax)
    if (Math.abs(cross) < 1e-12 && x >= Math.min(ax, bx) && x <= Math.max(ax, bx) && y >= Math.min(ay, by) && y <= Math.max(ay, by)) return 'edge'
    if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) inside = !inside
  }
  return inside
}

export function areaContainsPosition(geometry: PublicGeometry, position: Position): boolean {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
  return polygons.some(([outer, ...holes]) => {
    const outside = ringContains(outer, position.longitude, position.latitude)
    if (outside === 'edge') return true
    return outside && !holes.some(hole => ringContains(hole, position.longitude, position.latitude) === true)
  })
}
