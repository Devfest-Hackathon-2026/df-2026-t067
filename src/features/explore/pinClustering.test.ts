import { describe, expect, it } from 'vitest'
import { arrangePins, worldPixel, type PinPoint } from './pinClustering'

const pin = (areaId: string, lat: number, lng: number, questCount = 1): PinPoint => ({ areaId, lat, lng, questCount })

describe('worldPixel', () => {
  it('doubles the pixel distance when the zoom increases by one', () => {
    const a5 = worldPixel(35, 139, 5)
    const b5 = worldPixel(35, 140, 5)
    const a6 = worldPixel(35, 139, 6)
    const b6 = worldPixel(35, 140, 6)
    expect(Math.abs(b6.x - a6.x)).toBeCloseTo(Math.abs(b5.x - a5.x) * 2, 6)
    expect(Math.abs(b5.y - a5.y)).toBe(0)
  })
})

describe('arrangePins', () => {
  it('keeps far-apart pins separate', () => {
    const result = arrangePins([pin('sapporo', 43.06, 141.35, 1), pin('naha', 26.21, 127.68, 1)], 5)
    expect(result).toEqual([
      { kind: 'pin', point: pin('sapporo', 43.06, 141.35, 1) },
      { kind: 'pin', point: pin('naha', 26.21, 127.68, 1) },
    ])
  })

  it('clusters pins that overlap at the current zoom and sums their quest counts', () => {
    // 東京と横浜はズーム5では数ピクセルしか離れていない。
    const result = arrangePins([
      pin('tokyo', 35.68, 139.77, 2),
      pin('yokohama', 35.44, 139.64, 3),
      pin('sapporo', 43.06, 141.35, 1),
    ], 5)
    expect(result).toHaveLength(2)
    const cluster = result[0]
    expect(cluster.kind).toBe('cluster')
    if (cluster.kind === 'cluster') {
      expect(cluster.points.map((point) => point.areaId)).toEqual(['tokyo', 'yokohama'])
      expect(cluster.totalQuests).toBe(5)
      expect(cluster.lat).toBeCloseTo((35.68 + 35.44) / 2, 6)
      expect(cluster.lng).toBeCloseTo((139.77 + 139.64) / 2, 6)
    }
    expect(result[1]).toEqual({ kind: 'pin', point: pin('sapporo', 43.06, 141.35, 1) })
  })

  it('splits the same pins apart when zoomed in', () => {
    const points = [pin('tokyo', 35.68, 139.77, 2), pin('yokohama', 35.44, 139.64, 3)]
    expect(arrangePins(points, 5).some((item) => item.kind === 'cluster')).toBe(true)
    expect(arrangePins(points, 11).every((item) => item.kind === 'pin')).toBe(true)
  })

  it('never hides the exempt (selected) pin inside a cluster', () => {
    const points = [pin('tokyo', 35.68, 139.77, 2), pin('yokohama', 35.44, 139.64, 3)]
    const result = arrangePins(points, 5, 'tokyo')
    expect(result).toEqual([
      { kind: 'pin', point: pin('tokyo', 35.68, 139.77, 2) },
      { kind: 'pin', point: pin('yokohama', 35.44, 139.64, 3) },
    ])
  })

  it('does not absorb the exempt pin into another cluster', () => {
    // 仙台の起点から郡山はクラスタに入る距離にあるが、選択中（exempt）の郡山は取り込まない。
    const result = arrangePins([
      pin('sendai', 38.27, 140.87, 1),
      pin('fukushima', 37.76, 140.47, 1),
      pin('koriyama', 37.40, 140.36, 1),
    ], 5, 'koriyama')
    const cluster = result.find((item) => item.kind === 'cluster')
    expect(cluster?.kind).toBe('cluster')
    if (cluster?.kind === 'cluster') expect(cluster.points.map((point) => point.areaId)).toEqual(['sendai', 'fukushima'])
    expect(result.some((item) => item.kind === 'pin' && item.point.areaId === 'koriyama')).toBe(true)
  })

  it('returns an empty list for no pins and a single pin for one point', () => {
    expect(arrangePins([], 5)).toEqual([])
    expect(arrangePins([pin('a', 35, 139)], 5)).toEqual([{ kind: 'pin', point: pin('a', 35, 139) }])
  })
})
