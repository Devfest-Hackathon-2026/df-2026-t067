import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { QuestDetails } from '../quests/QuestDetails'
import { ExploreQuestList } from './ExploreQuestList'
import type { PublicArea, PublicQuest } from '../../shared/api/types'

const areas: PublicArea[] = [
  { areaId: 'area-a', label: '横浜', publishedCount: 2, marker: { latitude: 35, longitude: 139 },
    publicGeometry: { type: 'Polygon', coordinates: [[[139, 35], [140, 35], [140, 36], [139, 36], [139, 35]]] } },
  { areaId: 'area-b', label: '福岡', publishedCount: 1, marker: { latitude: 33, longitude: 130 },
    publicGeometry: { type: 'Polygon', coordinates: [[[130, 33], [131, 33], [131, 34], [130, 34], [130, 33]]] } },
]
const quests: PublicQuest[] = [
  { questId: 'q1', version: 1, title: '港の時計台', clue: '大きな時計が見える場所', areaId: 'area-a', visitConditions: '', hintCount: 3, hintImages: [null, 'https://example.test/hint.jpg'] },
  { questId: 'q2', version: 1, title: '博多の灯台', clue: '海に突き出た灯台', areaId: 'area-b', visitConditions: '', hintCount: 2 },
]

describe('ExploreQuestList', () => {
  it('shows the quest number on the card only when one is assigned', () => {
    const numbered: PublicQuest[] = [{ ...quests[0], questNumber: '14-01' }, quests[1]]
    render(<ExploreQuestList areas={areas} quests={numbered} onOpenQuest={() => {}} />)
    expect(screen.getByText('横浜 · No. 14-01')).toHaveClass('traveler-row-meta')
    expect(screen.getByRole('button', { name: '港の時計台の詳細を見る' })).toHaveClass('traveler-list-row')
    expect(screen.getByText('港の時計台')).toHaveClass('traveler-row-title')
    expect(screen.queryByText(/No\. 40-/)).not.toBeInTheDocument()
  })
  it('opens and closes from title, metadata and the row button', async () => {
    const user = userEvent.setup()
    const open = vi.fn()
    const props = { areas, quests: [{ ...quests[0], questNumber: '14-01' }], onOpenQuest: open, detailContent: <h3>詳細本文</h3> }
    const { rerender } = render(<ExploreQuestList {...props} />)
    const row = screen.getByRole('button', { name: '港の時計台の詳細を見る' })
    expect(row.children).toHaveLength(2)
    expect(row.querySelectorAll('button')).toHaveLength(0)
    await user.click(screen.getByText('横浜 · No. 14-01'))
    expect(open).toHaveBeenCalledWith('q1')
    rerender(<ExploreQuestList {...props} selectedQuestId="q1" />)
    expect(row).toHaveAttribute('aria-expanded', 'true')
    await user.click(screen.getByText('港の時計台'))
    expect(row).toHaveAttribute('aria-expanded', 'false')
    await user.click(row)
    expect(row).toHaveAttribute('aria-expanded', 'true')
  })
  it('renders title and area metadata without clue or thumbnail', () => {
    render(<ExploreQuestList areas={areas} quests={quests} onOpenQuest={() => {}} />)
    expect(screen.getByRole('region', { name: '選べる謎の一覧' })).toBeVisible()
    expect(screen.queryByRole('heading', { name: 'この範囲の謎' })).not.toBeInTheDocument()
    expect(screen.getByText('2件')).toBeVisible()
    expect(screen.getByText('港の時計台')).toBeVisible()
    // 地域名は2行目。本文の抜粋・写真は追加しない。
    expect(screen.getByText('横浜')).toHaveClass('traveler-row-meta')
    expect(screen.queryByText('大きな時計が見える場所')).not.toBeInTheDocument()
    expect(screen.queryByText('ピンは地域の代表点です。問題の場所そのものではありません。')).not.toBeInTheDocument()
    const card = screen.getByRole('button', { name: '港の時計台の詳細を見る' }).closest('.explore-quest-card')
    expect(card?.querySelector('img')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '博多の灯台の詳細を見る' }).querySelector('img')).not.toBeInTheDocument()
  })

  it('opens the detail under the selected row as an accordion and toggles it from the row', async () => {
    const user = userEvent.setup()
    const onOpenQuest = vi.fn()
    const detail = <div><h3>港の時計台の詳細</h3></div>
    render(<ExploreQuestList areas={areas} quests={quests} selectedQuestId="q1" onOpenQuest={onOpenQuest} detailContent={detail} />)
    const row = screen.getByRole('button', { name: '港の時計台の詳細を見る' })
    expect(row).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: '博多の灯台の詳細を見る' })).toHaveAttribute('aria-expanded', 'false')
    // 詳細は選択中の行の直下（同じ li の中）にだけ出る。
    const detailElement = screen.getByRole('heading', { name: '港の時計台の詳細' })
    expect(row.closest('li')).toContainElement(detailElement)
    expect(screen.getByRole('button', { name: '博多の灯台の詳細を見る' }).closest('li')).not.toContainElement(detailElement)
    // 選択中の行をもう一度押すと、選択は変えずに閉じる（onOpenQuest は呼ばない）。
    // 閉じる間は高さアニメーションのため内容が残り、終わると外れる（D-59）。
    await user.click(row)
    expect(onOpenQuest).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByRole('heading', { name: '港の時計台の詳細' })).not.toBeInTheDocument())
    expect(row).toHaveAttribute('aria-expanded', 'false')
    // もう一度押すと開き直す。
    await user.click(row)
    expect(onOpenQuest).not.toHaveBeenCalled()
    expect(screen.getByRole('heading', { name: '港の時計台の詳細' })).toBeVisible()
    // 別の行は従来どおり選択として伝える。
    await user.click(screen.getByRole('button', { name: '博多の灯台の詳細を見る' }))
    expect(onOpenQuest).toHaveBeenCalledWith('q2')
  })

  it('opens the quest detail from a card', async () => {
    const user = userEvent.setup()
    const onOpenQuest = vi.fn()
    render(<ExploreQuestList areas={areas} quests={quests} onOpenQuest={onOpenQuest} />)
    await user.click(screen.getByRole('button', { name: '博多の灯台の詳細を見る' }))
    expect(onOpenQuest).toHaveBeenCalledWith('q2')
  })

  it('shows a cleared badge only for quests the owner already cleared', () => {
    render(<ExploreQuestList areas={areas} quests={quests} clearedQuestIds={new Set(['q1'])} onOpenQuest={() => {}} />)
    const clearedCard = screen.getByRole('button', { name: '港の時計台の詳細を見る' })
    expect(clearedCard).toHaveTextContent('クリア済み')
    expect(screen.getByRole('button', { name: '博多の灯台の詳細を見る' })).not.toHaveTextContent('クリア済み')
  })

  it('marks the selected quest card as pressed', () => {
    render(<ExploreQuestList areas={areas} quests={quests} selectedQuestId="q2" onOpenQuest={() => {}} />)
    expect(screen.getByRole('button', { name: '博多の灯台の詳細を見る' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '港の時計台の詳細を見る' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('shows a condition-based empty message when no quests match', () => {
    render(<ExploreQuestList areas={areas} quests={[]} />)
    expect(screen.getByText('該当なし')).toBeVisible()
    expect(screen.getByText('0件')).toBeVisible()
  })

  it('highlights the pinned area quests without rendering a summary bar', () => {
    const { container } = render(<ExploreQuestList areas={areas} quests={quests} highlightArea={areas[0]} onOpenQuest={() => {}} />)
    const highlighted = screen.getByRole('button', { name: '港の時計台の詳細を見る' }).closest('li')
    expect(highlighted).toHaveClass('is-highlighted')
    expect(screen.getByRole('button', { name: '博多の灯台の詳細を見る' }).closest('li')).not.toHaveClass('is-highlighted')
    // 選択中地域のサマリバー（地域名＋問数＋閉じる）は出さない（D-45）。
    expect(container.querySelector('.explore-list-focus')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '閉じる' })).not.toBeInTheDocument()
  })

  it('puts the pinned area quests first so they lead the list without scrolling', () => {
    render(<ExploreQuestList areas={areas} quests={quests} highlightArea={areas[1]} onOpenQuest={() => {}} />)
    const cards = screen.getAllByRole('button', { name: /の詳細を見る/ })
    expect(cards[0]).toHaveAccessibleName('博多の灯台の詳細を見る')
    expect(cards[1]).toHaveAccessibleName('港の時計台の詳細を見る')
  })

  it('renders the list without a heading when the map is unavailable', () => {
    render(<ExploreQuestList areas={areas} quests={quests} />)
    expect(screen.getByRole('region', { name: '選べる謎の一覧' })).toBeVisible()
    expect(screen.queryByRole('heading', { name: 'すべての地域の謎' })).not.toBeInTheDocument()
    expect(screen.getByText('2件')).toBeVisible()
    expect(screen.getByText('博多の灯台')).toBeVisible()
  })

  it('画像読込中は「0件」も空メッセージも出さず、行の場所を確保する（D-54）', () => {
    const { container } = render(<ExploreQuestList areas={areas} quests={[]} loading />)
    expect(screen.getByText('読み込み中')).toBeVisible()
    expect(screen.queryByText('0件')).not.toBeInTheDocument()
    expect(screen.queryByText(/該当なし/)).not.toBeInTheDocument()
    expect(container.querySelectorAll('.explore-quest-skeleton')).toHaveLength(5)
  })

  it('再取得中に行があれば「画像読込中」に切り替えず、件数と行を残す（D-75）', () => {
    const { container } = render(<ExploreQuestList areas={areas} quests={quests} loading />)
    expect(screen.getByText('2件')).toBeVisible()
    expect(screen.queryByText('画像読込中')).not.toBeInTheDocument()
    expect(screen.getByText('港の時計台')).toBeVisible()
    expect(screen.getByText('博多の灯台')).toBeVisible()
    expect(container.querySelectorAll('.explore-quest-skeleton')).toHaveLength(0)
  })

  it('読み込み完了後に0件なら空メッセージを出す（D-54）', () => {
    render(<ExploreQuestList areas={areas} quests={[]} />)
    expect(screen.getByText('0件')).toBeVisible()
    expect(screen.getByText(/該当なし/)).toBeVisible()
  })

  it('選択中の行の再タップは、解除の受け口があれば選択解除を呼ぶ（D-55）', async () => {
    const user = userEvent.setup()
    const onOpenQuest = vi.fn()
    const onDeselectQuest = vi.fn()
    render(<ExploreQuestList areas={areas} quests={quests} selectedQuestId="q1"
      detailContent={<div>詳細コンテンツ</div>} onOpenQuest={onOpenQuest} onDeselectQuest={onDeselectQuest} />)
    expect(screen.getByText('詳細コンテンツ')).toBeVisible()
    await user.click(screen.getByRole('button', { name: '港の時計台の詳細を見る' }))
    expect(onDeselectQuest).toHaveBeenCalledTimes(1)
    expect(onOpenQuest).not.toHaveBeenCalled()
  })

  it('開閉の枠は全行に常時マウントされ、選択では開状態のクラスだけが切り替わる（D-59追記）', async () => {
    const detail = <div><h3>港の時計台の詳細</h3></div>
    const { container, rerender } = render(<ExploreQuestList areas={areas} quests={quests} onOpenQuest={() => {}} detailContent={detail} />)
    // 未選択でも全行に枠があり、開いている行は無い。枠が常駐していることで、
    // 閉じた高さ（0fr）が確定した状態からクラス切り替えで遷移が始められる。
    const wraps = container.querySelectorAll('.explore-quest-detail-wrap')
    expect(wraps).toHaveLength(quests.length)
    expect(container.querySelector('.explore-quest-detail-wrap.is-open')).not.toBeInTheDocument()
    const firstWrap = wraps[0]
    // 選択されると、枠の要素自体は差し替わらず、対象の行の枠に is-open が付くだけ。
    rerender(<ExploreQuestList areas={areas} quests={quests} selectedQuestId="q1" onOpenQuest={() => {}} detailContent={detail} />)
    expect(container.querySelectorAll('.explore-quest-detail-wrap')[0]).toBe(firstWrap)
    expect(firstWrap).toHaveClass('is-open')
    expect(container.querySelectorAll('.explore-quest-detail-wrap')[1]).not.toHaveClass('is-open')
    expect(firstWrap.querySelector('h3')).not.toBeNull()
    // 選択を外すと is-open が外れ、閉じ終わるまで内容は枠の中に残ってから外れる。
    rerender(<ExploreQuestList areas={areas} quests={quests} selectedQuestId="" onOpenQuest={() => {}} detailContent={detail} />)
    expect(firstWrap).not.toHaveClass('is-open')
    expect(firstWrap.querySelector('h3')).not.toBeNull()
    await waitFor(() => expect(firstWrap.querySelector('h3')).toBeNull())
  })

  it('選択中の行の再タップは、解除の受け口が無ければアコーディオンを閉じるだけにする', async () => {
    const user = userEvent.setup()
    const onOpenQuest = vi.fn()
    render(<ExploreQuestList areas={areas} quests={quests} selectedQuestId="q1"
      detailContent={<div>詳細コンテンツ</div>} onOpenQuest={onOpenQuest} />)
    expect(screen.getByText('詳細コンテンツ')).toBeVisible()
    await user.click(screen.getByRole('button', { name: '港の時計台の詳細を見る' }))
    // 閉じるアニメーション（D-59）が終わると内容は外れる。
    await waitFor(() => expect(screen.queryByText('詳細コンテンツ')).not.toBeInTheDocument())
    expect(onOpenQuest).not.toHaveBeenCalled()
  })
})

it.each([false, true])('scrolls the opened lower row to the top (reduced motion: %s)', (reduced) => {
  vi.stubGlobal('matchMedia', () => ({ matches: reduced }))
  const scroll = vi.fn()
  const original = HTMLElement.prototype.scrollIntoView
  HTMLElement.prototype.scrollIntoView = scroll
  const { rerender } = render(<ExploreQuestList areas={areas} quests={quests} onOpenQuest={vi.fn()} />)
  rerender(<ExploreQuestList areas={areas} quests={quests} selectedQuestId="q2" onOpenQuest={vi.fn()} detailContent={<h3>説明</h3>} />)
  expect(scroll).toHaveBeenCalledWith({ block: 'start', behavior: reduced ? 'instant' : 'smooth' })
  const row = screen.getByRole('button', { name: '博多の灯台の詳細を見る' }).closest('li')!
  expect(scroll.mock.instances.at(-1)).toBe(row)
  scroll.mockClear()
  fireEvent.transitionEnd(row.querySelector('.explore-quest-detail-wrap')!)
  expect(scroll).toHaveBeenCalledWith({ block: 'start', behavior: reduced ? 'instant' : 'smooth' })
  HTMLElement.prototype.scrollIntoView = original
  vi.unstubAllGlobals()
})

it.each(['row', 'Escape'])('closes the explanation with %s and returns focus to its row', async (method) => {
  const user = userEvent.setup()
  render(<ExploreQuestList areas={areas} quests={quests} selectedQuestId="q2" onOpenQuest={vi.fn()} detailContent={<h3>説明</h3>} />)
  expect(screen.queryByRole('button', { name: '説明を閉じる' })).not.toBeInTheDocument()
  const close = screen.getByRole('button', { name: '博多の灯台の詳細を見る' })
  close.focus()
  if (method === 'row') await user.click(close)
  else await user.keyboard('{Escape}')
  expect(screen.getByRole('button', { name: '博多の灯台の詳細を見る' })).toHaveFocus()
  expect(screen.getByRole('button', { name: '博多の灯台の詳細を見る' })).toHaveAttribute('aria-expanded', 'false')
})

it.each(['explore-side-panel', 'explore-sheet-body'])('aligns a scrolled row within %s and clears sticky filters', (className) => {
  const { container, rerender } = render(<div className={className}><div className="side-panel-filters">場所</div><ExploreQuestList areas={areas} quests={quests} onOpenQuest={vi.fn()} /></div>)
  const scroller = container.firstElementChild as HTMLElement
  scroller.scrollTop = 96
  const scrollTo = vi.fn()
  scroller.scrollTo = scrollTo
  vi.spyOn(scroller, 'getBoundingClientRect').mockReturnValue(DOMRect.fromRect({ y: 100 }))
  vi.spyOn(scroller.querySelector('.side-panel-filters')!, 'getBoundingClientRect').mockReturnValue(DOMRect.fromRect({ height: 64 }))
  const row = screen.getByRole('button', { name: '博多の灯台の詳細を見る' }).closest('li')!
  vi.spyOn(row, 'getBoundingClientRect').mockReturnValue(DOMRect.fromRect({ y: 500 }))
  rerender(<div className={className}><div className="side-panel-filters">場所</div><ExploreQuestList areas={areas} quests={quests} selectedQuestId="q2" onOpenQuest={vi.fn()} detailContent={<h3>説明</h3>} /></div>)
  expect(scrollTo).toHaveBeenCalledWith({ top: className === 'explore-side-panel' ? 432 : 496, behavior: 'smooth' })
})

it('開いたクリア済み行は読み上げと記録への導線を保つ', async () => {
  const onOpenDiscovery = vi.fn()
  const onStart = vi.fn()
  const { container } = render(<ExploreQuestList areas={areas} quests={quests} selectedQuestId="q1"
    clearedQuestIds={new Set(['q1'])} onOpenQuest={vi.fn()}
    detailContent={<QuestDetails quest={quests[0]} areaLabel="横浜" open hideToggle disabled={false}
      buttonLabel="挑戦する" onToggle={vi.fn()} onStart={onStart}
      clearedDiscoveryId="record-1" onOpenDiscovery={onOpenDiscovery} />} />)
  expect(screen.getAllByText('クリア済み')).toHaveLength(1)
  expect(container.querySelector('.explore-quest-cleared')).toBeNull()
  expect(container.querySelector('.traveler-list-row')).toHaveAccessibleDescription('クリア済み')
  expect(screen.queryByRole('button', { name: '挑戦する' })).not.toBeInTheDocument()
  await userEvent.setup().click(screen.getByRole('button', { name: '記録を見る' }))
  expect(onOpenDiscovery).toHaveBeenCalledExactlyOnceWith('record-1')
  expect(onStart).not.toHaveBeenCalled()
})
