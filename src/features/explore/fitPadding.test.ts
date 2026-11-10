import { describe, expect, it } from 'vitest'
import { visibleAreaFitPadding } from './fitPadding'

describe('visibleAreaFitPadding', () => {
  it('reserves the mobile filter bottom and the pin height on the initial fit', () => {
    // 390x844: フィルター下端112px + ピン60px + 間隔12px。
    expect(visibleAreaFitPadding(false).top).toBe(184)
    expect(visibleAreaFitPadding(false, false, undefined, 64).top).toBe(184)
    expect(visibleAreaFitPadding(false, false, undefined, 140).top).toBe(200)
  })

  it('preserves desktop padding and selected half-sheet clearance', () => {
    expect(visibleAreaFitPadding(true)).toEqual({ top: 88, right: 48, bottom: 48, left: 292 })
    expect(visibleAreaFitPadding(true, true)).toEqual({ top: 88, right: 48, bottom: 48, left: 68 })
    expect(visibleAreaFitPadding(false, false, 464).bottom).toBe(548)
  })
})
