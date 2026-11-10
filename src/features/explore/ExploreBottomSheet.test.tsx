import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ExploreBottomSheet, SHEET_PEEK_HEIGHT } from './ExploreBottomSheet'

// jsdomでは親の高さが測れないため、段階の高さは代替値（ステージ640px想定:
// peek 168 / half 352 / full 556）で決まる。
describe('ExploreBottomSheet', () => {
  it('starts at the peek snap showing the toggle as collapsed', () => {
    const onHeightChange = vi.fn()
    const { container } = render(<ExploreBottomSheet onHeightChange={onHeightChange}><p>リスト本文</p></ExploreBottomSheet>)
    const sheet = container.querySelector('.explore-sheet')
    expect(sheet).toHaveAttribute('data-snap', 'peek')
    expect((sheet as HTMLElement).style.height).toBe('168px')
    expect(screen.getByRole('button', { name: '謎リストを広げる' })).toHaveAttribute('aria-expanded', 'false')
    expect(container.querySelector('.explore-sheet-reopen')).toBeNull()
    expect(screen.queryByRole('button', { name: '問題を見る' })).not.toBeInTheDocument()
    expect(screen.getByText('リスト本文')).toBeVisible()
    expect(onHeightChange).toHaveBeenLastCalledWith(168)
  })

  it('opens from peek and toggles half and full without closing by tap', async () => {
    const user = userEvent.setup()
    const { container } = render(<ExploreBottomSheet><p>リスト本文</p></ExploreBottomSheet>)
    const sheet = container.querySelector('.explore-sheet')
    await user.click(screen.getByRole('button', { name: '謎リストを広げる' }))
    expect(sheet).toHaveAttribute('data-snap', 'half')
    await user.click(screen.getByRole('button', { name: '謎リストを広げる' }))
    expect(sheet).toHaveAttribute('data-snap', 'full')
    await user.click(screen.getByRole('button', { name: '謎リストをたたむ' }))
    expect(sheet).toHaveAttribute('data-snap', 'half')
  })

  it('drags the handle and snaps to the nearest stage without toggling', () => {
    const { container } = render(<ExploreBottomSheet><p>リスト本文</p></ExploreBottomSheet>)
    const sheet = container.querySelector('.explore-sheet') as HTMLElement
    const handle = screen.getByRole('button', { name: '謎リストを広げる' })
    fireEvent.pointerDown(handle, { pointerId: 1, pointerType: 'touch', clientY: 300 })
    fireEvent.pointerMove(handle, { pointerId: 1, pointerType: 'touch', clientY: 100 })
    expect(sheet.style.height).toBe('368px')
    expect(sheet).toHaveClass('is-dragging')
    fireEvent.pointerUp(handle, { pointerId: 1, pointerType: 'touch', clientY: 100 })
    expect(sheet).toHaveAttribute('data-snap', 'half')
    expect(sheet.style.height).toBe('352px')
    // ドラッグ後のクリックで開閉が反転しないこと。
    fireEvent.click(handle)
    expect(sheet).toHaveAttribute('data-snap', 'half')
  })

  it('snaps to full when dragged close to the top', () => {
    const { container } = render(<ExploreBottomSheet><p>リスト本文</p></ExploreBottomSheet>)
    const sheet = container.querySelector('.explore-sheet') as HTMLElement
    const handle = screen.getByRole('button', { name: '謎リストを広げる' })
    fireEvent.pointerDown(handle, { pointerId: 2, pointerType: 'touch', clientY: 560 })
    fireEvent.pointerMove(handle, { pointerId: 2, pointerType: 'touch', clientY: 160 })
    fireEvent.pointerUp(handle, { pointerId: 2, pointerType: 'touch', clientY: 160 })
    expect(sheet).toHaveAttribute('data-snap', 'full')
    expect(sheet.style.height).toBe('556px')
  })

  it('keeps the handle visible when closed and reopens by tapping or dragging it', async () => {
    const user = userEvent.setup()
    const { container } = render(<ExploreBottomSheet><p>リスト本文</p></ExploreBottomSheet>)
    const sheet = container.querySelector('.explore-sheet')
    const handle = screen.getByRole('button', { name: '謎リストを広げる' })
    fireEvent.pointerDown(handle, { pointerId: 3, pointerType: 'touch', clientY: 200 })
    fireEvent.pointerMove(handle, { pointerId: 3, pointerType: 'touch', clientY: 400 })
    fireEvent.pointerUp(handle, { pointerId: 3, pointerType: 'touch', clientY: 400 })
    expect(sheet).toHaveAttribute('data-snap', 'closed')
    expect((sheet as HTMLElement).style.height).toBe('64px')
    expect(screen.getByRole('button', { name: '謎リストを広げる' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '問題を見る' })).not.toBeInTheDocument()
    expect(document.activeElement).toBe(handle)
    await user.click(handle)
    expect(sheet).toHaveAttribute('data-snap', 'half')
    const openHandle = handle
    fireEvent.pointerDown(openHandle, { pointerId: 4, pointerType: 'touch', clientY: 200 })
    fireEvent.pointerMove(openHandle, { pointerId: 4, pointerType: 'touch', clientY: 600 })
    fireEvent.pointerUp(openHandle, { pointerId: 4, pointerType: 'touch', clientY: 600 })
    expect(sheet).toHaveAttribute('data-snap', 'closed')
    await user.click(openHandle)
    expect(sheet).toHaveAttribute('data-snap', 'half')
    fireEvent.pointerDown(openHandle, { pointerId: 5, pointerType: 'touch', clientY: 400 })
    fireEvent.pointerMove(openHandle, { pointerId: 5, pointerType: 'touch', clientY: 400 })
    fireEvent.pointerUp(openHandle, { pointerId: 5, pointerType: 'touch', clientY: 400 })
    expect(sheet).toHaveAttribute('data-snap', 'half')
  })

  it('keeps the closed sheet handle as the focus destination and omits the reopen button', () => {
    const { container } = render(<ExploreBottomSheet><p>リスト本文</p></ExploreBottomSheet>)
    const sheet = container.querySelector('.explore-sheet') as HTMLElement
    const handle = screen.getByRole('button', { name: '謎リストを広げる' })
    fireEvent.pointerDown(handle, { pointerId: 10, pointerType: 'touch', clientY: 300 })
    fireEvent.pointerMove(handle, { pointerId: 10, pointerType: 'touch', clientY: 400 })
    fireEvent.pointerUp(handle, { pointerId: 10, pointerType: 'touch', clientY: 400 })
    expect(sheet).toHaveAttribute('data-snap', 'closed')

    expect(document.activeElement).toBe(handle)
    expect(screen.queryByRole('button', { name: '問題を見る' })).not.toBeInTheDocument()
  })

  it('notifies the parent when closed without taking focus away from the handle', async () => {
    const user = userEvent.setup()
    const onUserClosedChange = vi.fn()
    const { container } = render(<ExploreBottomSheet onUserClosedChange={onUserClosedChange}><p>リスト本文</p></ExploreBottomSheet>)
    const sheet = container.querySelector('.explore-sheet')
    await user.click(screen.getByRole('button', { name: '謎リストを広げる' }))
    const handle = screen.getByRole('button', { name: '謎リストを広げる' })
    fireEvent.pointerDown(handle, { pointerId: 40, pointerType: 'touch', clientY: 200 })
    fireEvent.pointerMove(handle, { pointerId: 40, pointerType: 'touch', clientY: 800 })
    fireEvent.pointerUp(handle, { pointerId: 40, pointerType: 'touch', clientY: 800 })
    expect(sheet).toHaveAttribute('data-snap', 'closed')
    expect(onUserClosedChange.mock.calls).toEqual([[false], [true]])
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '謎リストを広げる' }))
    expect(screen.queryByRole('button', { name: '問題を見る' })).not.toBeInTheDocument()
  })

  it('never renders a separate 問題を見る button', async () => {
    const user = userEvent.setup()
    const { container } = render(<ExploreBottomSheet><p>リスト本文</p></ExploreBottomSheet>)
    await user.click(screen.getByRole('button', { name: '謎リストを広げる' }))
    await user.click(screen.getByRole('button', { name: '謎リストを広げる' }))
    expect(container.querySelector('.explore-sheet-reopen')).toBeNull()
    expect(screen.queryByRole('button', { name: '問題を見る' })).not.toBeInTheDocument()
  })

  it('opens to half when a new area is signalled, and stays where the user left it for the same signal', () => {
    const onUserClosedChange = vi.fn()
    const { container, rerender } = render(<ExploreBottomSheet openSignal={null} onUserClosedChange={onUserClosedChange}><p>リスト本文</p></ExploreBottomSheet>)
    const sheet = container.querySelector('.explore-sheet')
    rerender(<ExploreBottomSheet openSignal="area-a" onUserClosedChange={onUserClosedChange}><p>リスト本文</p></ExploreBottomSheet>)
    expect(sheet).toHaveAttribute('data-snap', 'half')
    expect(onUserClosedChange).not.toHaveBeenCalled()
    const handle = screen.getByRole('button', { name: '謎リストを広げる' })
    fireEvent.pointerDown(handle, { pointerId: 40, pointerType: 'touch', clientY: 200 })
    fireEvent.pointerMove(handle, { pointerId: 40, pointerType: 'touch', clientY: 800 })
    fireEvent.pointerUp(handle, { pointerId: 40, pointerType: 'touch', clientY: 800 })
    expect(sheet).toHaveAttribute('data-snap', 'closed')
    rerender(<ExploreBottomSheet openSignal="area-a" onUserClosedChange={onUserClosedChange}><p>リスト本文</p></ExploreBottomSheet>)
    expect(sheet).toHaveAttribute('data-snap', 'closed')
    rerender(<ExploreBottomSheet openSignal="area-b" onUserClosedChange={onUserClosedChange}><p>リスト本文</p></ExploreBottomSheet>)
    expect(sheet).toHaveAttribute('data-snap', 'half')
  })
})


