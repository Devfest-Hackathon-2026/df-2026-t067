import { describe, expect, it } from 'vitest'
import { REGIONS } from './areaHierarchy'
import { boundsForFilter, PREFECTURE_BOUNDS } from './prefectureBounds'

describe('static filter bounds', () => {
  it('covers all 47 prefectures with valid bounds', () => {
    expect(Object.keys(PREFECTURE_BOUNDS)).toHaveLength(47)
    for (const region of REGIONS) for (const name of region.prefectures) {
      const b = PREFECTURE_BOUNDS[name]
      expect(b.south).toBeLessThan(b.north)
      expect(b.west).toBeLessThan(b.east)
    }
  })
  it('unions every prefecture in a region, independently of catalog pins', () => {
    const bounds = boundsForFilter('東北', '')!
    for (const name of REGIONS[1].prefectures) {
      const b = PREFECTURE_BOUNDS[name]
      expect(bounds.south).toBeLessThanOrEqual(b.south)
      expect(bounds.north).toBeGreaterThanOrEqual(b.north)
      expect(bounds.west).toBeLessThanOrEqual(b.west)
      expect(bounds.east).toBeGreaterThanOrEqual(b.east)
    }
    expect(boundsForFilter('北海道', '北海道')).toEqual(PREFECTURE_BOUNDS['北海道'])
    expect(boundsForFilter('', '')).toBeUndefined()
  })

  it('merges bounds for multiple regions and prefectures', () => {
    const bounds = boundsForFilter(['関東', '北海道'], ['大阪府'])!
    const kanto = boundsForFilter('関東', '')!
    const hokkaido = PREFECTURE_BOUNDS['北海道']
    const osaka = PREFECTURE_BOUNDS['大阪府']
    expect(bounds.south).toBe(Math.min(kanto.south, hokkaido.south, osaka.south))
    expect(bounds.north).toBe(Math.max(kanto.north, hokkaido.north, osaka.north))
    expect(bounds.west).toBe(Math.min(kanto.west, hokkaido.west, osaka.west))
    expect(bounds.east).toBe(Math.max(kanto.east, hokkaido.east, osaka.east))
  })

  it('multi-select union covers every selected prefecture corner (map fit input)', () => {
    // #160: 複数選択時に地図が全範囲を収める入力になること。有料 Maps は使わず境界値だけ確かめる。
    const selectedPrefs = ['北海道', '東京都', '大阪府', '福岡県'] as const
    const bounds = boundsForFilter([], selectedPrefs)!
    for (const name of selectedPrefs) {
      const b = PREFECTURE_BOUNDS[name]
      expect(bounds.south).toBeLessThanOrEqual(b.south)
      expect(bounds.north).toBeGreaterThanOrEqual(b.north)
      expect(bounds.west).toBeLessThanOrEqual(b.west)
      expect(bounds.east).toBeGreaterThanOrEqual(b.east)
    }
    // 端の都道府県をまたぐので、単一の東京都より明らかに広い
    const tokyo = PREFECTURE_BOUNDS['東京都']
    expect(bounds.north - bounds.south).toBeGreaterThan(tokyo.north - tokyo.south)
    expect(bounds.east - bounds.west).toBeGreaterThan(tokyo.east - tokyo.west)

    // 地方の複数選択でも同様に OR 合併
    const regions = boundsForFilter(['北海道', '九州・沖縄'], [])!
    for (const name of [...REGIONS.find((r) => r.name === '北海道')!.prefectures, ...REGIONS.find((r) => r.name === '九州・沖縄')!.prefectures]) {
      const b = PREFECTURE_BOUNDS[name]
      expect(regions.south).toBeLessThanOrEqual(b.south)
      expect(regions.north).toBeGreaterThanOrEqual(b.north)
      expect(regions.west).toBeLessThanOrEqual(b.west)
      expect(regions.east).toBeGreaterThanOrEqual(b.east)
    }
  })
})
