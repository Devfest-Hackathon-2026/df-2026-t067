import { expect, it } from 'vitest'
import { placeHoursCandidate } from './placeHoursCandidate'
const week = Array.from({ length: 7 }, (_, day) => ({ open: { day, hour: 9, minute: 30 }, close: { day, hour: 17, minute: 0 } }))
it('converts only a complete uniform week', () => {
  expect(placeHoursCandidate({ periods: week })).toBe('09:30〜17:00')
  expect(placeHoursCandidate({ periods: week.slice(1) })).toBeUndefined()
  expect(placeHoursCandidate({ periods: [...week.slice(1), week[1]] })).toBeUndefined()
  expect(placeHoursCandidate({ periods: week.map((p, i) => i ? p : { ...p, close: { ...p.close, hour: 18 } }) })).toBeUndefined()
  expect(placeHoursCandidate({ periods: [{ open: { day: 0, hour: 0, minute: 0 } }] })).toBeUndefined()
  expect(placeHoursCandidate(null)).toBeUndefined()
})
