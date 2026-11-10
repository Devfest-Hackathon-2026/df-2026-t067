import { describe, expect, it } from 'vitest'
import { initialPinShift, projectedAnchorY } from './initialPinShift'

const obstacles = [
  { left: 336, right: 380, bottom: 50 },
  { left: 12, right: 120, bottom: 112 },
  { left: 16, right: 117, bottom: 60 },
]

describe('initial pin adjustment', () => {
  it('fits Sapporo below the account and Naha above the sheet', () => {
    const shift = initialPinShift([{ x: 349, y: 92 }, { x: 40, y: 559 }], obstacles, 612)
    expect(shift).toBe(30)
    expect(92 + shift).toBeGreaterThanOrEqual(122)
    expect(559 + shift).toBeLessThanOrEqual(612)
  })

  it('uses the tallest overlapping obstacle including the full 52px pin width', () => {
    expect(initialPinShift([{ x: 130, y: 100 }], obstacles, 612)).toBe(84)
    expect(initialPinShift([{ x: 200, y: 50 }], obstacles, 612)).toBe(22)
    expect(initialPinShift([{ x: 200, y: 72 }], obstacles, 612)).toBe(0)
  })

  it('balances excess only when top and bottom constraints cannot both fit', () => {
    const shift = initialPinShift([{ x: 40, y: 92 }, { x: 40, y: 559 }], obstacles, 612)
    expect(184 - (92 + shift)).toBeCloseTo(559 + shift - 612)
    expect(shift).toBe(72.5)
  })

  it('keeps clear pins still and moves upward when the sheet covers a pin', () => {
    expect(initialPinShift([{ x: 40, y: 200 }, { x: 349, y: 600 }], obstacles, 612)).toBe(0)
    expect(initialPinShift([{ x: 40, y: 210 }, { x: 349, y: 630 }], obstacles, 612)).toBe(-18)
    expect(initialPinShift([], obstacles, 612)).toBe(0)
    expect(initialPinShift([{ x: NaN, y: 92 }], obstacles, 612)).toBe(0)
  })

  it('converts projected world coordinates to CSS pixels at the map zoom', () => {
    expect(projectedAnchorY(105, 100, 5)).toBe(160)
  })
})
