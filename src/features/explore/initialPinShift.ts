// Maps のワールド座標を、地図上端からのCSSピクセルへ変換する。
export function projectedAnchorY(worldY: number, northWorldY: number, zoom: number): number {
  return (worldY - northWorldY) * 2 ** zoom
}

export interface PinAnchor { x: number; y: number }
export interface PinObstacle { left: number; right: number; bottom: number }

// 正値はピンを下へ動かす量。両端を収められなければ超過を上下へ等分する。
export function initialPinShift(anchors: PinAnchor[], obstacles: PinObstacle[], bottom: number): number {
  if (!anchors.length || ![
    bottom, ...anchors.flatMap(({ x, y }) => [x, y]),
    ...obstacles.flatMap(({ left, right, bottom }) => [left, right, bottom]),
  ].every(Number.isFinite)) return 0
  const lower = Math.max(...anchors.map(({ x, y }) => {
    const obstacleBottom = Math.max(0, ...obstacles
      .filter(({ left, right }) => x + 26 > left && x - 26 < right)
      .map(({ bottom }) => bottom))
    return obstacleBottom + 60 + 12 - y
  }))
  const upper = bottom - Math.max(...anchors.map(({ y }) => y))
  if (lower > upper) return (lower + upper) / 2
  return Math.max(lower, Math.min(0, upper))
}
