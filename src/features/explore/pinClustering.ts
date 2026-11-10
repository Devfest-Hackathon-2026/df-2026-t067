// ピンのクラスタ化（D-52）のための純粋関数群。
// 現在のズームで画面上（ピクセル距離）重なるピンを1つのクラスタにまとめる。
// 画面距離は Web メルカトルのワールドピクセル座標で測る（そのズームでの画面ピクセルと一致し、
// 地図の中心に依存しないため、地図インスタンスなしで決定的に計算できる）。

export interface PinPoint {
  areaId: string
  lat: number
  lng: number
  questCount: number
}

export type PinArrangement =
  | { kind: 'pin'; point: PinPoint }
  | { kind: 'cluster'; points: PinPoint[]; lat: number; lng: number; totalQuests: number }

// ピン同士が重なったとみなす画面距離（px）。ピンの幅 36px に対して、少し余裕を持たせる。
export const PIN_CLUSTER_THRESHOLD_PX = 44

export function worldPixel(lat: number, lng: number, zoom: number): { x: number; y: number } {
  const scale = 256 * 2 ** zoom
  const x = ((lng + 180) / 360) * scale
  const sin = Math.sin((lat * Math.PI) / 180)
  const y = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale
  return { x, y }
}

// 重なるピンをまとめる。並びは入力順を保ち、まとめの起点は「最初に現れた未使用のピン」とする
// （起点から閾値以内のピンだけを集めるため、クラスタの広がりは最大でも閾値の2倍に収まる）。
// exemptAreaId（選択中の地域）はクラスタに隠さない：常に対象外として単独ピンで返し、
// 他のクラスタにも取り込まない。
export function arrangePins(points: PinPoint[], zoom: number, exemptAreaId = ''): PinArrangement[] {
  const projected = points.map((point) => ({ point, ...worldPixel(point.lat, point.lng, zoom) }))
  const used = new Set<string>()
  const result: PinArrangement[] = []
  for (const entry of projected) {
    if (used.has(entry.point.areaId)) continue
    used.add(entry.point.areaId)
    if (entry.point.areaId === exemptAreaId) {
      result.push({ kind: 'pin', point: entry.point })
      continue
    }
    const members = [entry]
    for (const other of projected) {
      if (used.has(other.point.areaId) || other.point.areaId === exemptAreaId) continue
      const distance = Math.hypot(other.x - entry.x, other.y - entry.y)
      if (distance <= PIN_CLUSTER_THRESHOLD_PX) {
        used.add(other.point.areaId)
        members.push(other)
      }
    }
    if (members.length === 1) {
      result.push({ kind: 'pin', point: entry.point })
    } else {
      const memberPoints = members.map((member) => member.point)
      result.push({
        kind: 'cluster',
        points: memberPoints,
        lat: memberPoints.reduce((sum, point) => sum + point.lat, 0) / memberPoints.length,
        lng: memberPoints.reduce((sum, point) => sum + point.lng, 0) / memberPoints.length,
        totalQuests: memberPoints.reduce((sum, point) => sum + point.questCount, 0),
      })
    }
  }
  return result
}
