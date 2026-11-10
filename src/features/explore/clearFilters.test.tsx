import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import type { PublicArea, PublicQuest } from '../../shared/api/types'
import { MapPreview } from './MapPreview'
import { ExploreQuestList } from './ExploreQuestList'

const areas: PublicArea[] = ['a', 'b'].map((id, index) => ({
  areaId: id, label: id, publishedCount: 1,
  marker: { latitude: 35, longitude: 130 + index * 10 },
  publicGeometry: { type: 'Polygon', coordinates: [[[130 + index * 10, 35], [131 + index * 10, 35], [131 + index * 10, 36], [130 + index * 10, 35]]] },
}))
const quests: PublicQuest[] = areas.map((area, index) => ({
  questId: `q${index}`, areaId: area.areaId, title: `謎${index}`, version: 1, clue: '謎', visitConditions: '', hintCount: 0,
}))
const clearedQuestIds = new Set(['q0'])

it.each([undefined, new Set<string>()])('クリア記録がなければチップを出さない: %s', (ids) => {
  render(<MapPreview areas={areas} quests={quests} clearedQuestIds={ids} />)
  expect(screen.queryByRole('group', { name: 'クリア状況' })).not.toBeInTheDocument()
  expect(screen.getByText('2件')).toBeVisible()
})

it('チップで一覧と件数を絞り、場所の絞り込みと併用し、消えた選択を解除する', () => {
  const onDeselectQuest = vi.fn()
  const props = { areas, quests, clearedQuestIds, onDeselectQuest, onOpenQuest: vi.fn(), selectedQuestId: 'q0' }
  const { rerender } = render(<MapPreview {...props} />)
  const group = screen.getByRole('group', { name: 'クリア状況' })
  expect(within(group).getByRole('button', { name: 'すべて' })).toHaveAttribute('aria-pressed', 'true')
  fireEvent.click(within(group).getByRole('button', { name: '未クリア' }))
  expect(screen.getByText('1件')).toBeVisible()
  expect(screen.queryByRole('button', { name: '謎0の詳細を見る' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '謎1の詳細を見る' })).toBeVisible()
  expect(onDeselectQuest).toHaveBeenCalled()
  fireEvent.click(within(group).getByRole('button', { name: 'クリア済み' }))
  expect(screen.getByRole('button', { name: '謎0の詳細を見る' })).toBeVisible()
  // 場所で絞る処理が App から渡す一覧を更新しても、クリア条件を維持する。
  rerender(<MapPreview {...props} quests={[quests[1]]} filterPrefecture="東京都" />)
  expect(screen.getByText('0件')).toBeVisible()
  expect(screen.getByText('該当なし')).toBeVisible()
  fireEvent.click(within(group).getByRole('button', { name: 'すべて' }))
  expect(screen.getByText('1件')).toBeVisible()
  expect(screen.getByRole('button', { name: '謎1の詳細を見る' })).toBeVisible()
  rerender(<MapPreview {...props} clearedQuestIds={new Set()} />)
  expect(screen.queryByRole('group', { name: 'クリア状況' })).not.toBeInTheDocument()
  expect(screen.getByText('2件')).toBeVisible()
})

it('行の左アイコンを出し分け、題名と2行目を同じラッパに置く', () => {
  const { container } = render(<ExploreQuestList areas={areas} quests={quests} clearedQuestIds={clearedQuestIds} />)
  const icons = container.querySelectorAll('.explore-row-icon')
  expect(icons).toHaveLength(2)
  expect(icons[0]).toHaveClass('is-cleared')
  expect(icons[1]).not.toHaveClass('is-cleared')
  for (const icon of icons) expect(icon).toHaveAttribute('aria-hidden', 'true')
  expect(icons[0].querySelector('path')).toHaveAttribute('d', 'M20 7 9.5 17.5 4.5 12.5')
  expect(icons[1].querySelectorAll('path')).toHaveLength(1)
  const pinCenter = icons[1].querySelector('circle')
  expect(pinCenter).toHaveAttribute('fill', '#ffffff')
  expect(Number(pinCenter?.getAttribute('r'))).toBeCloseTo(6.5 * 7 / 16, 1)
  for (const copy of container.querySelectorAll('.explore-row-copy')) {
    expect(copy.querySelector('.traveler-row-title')).not.toBeNull()
    expect(copy.querySelector('.traveler-row-secondary')).not.toBeNull()
  }
  expect(container.querySelector('.explore-quest-cleared')).toBeNull()
  expect(container.querySelector('.explore-row-copy .sr-only')).toHaveTextContent('クリア済み')
})

it('地図へ渡す地域と件数を絞り、通常ピンは青、クリアピンは緑にする', async () => {
  vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-key')
  vi.resetModules()
  const markers: Marker[] = []
  class Marker {
    options: Record<string, unknown>
    active = true
    listeners = new Map<string, () => void>()
    constructor(options: Record<string, unknown>) { this.options = options; markers.push(this) }
    setMap(value: unknown) { this.active = value !== null }
    setOptions(options: Record<string, unknown>) { this.options = options }
    setIcon(icon: unknown) { this.options.icon = icon }
    addListener(name: string, cb: () => void) { this.listeners.set(name, cb); return { remove() {} } }
  }
  class Data { setMap() {} addGeoJson() {} setStyle() {} addListener() { return { remove() {} } } forEach() {} remove() {} }
  window.google = { maps: {
    Map: class { setZoom() {} getZoom() { return 10 } setCenter() {} fitBounds() {} addListener() { return { remove() {} } } },
    Marker, Data, LatLngBounds: class { extend() {} }, event: { addListener: () => ({ remove() {} }) },
  } as never }
  try {
    const { MapPreview: ConfiguredMapPreview } = await import('./MapPreview')
    const { rerender, unmount } = render(<ConfiguredMapPreview areas={areas} quests={quests} clearedQuestIds={clearedQuestIds} />)
    const active = () => markers.filter(marker => marker.active)
    const svg = (marker: Marker) => decodeURIComponent((marker.options.icon as { url: string }).url)
    await waitFor(() => expect(active()).toHaveLength(2))
    expect(svg(active().find(marker => marker.options.title === 'a 1問')!)).toContain('fill="#c7ed93"')
    expect(svg(active().find(marker => marker.options.title === 'b 1問')!)).toContain('fill="#4eb8d0"')
    act(() => active().find(marker => marker.options.title === 'a 1問')!.listeners.get('mouseover')?.())
    expect(svg(active().find(marker => marker.options.title === 'a 1問')!)).toContain('fill="#c7ed93"')
    fireEvent.click(screen.getByRole('button', { name: '未クリア' }))
    await waitFor(() => expect(active().map(marker => marker.options.title)).toEqual(['b 1問']))
    fireEvent.click(screen.getByRole('button', { name: 'クリア済み' }))
    await waitFor(() => expect(active().map(marker => marker.options.title)).toEqual(['a 1問']))
    rerender(<ConfiguredMapPreview areas={areas} quests={[quests[1]]} clearedQuestIds={clearedQuestIds} />)
    await waitFor(() => expect(active()).toHaveLength(0))
    unmount()
  } finally { delete window.google }
})
