import { describe, expect, it } from 'vitest'
import {
  clampWithRubberBand,
  pickSnapFromRelease,
  releaseTransitionMs,
  rubberBand,
  velocityFromSamples,
} from './sheetGesturePhysics'

const heights = { closed: 34, peek: 168, half: 352, full: 556 }

describe('sheetGesturePhysics', () => {
  it('rubber-bands past edges instead of hard-stopping', () => {
    expect(rubberBand(100, 200)).toBeGreaterThan(0)
    expect(rubberBand(100, 200)).toBeLessThan(100)
    expect(clampWithRubberBand(10, 34, 556)).toBeLessThan(34)
    expect(clampWithRubberBand(10, 34, 556)).toBeGreaterThan(0)
    expect(clampWithRubberBand(700, 34, 556)).toBeGreaterThan(556)
    expect(clampWithRubberBand(700, 34, 556)).toBeLessThan(700)
    expect(clampWithRubberBand(200, 34, 556)).toBe(200)
  })

  it('picks the nearest snap when motion is slow', () => {
    expect(pickSnapFromRelease({ height: 200, velocityY: 0.1, heights })).toBe('peek')
    expect(pickSnapFromRelease({ height: 300, velocityY: 0, heights })).toBe('half')
    expect(pickSnapFromRelease({ height: 500, velocityY: -0.2, heights })).toBe('full')
  })

  it('advances in the fling direction when velocity is high', () => {
    // peek 付近でも上フリックなら half へ
    expect(pickSnapFromRelease({ height: 180, velocityY: 1.5, heights })).toBe('half')
    // half 付近で下フリックなら peek へ
    expect(pickSnapFromRelease({ height: 340, velocityY: -1.5, heights })).toBe('peek')
  })

  it('ignores fling under reduced motion and settles to nearest', () => {
    expect(pickSnapFromRelease({ height: 180, velocityY: 2, heights, reducedMotion: true })).toBe('peek')
  })

  it('derives velocity from samples (up is positive)', () => {
    expect(velocityFromSamples([{ y: 300, t: 0 }, { y: 200, t: 100 }])).toBeCloseTo(1, 5)
    expect(velocityFromSamples([{ y: 200, t: 0 }, { y: 300, t: 100 }])).toBeCloseTo(-1, 5)
    expect(velocityFromSamples([])).toBe(0)
  })

  it('shortens release transition for fast flicks and reduced motion', () => {
    expect(releaseTransitionMs(0, false)).toBe(420)
    expect(releaseTransitionMs(2, false)).toBeLessThan(420)
    expect(releaseTransitionMs(2, true)).toBe(120)
  })
})
