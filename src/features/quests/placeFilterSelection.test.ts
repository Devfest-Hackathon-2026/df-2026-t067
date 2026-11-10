import { describe, expect, it } from 'vitest'
import { normalizePlaceSelection } from './placeFilterSelection'

describe('normalizePlaceSelection', () => {
  it.each([
    [[], []],
    [['東京都'], ['東京都']],
    [['東京都', '大阪府'], ['東京都']],
    [['不明', '大阪府'], ['大阪府']],
    [['関東', '不明'], []],
    [['東京都', '東京都'], ['東京都']],
  ])('県の旧状態 %j を単一選択 %j にする', (input, expected) => {
    expect(normalizePlaceSelection(input)).toEqual({ regions: [], prefectures: expected })
  })

  it('元の配列を変更しない', () => {
    const input = Object.freeze(['大阪府', '東京都'])
    expect(normalizePlaceSelection(input).prefectures).toEqual(['大阪府'])
    expect(input).toEqual(['大阪府', '東京都'])
  })
})