describe('sheet snap height contract', () => {
  // ExploreBottomSheet 内の snapHeights と同じ式。export すると Fast Refresh lint に当たるためここで固定する。
  function heights(stageHeight: number) {
    const half = Math.max(SHEET_PEEK_HEIGHT, Math.round(stageHeight * 0.55))
    const full = Math.max(half, stageHeight - 84)
    return { closed: 64, peek: SHEET_PEEK_HEIGHT, half, full }
  }
  it('keeps peek fixed and derives half/full from the usable stage', () => {
    expect(heights(640)).toEqual({ closed: 64, peek: SHEET_PEEK_HEIGHT, half: 352, full: 556 })
    expect(heights(700)).toEqual({ closed: 64, peek: SHEET_PEEK_HEIGHT, half: 385, full: 616 })
  })
})

describe('ExploreBottomSheet stage measure', () => {
  it('subtracts the CSS bottom offset so full fits above the tab bar without a lower gap', () => {
    const shell = document.createElement('div')
    Object.defineProperty(shell, 'clientHeight', { configurable: true, value: 800 })
    document.body.appendChild(shell)
    render(<ExploreBottomSheet><p>リスト本文</p></ExploreBottomSheet>, { container: shell })
    const sheet = shell.querySelector('.explore-sheet') as HTMLElement
    const original = window.getComputedStyle.bind(window)
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el: Element) => {
      const style = original(el)
      if (el === sheet) {
        Object.defineProperty(style, 'bottom', { configurable: true, get: () => '104px' })
      }
      return style
    })
    fireEvent(window, new Event('resize'))
    const handle = screen.getByRole('button', { name: '謎リストを広げる' })
    // usable = 800 - 104 = 696 → full = 696 - 84 = 612
    fireEvent.pointerDown(handle, { pointerId: 20, pointerType: 'touch', clientY: 600 })
    fireEvent.pointerMove(handle, { pointerId: 20, pointerType: 'touch', clientY: 50 })
    fireEvent.pointerUp(handle, { pointerId: 20, pointerType: 'touch', clientY: 50 })
    expect(sheet).toHaveAttribute('data-snap', 'full')
    expect(sheet.style.height).toBe('612px')
    // 親800に対し bottom104 + height612 = 716。上に84px（SHEET_TOP_GAP）だけ残り、下端の隙間は出ない。
    expect(104 + 612 + 84).toBe(800)
  })

  it('remeasures when the visual viewport resizes (mobile URL bar)', () => {
    const listeners = new Map<string, Set<(event: Event) => void>>()
    const viewport = {
      addEventListener: vi.fn((type: string, handler: (event: Event) => void) => {
        const set = listeners.get(type) ?? new Set<(event: Event) => void>()
        set.add(handler)
        listeners.set(type, set)
      }),
      removeEventListener: vi.fn((type: string, handler: (event: Event) => void) => {
        listeners.get(type)?.delete(handler)
      }),
    }
    vi.stubGlobal('visualViewport', viewport)
    let parentHeight = 640
    const shell = document.createElement('div')
    Object.defineProperty(shell, 'clientHeight', { configurable: true, get: () => parentHeight })
    document.body.appendChild(shell)
    const { unmount } = render(<ExploreBottomSheet><p>リスト本文</p></ExploreBottomSheet>, { container: shell })
    const sheet = shell.querySelector('.explore-sheet') as HTMLElement
    expect(viewport.addEventListener).toHaveBeenCalledWith('resize', expect.any(Function))
    expect(viewport.addEventListener).toHaveBeenCalledWith('scroll', expect.any(Function))
    parentHeight = 500
    for (const handler of listeners.get('resize') ?? []) handler(new Event('resize'))
    fireEvent.click(screen.getByRole('button', { name: '謎リストを広げる' }))
    // usable 500 → half = max(SHEET_PEEK_HEIGHT, round(275)) = 275
    expect(sheet.style.height).toBe('275px')
    unmount()
    expect(viewport.removeEventListener).toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})

