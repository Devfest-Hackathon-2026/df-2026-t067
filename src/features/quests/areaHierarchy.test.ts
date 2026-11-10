import { describe, expect, it } from 'vitest'
import type { PublicArea } from '../../shared/api/types'
import { getRegionAreas, prefectureForArea, regionForPrefecture } from './areaHierarchy'

const area = (areaId: string, label: string, prefectureCode?: string): PublicArea & { prefectureCode?: string } => ({ areaId, label, prefectureCode,
  publicGeometry: { type: 'Polygon', coordinates: [] }, marker: { latitude: 0, longitude: 0 }, publishedCount: 1 })

describe('exploration area hierarchy', () => {
  it('uses the code even when the name suggests a different prefecture', () => {
    expect(prefectureForArea(area('a', '神奈川県の探索地域', '13'))).toBe('東京都')
    expect(prefectureForArea(area('b', '東京都千代田区'))).toBeUndefined()
    expect(prefectureForArea(area('c', '東京都', '48'))).toBeUndefined()
    expect(prefectureForArea(area('d', '島の探索地域', '47'))).toBe('沖縄県')
    expect(regionForPrefecture('東京都')).toBe('関東')
  })

  it('shows unclassified areas only in the unfiltered list and filters classified areas by prefecture', () => {
    const areas = [area('tokyo', '川辺エリア', '13'), area('osaka', '森エリア', '27'), area('unknown', '川辺エリア')]
    expect(getRegionAreas(areas, '', '')).toEqual(areas)
    expect(getRegionAreas(areas, '関東', '東京都').map((item) => item.areaId)).toEqual(['tokyo'])
    // 未分類という分類は無い（D-33）: コードの無い地域はどの地方にも属さない。
    for (const region of ['北海道', '東北', '関東', '中部', '近畿', '中国', '四国', '九州・沖縄']) {
      expect(getRegionAreas(areas, region, '').map((item) => item.areaId)).not.toContain('unknown')
    }
  })

  it('keeps areas that match any selected region or prefecture (OR)', () => {
    const areas = [area('tokyo', '川辺エリア', '13'), area('hokkaido', '北のエリア', '01'), area('osaka', '森エリア', '27')]
    expect(getRegionAreas(areas, ['関東', '北海道'], []).map((item) => item.areaId).sort()).toEqual(['hokkaido', 'tokyo'])
    expect(getRegionAreas(areas, [], ['東京都', '北海道']).map((item) => item.areaId).sort()).toEqual(['hokkaido', 'tokyo'])
    expect(getRegionAreas(areas, ['関東'], ['北海道']).map((item) => item.areaId).sort()).toEqual(['hokkaido', 'tokyo'])
  })
})
