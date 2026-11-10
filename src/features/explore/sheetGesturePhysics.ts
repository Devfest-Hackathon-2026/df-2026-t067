export type SheetSnap = 'closed' | 'peek' | 'half' | 'full'

/** 端を超えたときのラバーバンド。距離の一部だけ動かす（Vaul/Motion の dragElastic ≈ 0.2 相当）。 */
export function rubberBand(overscroll: number, limit: number, constant = 0.55): number {
  if (limit <= 0) return 0
  const sign = overscroll < 0 ? -1 : 1
  const x = Math.abs(overscroll)
  return sign * ((1 - 1 / ((x * constant) / limit + 1)) * limit)
}

export function clampWithRubberBand(height: number, min: number, max: number, constant = 0.55): number {
  if (height < min) return min - rubberBand(min - height, Math.max(24, max - min), constant)
  if (height > max) return max + rubberBand(height - max, Math.max(24, max - min), constant)
  return height
}

export type SnapHeights = Record<SheetSnap, number>

/**
 * 離した瞬間の高さ＋縦速度からスナップ先を決める。
 * velocityY: 指の移動速度（px/ms）。上が正＝シートを開く方向（高さ増）。
 * 速いフリックは最寄りでなくても次の段へ進める（距離 OR 速度、gestures スキル）。
 */
export function pickSnapFromRelease(args: {
  height: number
  /** 上方向（シートを高くする）を正とする px/ms */
  velocityY: number
  heights: SnapHeights
  /** この速さを超えたら最寄りではなく進行方向の隣段を優先 */
  flingVelocity?: number
  reducedMotion?: boolean
}): SheetSnap {
  const { height, velocityY, heights, flingVelocity = 0.85, reducedMotion = false } = args
  const entries = (Object.entries(heights) as Array<[SheetSnap, number]>)
    .slice()
    .sort((a, b) => a[1] - b[1])

  const nearest = entries.reduce((best, entry) =>
    Math.abs(entry[1] - height) < Math.abs(best[1] - height) ? entry : best)

  if (reducedMotion || Math.abs(velocityY) < flingVelocity) return nearest[0]

  const opening = velocityY > 0
  if (opening) {
    const above = entries.find(([, h]) => h > height + 8)
    return above ? above[0] : nearest[0]
  }
  const below = [...entries].reverse().find(([, h]) => h < height - 8)
  return below ? below[0] : nearest[0]
}

/** 速度サンプルから px/ms を推定（直近2点）。上が正。 */
export function velocityFromSamples(samples: Array<{ y: number; t: number }>): number {
  if (samples.length < 2) return 0
  const a = samples[samples.length - 2]!
  const b = samples[samples.length - 1]!
  const dt = b.t - a.t
  if (dt <= 0) return 0
  // clientY 減＝指が上＝シートが高くなる
  return (a.y - b.y) / dt
}

/** リリース後の遷移時間（ms）。速いほど短く、reduced-motion は固定短尺。 */
export function releaseTransitionMs(velocityY: number, reducedMotion: boolean): number {
  if (reducedMotion) return 120
  const speed = Math.abs(velocityY)
  // 0 → 420ms、速いフリック → ~220ms（iOS/Vaul 系の「勢いを引き継ぐ」短縮）
  return Math.round(Math.max(220, Math.min(420, 420 - speed * 120)))
}
