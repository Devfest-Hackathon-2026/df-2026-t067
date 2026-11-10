import { describe, expect, it } from 'vitest'
import { mapControlsPlacement } from './mapOverlayLayout'
import { visibleAreaFitPadding } from './fitPadding'

describe('mobile map overlay clearance', () => {
  // シートへの追従はバグのため、peekの位置に固定して重なりは別途判定する。
  it('keeps the same bottom at peek, half and full', () => {
    for (const sheetTop of [612, 351, 84]) {
      expect(mapControlsPlacement(844, sheetTop, 194, 110)).toEqual({ bottom: 244, hidden: false })
    }
  })
  it('preserves bottom clearance for the sheet and navigation', () => {
    expect(visibleAreaFitPadding(false).bottom).toBe(252)
    expect(visibleAreaFitPadding(false, false, 429).bottom).toBe(513)
    expect(visibleAreaFitPadding(false, false, 168, 0).top).toBe(184)
  })
  it('accounts for a taller header and marker height in mobile fits', () => {
    expect(visibleAreaFitPadding(false, false, 168, 120).top).toBeGreaterThanOrEqual(180)
    expect(visibleAreaFitPadding(true, false, 168, 120).top).toBe(88)
  })
})
