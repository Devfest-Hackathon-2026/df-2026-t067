import { expect, it } from 'vitest'
import type { OrgMembership } from '../../shared/api'
import { sortMemberships } from './membershipOrder'

const member = (label: string, prefectureCode?: string, municipalityCode?: string): OrgMembership => ({
  orgId: label, areaId: 'test-area', role: 'editor', label, prefectureCode, municipalityCode,
})

it('orders memberships north to south without mutating the API page', () => {
  const items = [member('沖縄', '47'), member('東京', '13'), member('北海道', '01')]
  expect(sortMemberships(items).map(item => item.label)).toEqual(['北海道', '東京', '沖縄'])
  expect(items.map(item => item.label)).toEqual(['沖縄', '東京', '北海道'])
})

it('places memberships without a prefecture code last', () => {
  expect(sortMemberships([member('未設定'), member('沖縄', '47'), member('北海道', '01')]).map(item => item.label))
    .toEqual(['北海道', '沖縄', '未設定'])
})

it('breaks ties by municipality code, then label when codes are equal or missing', () => {
  expect(sortMemberships([
    member('未設定B'), member('B', '13', '13102'), member('コードなしB', '13'),
    member('先頭', '13', '13101'), member('A', '13', '13102'), member('コードなしA', '13'), member('未設定A'),
  ]).map(item => item.label)).toEqual(['先頭', 'A', 'B', 'コードなしA', 'コードなしB', '未設定A', '未設定B'])
})
