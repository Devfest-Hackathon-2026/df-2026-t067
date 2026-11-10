import { describe, expect, it } from 'vitest'
import { areaPinPosition, questThumbnail } from './viewportQuests'
import type { PublicArea, PublicQuest } from '../../shared/api/types'

const areaA: PublicArea = { areaId: 'area-a', label: 'A', publishedCount: 2, marker: { latitude: 35, longitude: 139 },
  publicGeometry: { type: 'Polygon', coordinates: [[[139, 35], [140, 35], [140, 36], [139, 36], [139, 35]]] } }
const areaB: PublicArea = { areaId: 'area-b', label: 'B', publishedCount: 1, marker: { latitude: 31, longitude: 130 },
  publicGeometry: { type: 'Polygon', coordinates: [[[130, 31], [131, 31], [131, 32], [130, 32], [130, 31]]] } }
const quest = (questId: string, areaId: string): PublicQuest => ({ questId, version: 1, title: questId, clue: 'clue', areaId, visitConditions: '', hintCount: 1 })

describe('areaPinPosition', () => {
  it('uses the outer ring centroid, not a quest location', () => {
    expect(areaPinPosition(areaA)).toEqual({ lat: 35.5, lng: 139.5 })
    expect(areaPinPosition(areaB)).toEqual({ lat: 31.5, lng: 130.5 })
  })
})

const areaMulti: PublicArea = { areaId: 'area-multi', label: 'M', publishedCount: 1, marker: { latitude: 35.68, longitude: 139.72 },
  publicGeometry: { type: 'MultiPolygon', coordinates: [
    [[[139.70, 35.65], [139.74, 35.65], [139.74, 35.70], [139.70, 35.70], [139.70, 35.65]]],
    [[[139.56, 35.53], [139.60, 35.53], [139.60, 35.58], [139.56, 35.58], [139.56, 35.53]]],
    [[[139.88, 35.78], [139.92, 35.78], [139.92, 35.82], [139.88, 35.82], [139.88, 35.78]]],
  ] } }

describe('MultiPolygon areas (like the Tokyo demo area)', () => {
  it('places the pin at the first polygon centroid, which lies inside the overall bounds', () => {
    const position = areaPinPosition(areaMulti)
    expect(position).toEqual({ lat: 35.675, lng: 139.72 })
    expect(position!.lat).toBeGreaterThanOrEqual(35.53)
    expect(position!.lat).toBeLessThanOrEqual(35.82)
    expect(position!.lng).toBeGreaterThanOrEqual(139.56)
    expect(position!.lng).toBeLessThanOrEqual(139.92)
  })
})

describe('questThumbnail', () => {
  it('prefers the optional hint image, then the first non-empty hint image', () => {
    expect(questThumbnail({ ...quest('q1', 'area-a'), optionalHintImage: 'https://example.test/a.jpg', hintImages: ['https://example.test/b.jpg'] }))
      .toBe('https://example.test/a.jpg')
    expect(questThumbnail({ ...quest('q1', 'area-a'), hintImages: [null, 'https://example.test/c.jpg'] })).toBe('https://example.test/c.jpg')
    expect(questThumbnail(quest('q1', 'area-a'))).toBeUndefined()
  })
})