it('toggles half and full by tap, shows a count when dragged closed, and restores the pre-detail snap', async () => {
  const user = userEvent.setup()
  const { container, rerender } = render(<ExploreBottomSheet questCount={14}><p>本文</p></ExploreBottomSheet>)
  const sheet = container.querySelector('.explore-sheet')!
  const handle = screen.getByRole('button', { name: '謎リストを広げる' })
  await user.click(handle)
  expect(sheet).toHaveAttribute('data-snap', 'half')
  rerender(<ExploreBottomSheet questCount={14} detailOpen><p>説明</p></ExploreBottomSheet>)
  await user.click(handle)
  expect(sheet).toHaveAttribute('data-snap', 'full')
  rerender(<ExploreBottomSheet questCount={14} detailOpen={false}><p>本文</p></ExploreBottomSheet>)
  expect(sheet).toHaveAttribute('data-snap', 'half')
  await user.click(handle)
  expect(sheet).toHaveAttribute('data-snap', 'full')
  expect(handle).toHaveAccessibleName('謎リストをたたむ')
  await user.click(handle)
  expect(sheet).toHaveAttribute('data-snap', 'half')
  fireEvent.pointerDown(handle, { pointerId: 99, pointerType: 'touch', clientY: 200 })
  fireEvent.pointerMove(handle, { pointerId: 99, pointerType: 'touch', clientY: 800 })
  fireEvent.pointerUp(handle, { pointerId: 99, pointerType: 'touch', clientY: 800 })
  expect(sheet).toHaveAttribute('data-snap', 'closed')
  expect(handle).toHaveTextContent('14件の謎')
})

