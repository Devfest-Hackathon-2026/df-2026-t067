import { describe, expect, it } from 'vitest'
import { isMapControlFullyCovered, isMapControlWithin, type ControlRect } from './mapControlVisibility'

const rect = (left: number, top: number, right: number, bottom: number): ControlRect => ({
  left, top, right, bottom, width: right - left, height: bottom - top,
})

describe('map control sheet visibility', () => {
  const sheet = rect(0, 400, 360, 700)

  it('disables partly covered controls as well', () => {
    expect(isMapControlFullyCovered(rect(300, 350, 344, 401), sheet)).toBe(true)
    expect(isMapControlFullyCovered(rect(300, 390, 344, 444), sheet)).toBe(true)
  })

  it('disables a button wholly behind the sheet', () => {
    expect(isMapControlFullyCovered(rect(300, 410, 344, 454), sheet)).toBe(true)
  })

  it('does not disable a button horizontally outside the sheet or touching its edge', () => {
    expect(isMapControlFullyCovered(rect(370, 410, 414, 454), sheet)).toBe(false)
    expect(isMapControlFullyCovered(rect(300, 356, 344, 400), sheet)).toBe(false)
  })

  it('requires the whole button to remain inside the visible map shell', () => {
    const visibleShell = rect(0, 100, 360, 700)
    expect(isMapControlWithin(rect(300, 650, 344, 694), visibleShell)).toBe(true)
    expect(isMapControlWithin(rect(300, 650, 344, 701), visibleShell)).toBe(false)
    expect(isMapControlWithin(rect(340, 150, 384, 194), visibleShell)).toBe(false)
  })
})
