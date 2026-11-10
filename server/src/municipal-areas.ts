import { areaContainsPosition } from '../../src/shared/areaContainsPosition'
import type { Position } from '../../src/shared/api/types'
import { HttpError } from './errors'
import { isPrefectureCode, parsePublicArea } from '../../src/shared/api/validation'
import type { PublicArea } from '../../src/shared/api/types'

export type MunicipalAreaBoundary =
  | { source: 'N03'; municipalityCode: string; year: number }
  | { source: 'fixture' }

export interface MunicipalAreaRecord {
  id: string
  data: unknown
}

export interface MunicipalAreaMember {
  areaId: string
  municipalityCode?: string
}

export interface ReadMunicipalArea {
  area: PublicArea
  boundary: MunicipalAreaBoundary
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * 地域データに都道府県コード（D-22）が正しく付いている場合だけその値を返す。
 * 付いていない地域は「未分類」であり、問題の作成・公開を拒否する判定に使う（D-33）。
 */
export function areaPrefectureCode(data: unknown): string | undefined {
  if (!isRecord(data)) return undefined
  return isPrefectureCode(data.prefectureCode) ? data.prefectureCode : undefined
}

/**
 * Reads an area only when its server-owned metadata agrees with the current
 * membership. Invalid stored data and mismatched identities fail closed.
 */
export function readMunicipalArea(record: MunicipalAreaRecord | null, member: MunicipalAreaMember): ReadMunicipalArea | null {
  if (!record || !isRecord(record.data) || record.id !== member.areaId) return null

  const data = record.data
  let publicGeometry: unknown
  if (typeof data.publicGeometryJson !== 'string') return null
  try { publicGeometry = JSON.parse(data.publicGeometryJson) as unknown } catch { return null }

  let area: PublicArea
  try {
    area = parsePublicArea({
      areaId: record.id,
      label: data.label,
      marker: data.marker,
      publicGeometry,
      publishedCount: 0,
    })
  } catch { return null }

  if (data.boundarySource === 'fixture') {
    // 架空区域の照合は所属側だけで行う（D-69）。合成検証の所属には実自治体コードを
    // 設定しない運用（D-23）のため、所属にコードがあれば不一致として弾く。一方、
    // 地域側の municipalityCode は D-30 の公開射影用メタデータであり、境界の出所とは
    // 独立に持たせてある（デモ地域9件）。付いていること自体は fixture 解決を妨げない。
    if (member.municipalityCode !== undefined) return null
    return { area, boundary: { source: 'fixture' } }
  }

  if (data.boundarySource !== 'N03' ||
    typeof member.municipalityCode !== 'string' || !/^\d{5}$/.test(member.municipalityCode) ||
    typeof data.municipalityCode !== 'string' || !/^\d{5}$/.test(data.municipalityCode) ||
    data.municipalityCode !== member.municipalityCode ||
    typeof data.boundaryYear !== 'number' || !Number.isInteger(data.boundaryYear) ||
    data.boundaryYear < 1000 || data.boundaryYear > 9999) return null

  return {
    area,
    boundary: { source: 'N03', municipalityCode: data.municipalityCode, year: data.boundaryYear },
  }
}

export function prepareN03Area(input: unknown, options: {
  areaId: string; municipalityCode: string; year: number; name: string; marker: PublicArea['marker']
}) {
  if (!isRecord(input) || input.type !== 'FeatureCollection' || !Array.isArray(input.features)) {
    throw new Error('WGS84のGeoJSON FeatureCollectionを指定してください。')
  }
  const polygons: unknown[] = []
  for (const feature of input.features as unknown[]) {
    if (!isRecord(feature) || !isRecord(feature.properties) || feature.properties.N03_007 !== options.municipalityCode) continue
    const geometry = feature.geometry
    if (feature.type !== 'Feature' || !isRecord(geometry) || !Array.isArray(geometry.coordinates) ||
      !['Polygon', 'MultiPolygon'].includes(String(geometry.type)) || geometry.coordinates.length === 0) {
      throw new Error('自治体コードに対応する区域に無効な形状があります。')
    }
    if (geometry.type === 'Polygon') polygons.push(geometry.coordinates)
    else polygons.push(...geometry.coordinates)
  }
  if (!polygons.length) throw new Error('自治体コードに一致する区域がありません。')
  const publicGeometryJson = JSON.stringify(polygons.length === 1 ? { type: 'Polygon', coordinates: polygons[0] }
    : { type: 'MultiPolygon', coordinates: polygons })
  if (Buffer.byteLength(publicGeometryJson, 'utf8') > 900_000) throw new Error('区域が保存上限を超えています。形状と容量を確認してください。')
  const data = { label: options.name, marker: options.marker, publicGeometryJson,
    boundarySource: 'N03', municipalityCode: options.municipalityCode, boundaryYear: options.year }
  if (!readMunicipalArea({ id: options.areaId, data }, options)) throw new Error('区域、コード、年度または代表点が無効です。')
  return { areaId: options.areaId, data }
}

export function assertSpotInMunicipalArea(area: ReadMunicipalArea | null, position?: Position) {
  if (area && position && !areaContainsPosition(area.area.publicGeometry, position)) {
    throw new HttpError(400, 'SPOT_OUTSIDE_AREA', 'エリアの外です')
  }
}