it('詳細表示中の取っ手タップで一覧に戻り、閉じるボタンを増やさない', async () => {
  const user = userEvent.setup()
  const onDismissDetail = vi.fn()
  const { container } = render(<ExploreBottomSheet detailOpen onDismissDetail={onDismissDetail}><p>問題文</p></ExploreBottomSheet>)
  expect(screen.queryByRole('button', { name: /閉じる|×/ })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '謎リストに戻る' }))
  expect(onDismissDetail).toHaveBeenCalledOnce()
  expect(container.querySelector('.explore-sheet')).toHaveAttribute('data-snap', 'peek')
})

it('詳細表示中に取っ手を下までドラッグすると詳細を解除し、シートを閉じたままにする', () => {
  const onDismissDetail = vi.fn()
  const { container, rerender } = render(<ExploreBottomSheet detailOpen onDismissDetail={onDismissDetail}><p>問題文</p></ExploreBottomSheet>)
  const handle = screen.getByRole('button', { name: '謎リストに戻る' })
  fireEvent.pointerDown(handle, { pointerId: 80, pointerType: 'touch', clientY: 200 })
  fireEvent.pointerMove(handle, { pointerId: 80, pointerType: 'touch', clientY: 800 })
  fireEvent.pointerUp(handle, { pointerId: 80, pointerType: 'touch', clientY: 800 })
  expect(onDismissDetail).toHaveBeenCalledOnce()
  rerender(<ExploreBottomSheet detailOpen={false} onDismissDetail={onDismissDetail}><p>一覧</p></ExploreBottomSheet>)
  expect(container.querySelector('.explore-sheet')).toHaveAttribute('data-snap', 'closed')
})

