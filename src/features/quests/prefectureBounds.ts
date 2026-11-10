import { REGIONS } from './areaHierarchy'

export type FilterBounds = { south: number; west: number; north: number; east: number }

// 表示用の概算範囲（離島を含む）。正解座標や撮影範囲ではなく、外部APIも使わない。
export const PREFECTURE_BOUNDS: Readonly<Record<string, FilterBounds>> = Object.fromEntries([
  ['北海道', 41.3, 139.3, 45.6, 145.9],
  ['青森県', 40.2, 139.4, 41.6, 141.7], ['岩手県', 38.7, 140.6, 40.5, 142.1],
  ['宮城県', 37.7, 140.2, 39.0, 141.8], ['秋田県', 38.8, 139.6, 40.6, 140.9],
  ['山形県', 37.7, 139.5, 39.3, 140.7], ['福島県', 36.7, 139.1, 38.0, 141.1],
  ['茨城県', 35.7, 139.6, 36.95, 140.9], ['栃木県', 36.1, 139.3, 37.2, 140.3],
  ['群馬県', 35.95, 138.3, 37.1, 139.7], ['埼玉県', 35.7, 138.7, 36.3, 139.95],
  ['千葉県', 34.9, 139.7, 36.15, 140.9], ['東京都', 20.4, 136.0, 35.95, 154.0],
  ['神奈川県', 35.1, 138.9, 35.7, 139.85], ['新潟県', 36.7, 137.6, 38.6, 140.0],
  ['富山県', 36.25, 136.7, 36.99, 137.8], ['石川県', 36.0, 136.2, 37.9, 137.4],
  ['福井県', 35.3, 135.4, 36.3, 136.85], ['山梨県', 35.15, 138.15, 35.99, 139.15],
  ['長野県', 35.2, 137.3, 37.1, 138.8], ['岐阜県', 35.1, 136.25, 36.5, 137.7],
  ['静岡県', 34.5, 137.45, 35.7, 139.2], ['愛知県', 34.55, 136.65, 35.45, 137.85],
  ['三重県', 33.7, 135.8, 35.3, 136.99], ['滋賀県', 34.75, 135.75, 35.75, 136.5],
  ['京都府', 34.7, 134.85, 35.8, 136.1], ['大阪府', 34.25, 135.05, 35.1, 135.8],
  ['兵庫県', 34.15, 134.25, 35.7, 135.6], ['奈良県', 33.85, 135.5, 34.8, 136.25],
  ['和歌山県', 33.4, 134.95, 34.4, 136.05], ['鳥取県', 35.05, 133.1, 35.65, 134.55],
  ['島根県', 34.3, 131.65, 36.4, 133.4], ['岡山県', 34.3, 133.25, 35.35, 134.45],
  ['広島県', 34.0, 132.0, 35.1, 133.5], ['山口県', 33.7, 130.75, 34.8, 132.5],
  ['徳島県', 33.5, 133.65, 34.3, 134.85], ['香川県', 34.0, 133.4, 34.6, 134.5],
  ['愛媛県', 32.9, 132.0, 34.3, 133.7], ['高知県', 32.65, 132.45, 33.9, 134.35],
  ['福岡県', 33.0, 130.0, 34.3, 131.2], ['佐賀県', 32.9, 129.7, 33.65, 130.55],
  ['長崎県', 31.95, 128.1, 34.75, 130.4], ['熊本県', 32.05, 129.9, 33.2, 131.35],
  ['大分県', 32.7, 130.8, 33.8, 132.2], ['宮崎県', 31.35, 130.7, 32.85, 131.9],
  ['鹿児島県', 27.0, 128.35, 32.35, 131.25], ['沖縄県', 24.0, 122.9, 27.95, 131.4],
].map(([name, south, west, north, east]) => [name, { south, west, north, east }])) as Readonly<Record<string, FilterBounds>>

function asList(value: string | readonly string[] | undefined): string[] {
  if (value == null || value === '') return []
  return (typeof value === 'string' ? [value] : [...value]).filter(Boolean)
}

function mergeBounds(parts: FilterBounds[]): FilterBounds | undefined {
  if (parts.length === 0) return undefined
  return {
    south: Math.min(...parts.map((b) => b.south)),
    west: Math.min(...parts.map((b) => b.west)),
    north: Math.max(...parts.map((b) => b.north)),
    east: Math.max(...parts.map((b) => b.east)),
  }
}

/** 選んだ地方・都道府県の固定範囲をすべて含む矩形（または結合）。FIT_MAX_ZOOM は呼び出し側のまま。 */
export function boundsForFilter(region: string | readonly string[] = '', prefecture: string | readonly string[] = ''): FilterBounds | undefined {
  const regions = asList(region)
  const prefectures = asList(prefecture)
  const parts: FilterBounds[] = []
  for (const name of prefectures) {
    const bounds = PREFECTURE_BOUNDS[name]
    if (bounds) parts.push(bounds)
  }
  for (const name of regions) {
    const members = REGIONS.find((item) => item.name === name)?.prefectures
    if (!members) continue
    for (const pref of members) {
      const bounds = PREFECTURE_BOUNDS[pref]
      if (bounds) parts.push(bounds)
    }
  }
  return mergeBounds(parts)
}
