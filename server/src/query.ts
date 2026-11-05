import type { Page, PublicArea } from '../../src/shared/api/types'
import { invalidInput } from './errors'

type Bbox = [west: number, south: number, east: number, north: number]

export function parseId(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value)) invalidInput()
  return value
}

export function validateQuery(params: URLSearchParams, allowed: readonly string[]): void {
  for (const key of params.keys()) {
    if (!allowed.includes(key) || params.getAll(key).length !== 1) invalidInput()
  }
}

export function parseLimit(params: URLSearchParams): number {
  const value = params.get('limit')
  if (value === null) return 20
  if (!/^[1-9]\d{0,2}$/.test(value) || Number(value) > 100) invalidInput()
  return Number(value)
}

function decimal(value: string): number {
  if (!/^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(value) || !Number.isFinite(Number(value))) invalidInput()
  return Number(value)
}

export function parseAreaQuery(params: URLSearchParams): { bbox?: Bbox; zoom?: number } {
  validateQuery(params, ['bbox', 'zoom', 'cursor', 'limit'])
  const result: { bbox?: Bbox; zoom?: number } = {}
  const rawBbox = params.get('bbox')
  if (rawBbox !== null) {
    const parts = rawBbox.split(',').map(decimal)
    if (parts.length !== 4 || Math.abs(parts[0]) > 180 || Math.abs(parts[2]) > 180 ||
      Math.abs(parts[1]) > 90 || Math.abs(parts[3]) > 90 || parts[1] > parts[3]) invalidInput()
    result.bbox = parts as Bbox
  }
  const rawZoom = params.get('zoom')
  if (rawZoom !== null) {
    const zoom = decimal(rawZoom)
    if (zoom < 0 || zoom > 24) invalidInput()
    result.zoom = zoom
  }
  return result
}

// Demo regions are simple non-wrapping polygons. Use their public geometry's
// extent (not an answer location or marker) to select intersecting map regions.
export function intersectsBbox(area: PublicArea, bbox: Bbox): boolean {
  const polygons = area.publicGeometry.type === 'Polygon'
    ? [area.publicGeometry.coordinates] : area.publicGeometry.coordinates
  const [west, south, east, north] = bbox
  return polygons.some((polygon) => {
    const points = polygon[0]
    const left = Math.min(...points.map(([lng]) => lng))
    const right = Math.max(...points.map(([lng]) => lng))
    const bottom = Math.min(...points.map(([, lat]) => lat))
    const top = Math.max(...points.map(([, lat]) => lat))
    const horizontal = west <= east ? right >= west && left <= east : right >= west || left <= east
    return horizontal && top >= south && bottom <= north
  })
}

export function paginate<T>(items: T[], params: URLSearchParams, scope: string, id: (item: T) => string): Page<T> {
  const limit = parseLimit(params)
  let start = 0
  const cursor = params.get('cursor')
  if (cursor !== null) {
    if (!/^[A-Za-z0-9_-]{1,2048}$/.test(cursor)) invalidInput()
    let data: unknown
    try {
      const decoded = Buffer.from(cursor, 'base64url')
      if (decoded.toString('base64url') !== cursor) invalidInput()
      data = JSON.parse(decoded.toString('utf8'))
    } catch { invalidInput() }
    if (!data || typeof data !== 'object' || Array.isArray(data)) invalidInput()
    const d = data as Record<string, unknown>
    if (Object.keys(d).sort().join(',') !== 'after,scope,v' || d.v !== 1 || d.scope !== scope || typeof d.after !== 'string') invalidInput()
    const index = items.findIndex((item) => id(item) === d.after)
    if (index < 0) invalidInput()
    start = index + 1
  }
  const page = items.slice(start, start + limit)
  const nextCursor = start + limit < items.length
    ? Buffer.from(JSON.stringify({ v: 1, scope, after: id(page[page.length - 1]) })).toString('base64url') : null
  return { items: page, nextCursor }
}