it('restores the snap before a pin or row opens, even when detail loads after the signal', () => {
  const { container, rerender } = render(<ExploreBottomSheet openSignal={null}><p>一覧</p></ExploreBottomSheet>)
  const sheet = container.querySelector('.explore-sheet')!
  rerender(<ExploreBottomSheet openSignal="area-a:"><p>一覧</p></ExploreBottomSheet>)
  expect(sheet).toHaveAttribute('data-snap', 'half')
  rerender(<ExploreBottomSheet openSignal="area-a:q2" detailOpen><p>2問目</p></ExploreBottomSheet>)
  expect(sheet).toHaveAttribute('data-snap', 'half')
  rerender(<ExploreBottomSheet openSignal={null}><p>一覧</p></ExploreBottomSheet>)
  expect(sheet).toHaveAttribute('data-snap', 'peek')
})


describe('sheet card click guard', () => {
  it('discards a card tap 80ms after opening from closed and accepts it after the animation and grace period', () => {
    vi.useFakeTimers()
    try {
      const onOpenQuest = vi.fn()
      const { container } = render(<ExploreBottomSheet>
        <button className="explore-quest-card" onClick={onOpenQuest}><span>札幌</span></button>
      </ExploreBottomSheet>)
      const handle = screen.getByRole('button', { name: '謎リストを広げる' })
      const card = screen.getByText('札幌')
      fireEvent.pointerDown(handle, { pointerId: 1, pointerType: 'touch', clientY: 300 })
      fireEvent.pointerMove(handle, { pointerId: 1, pointerType: 'touch', clientY: 700 })
      fireEvent.pointerUp(handle, { pointerId: 1, pointerType: 'touch', clientY: 700 })
      fireEvent.click(handle) // ドラッグ直後の合成click
      expect(container.querySelector('.explore-sheet')).toHaveAttribute('data-snap', 'closed')
      vi.advanceTimersByTime(600)
      // 実タップと同じくpointerDownでリリース時間を既定値へ戻す。
      fireEvent.pointerDown(handle, { pointerId: 2, pointerType: 'touch', clientY: 718 })
      fireEvent.pointerUp(handle, { pointerId: 2, pointerType: 'touch', clientY: 718 })
      fireEvent.click(handle)
      expect(container.querySelector('.explore-sheet')).toHaveAttribute('data-snap', 'half')
      vi.advanceTimersByTime(80)
      fireEvent.click(card)
      expect(onOpenQuest).not.toHaveBeenCalled()
      vi.advanceTimersByTime(220)
      fireEvent.click(card) // 遷移終了直後にも短い保護期間がある。
      expect(onOpenQuest).not.toHaveBeenCalled()
      vi.advanceTimersByTime(101)
      fireEvent.click(card)
      expect(onOpenQuest).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps rapid handle taps working and extends the guard for the latest snap', () => {
    vi.useFakeTimers()
    try {
      const onOpenQuest = vi.fn()
      const { container } = render(<ExploreBottomSheet>
        <button className="explore-quest-card" onClick={onOpenQuest}>札幌</button>
      </ExploreBottomSheet>)
      const handle = screen.getByRole('button', { name: '謎リストを広げる' })
      fireEvent.click(handle)
      vi.advanceTimersByTime(80)
      fireEvent.click(handle)
      expect(container.querySelector('.explore-sheet')).toHaveAttribute('data-snap', 'full')
      vi.advanceTimersByTime(321)
      fireEvent.click(screen.getByText('札幌'))
      expect(onOpenQuest).not.toHaveBeenCalled()
      vi.advanceTimersByTime(80)
      fireEvent.click(screen.getByText('札幌'))
      expect(onOpenQuest).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
})
