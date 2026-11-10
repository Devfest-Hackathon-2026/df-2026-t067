import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { QuestDetails } from './QuestDetails'
import { ApiError } from '../../shared/api/client'
import { demoQuest } from './demoQuest'
import { PrerenderViewport } from './useWideViewport'
import { renderToString } from 'react-dom/server'
import { readFileSync } from 'node:fs'

it('replaces the start action with a cleared notice and a record link for a cleared quest (D-64)', async () => {
  const user = userEvent.setup()
  const onOpenDiscovery = vi.fn()
  const onStart = vi.fn()
  render(<QuestDetails quest={demoQuest} areaLabel="架空エリア" open disabled={false} buttonLabel="挑戦する" note="架空の問題です。" onToggle={vi.fn()} onStart={onStart} clearedDiscoveryId="record-1" onOpenDiscovery={onOpenDiscovery} />)

  expect(screen.getByText('クリア済み')).toBeVisible()
  expect(screen.getAllByText('クリア済み')).toHaveLength(1)
  expect(screen.queryByRole('button', { name: '挑戦する' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'スマホで挑戦する' })).not.toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: '記録を見る' }))
  expect(onOpenDiscovery).toHaveBeenCalledExactlyOnceWith('record-1')
  expect(onStart).not.toHaveBeenCalled()
})

it('reads a quest without auth and forwards the currently displayed id and version', async () => {
  const user = userEvent.setup()
  const onStart = vi.fn()
  const props = {
    areaLabel: '架空の探索地域', open: true, disabled: false,
    buttonLabel: '挑戦する', note: 'テスト用の受け渡し先', onToggle: vi.fn(), onStart,
  }
  const { rerender } = render(<QuestDetails {...props} quest={demoQuest} />)
  expect(screen.getByRole('heading', { name: demoQuest.title })).toBeVisible()
  expect(screen.getByText(demoQuest.clue)).toBeVisible()
  expect(document.querySelector('.sample-note')).not.toBeInTheDocument()
  expect(screen.queryByText(props.areaLabel)).not.toBeInTheDocument()
  expect(onStart).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: '挑戦する' }))
  expect(onStart).toHaveBeenLastCalledWith({ questId: demoQuest.questId, expectedVersion: demoQuest.version })

  const next = { ...demoQuest, questId: 'another-demo', version: 9, title: '別の架空問題', clue: '別の問題文' }
  rerender(<QuestDetails {...props} quest={next} />)
  expect(screen.getByRole('heading', { name: next.title })).toBeVisible()
  expect(screen.getByText(next.clue)).toBeVisible()
  expect(screen.queryByText(demoQuest.clue)).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '挑戦する' }))
  expect(onStart).toHaveBeenLastCalledWith({ questId: 'another-demo', expectedVersion: 9 })
})

it('opens an optional public hint image only on request and supports loading, failure, and retry', async () => {
  const user = userEvent.setup()
  const quest = { ...demoQuest, optionalHintImage: 'https://example.test/hint.jpg' }
  render(<QuestDetails quest={quest} areaLabel="地域" open disabled={false} buttonLabel="挑戦する" note="" onToggle={vi.fn()} onStart={vi.fn()} />)
  expect(document.querySelector('img.optional-hint-image')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'ヒント画像' }))
  let image = document.querySelector('img.optional-hint-image') as HTMLImageElement
  expect(image).toHaveAttribute('src', quest.optionalHintImage)
  expect(screen.getByRole('status')).toHaveTextContent('画像読込中')
  fireEvent.load(image)
  expect(image).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'ヒント画像' }))
  // 閉じるアニメーション（D-59追記）が終わると内容は外れる。
  await waitFor(() => expect(document.querySelector('img.optional-hint-image')).not.toBeInTheDocument())
  await user.click(screen.getByRole('button', { name: 'ヒント画像' }))
  image = document.querySelector('img.optional-hint-image') as HTMLImageElement
  fireEvent.error(image)
  expect(screen.getByRole('alert')).toHaveTextContent('画像読込失敗')
  await user.tab()
  expect(screen.getByRole('button', { name: '再試行' })).toHaveFocus()
  await user.keyboard('{Enter}')
  expect(screen.getByRole('status')).toHaveTextContent('画像読込中')
  expect(screen.getByRole('button', { name: 'ヒント画像' })).toHaveFocus()
  expect(document.querySelector('img.optional-hint-image')).toBeInTheDocument()
})

it('keeps the hint image frame mounted and toggles only its open class (D-59 addendum)', async () => {
  const user = userEvent.setup()
  const quest = { ...demoQuest, optionalHintImage: 'https://example.test/hint.jpg' }
  const { container } = render(<QuestDetails quest={quest} areaLabel="地域" open disabled={false} buttonLabel="挑戦する" note="" onToggle={vi.fn()} onStart={vi.fn()} />)
  // 閉じている間も枠は常駐し、中身は持たない。枠が常駐していることで、
  // 閉じた高さ（0fr）が確定した状態からクラス切り替えで遷移が始められる。
  const wrap = container.querySelector('.optional-hint-content-wrap')
  expect(wrap).not.toBeNull()
  expect(wrap).not.toHaveClass('is-open')
  expect(container.querySelector('.optional-hint-content')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'ヒント画像' }))
  // 枠の要素自体は差し替わらず、is-open が付くだけ（再マウントなし）。
  expect(container.querySelector('.optional-hint-content-wrap')).toBe(wrap)
  expect(wrap).toHaveClass('is-open')
  const image = document.querySelector('img.optional-hint-image') as HTMLImageElement
  fireEvent.load(image)
  expect(image).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'ヒント画像' }))
  expect(container.querySelector('.optional-hint-content-wrap')).toBe(wrap)
  expect(wrap).not.toHaveClass('is-open')
  // 閉じ終わるまでは最後の内容が枠の中に残り、終わると外れる。
  expect(document.querySelector('img.optional-hint-image')).toBeInTheDocument()
  await waitFor(() => expect(document.querySelector('img.optional-hint-image')).not.toBeInTheDocument())
})

it('shows a per-hint image inline after its hint is opened without a second button', async () => {
  const user = userEvent.setup()
  const imageUrl = '/api/v1/quests/demo-quest/hint-images/2?expectedVersion=1'
  const quest = { ...demoQuest, hintCount: 2, hintImages: [null, imageUrl, null] }
  const getHint = vi.fn(async ({ index }: { index: number }) => ({ questId: quest.questId, version: quest.version, index, text: `ヒント${index}本文` }))
  render(<QuestDetails quest={quest} getHint={getHint} areaLabel="地域" open disabled={false} buttonLabel="挑戦する" note="" onToggle={vi.fn()} onStart={vi.fn()} />)
  await user.click(screen.getByRole('button', { name: 'ヒントを見る' }))
  await screen.findByText('ヒント1本文')
  await user.click(screen.getByRole('button', { name: '2' }))
  await screen.findByText('ヒント2本文')
  const image = document.querySelector('img.optional-hint-image') as HTMLImageElement
  expect(image).toHaveAttribute('src', imageUrl)
  expect(screen.queryByRole('button', { name: 'ヒント画像' })).not.toBeInTheDocument()
  fireEvent.error(image)
  expect(screen.getByText('ヒント2本文')).toBeVisible()
  await user.click(screen.getByRole('button', { name: '再試行' }))
  expect(screen.getByRole('button', { name: '2' })).toHaveFocus()
  const retriedImage = document.querySelector('img.optional-hint-image') as HTMLImageElement
  fireEvent.load(retriedImage)
  expect(retriedImage).toBeVisible()
})

it('shows only the required shooting conditions on the quest card', () => {
  const props = { areaLabel: '架空の地域', open: true, disabled: false, buttonLabel: '挑戦する', note: '',
    onToggle: vi.fn(), onStart: vi.fn() }
  const { rerender } = render(<QuestDetails {...props} quest={{ ...demoQuest,
    shootingConditions: { requiresBoat: true, requiresPaidFacility: false } }} />)
  expect(screen.getByRole('img', { name: '船上・海上での撮影が必要' })).toBeVisible()
  expect(screen.queryByRole('img', { name: '有料施設内での撮影が必要' })).not.toBeInTheDocument()
  rerender(<QuestDetails {...props} quest={{ ...demoQuest,
    shootingConditions: { requiresBoat: false, requiresPaidFacility: true } }} />)
  expect(screen.getByRole('img', { name: '有料施設内での撮影が必要' })).toBeVisible()
  expect(screen.queryByRole('img', { name: '船上・海上での撮影が必要' })).not.toBeInTheDocument()
  rerender(<QuestDetails {...props} quest={demoQuest} />)
  expect(screen.queryByRole('group', { name: '撮影に必要な条件' })).not.toBeInTheDocument()
})

it('hides the image control when absent and resets the open image on quest, version, or URL change', async () => {
  const user = userEvent.setup()
  const base = { areaLabel: '地域', open: true, disabled: false, buttonLabel: '挑戦する', note: '', onToggle: vi.fn(), onStart: vi.fn() }
  const quest = { ...demoQuest, optionalHintImage: 'https://example.test/one.jpg' }
  const { rerender } = render(<QuestDetails {...base} quest={quest} />)
  await user.click(screen.getByRole('button', { name: 'ヒント画像' }))
  expect(document.querySelector('img.optional-hint-image')).toBeInTheDocument()
  const changed = { ...quest, version: quest.version + 1 }
  rerender(<QuestDetails {...base} quest={changed} />)
  expect(document.querySelector('img.optional-hint-image')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'ヒント画像' })).toHaveAttribute('aria-expanded', 'false')
  await user.click(screen.getByRole('button', { name: 'ヒント画像' }))
  rerender(<QuestDetails {...base} quest={{ ...changed, optionalHintImage: 'https://example.test/two.jpg' }} />)
  expect(screen.getByRole('button', { name: 'ヒント画像' })).toHaveAttribute('aria-expanded', 'false')
  await user.click(screen.getByRole('button', { name: 'ヒント画像' }))
  rerender(<QuestDetails {...base} quest={{ ...changed, questId: 'other-quest', optionalHintImage: 'https://example.test/two.jpg' }} />)
  expect(screen.getByRole('button', { name: 'ヒント画像' })).toHaveAttribute('aria-expanded', 'false')
  await user.click(screen.getByRole('button', { name: 'ヒント画像' }))
  rerender(<QuestDetails {...base} open={false} quest={{ ...changed, questId: 'other-quest', optionalHintImage: 'https://example.test/two.jpg' }} />)
  rerender(<QuestDetails {...base} open quest={{ ...changed, questId: 'other-quest', optionalHintImage: 'https://example.test/two.jpg' }} />)
  expect(screen.getByRole('button', { name: 'ヒント画像' })).toHaveAttribute('aria-expanded', 'false')
  rerender(<QuestDetails {...base} quest={{ ...changed, questId: 'other-quest', optionalHintImage: undefined }} />)
  expect(screen.queryByRole('button', { name: /ヒント画像/ })).not.toBeInTheDocument()
})

it('times out each image attempt, ignores late events from timed out or closed attempts, and retries with a fresh image', async () => {
  vi.useFakeTimers()
  const consoleError = vi.spyOn(console, 'error')
  try {
    const quest = { ...demoQuest, optionalHintImage: '/hint-harness.svg' }
    render(<QuestDetails quest={quest} areaLabel="地域" open disabled={false} buttonLabel="挑戦する" note="" onToggle={vi.fn()} onStart={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'ヒント画像' }))
    const firstImage = document.querySelector('img.optional-hint-image') as HTMLImageElement
    await act(async () => { vi.advanceTimersByTime(10_000) })
    expect(screen.getByRole('alert')).toHaveTextContent('時間切れ')
    expect(document.querySelector('img.optional-hint-image')).not.toBeInTheDocument()
    fireEvent.load(firstImage)
    expect(screen.getByRole('alert')).toHaveTextContent('時間切れ')

    fireEvent.click(screen.getByRole('button', { name: '再試行' }))
    const retryImage = document.querySelector('img.optional-hint-image') as HTMLImageElement
    expect(retryImage).not.toBe(firstImage)
    fireEvent.error(firstImage)
    expect(screen.getByRole('status')).toHaveTextContent('画像読込中')
    fireEvent.load(retryImage)
    expect(retryImage).toBeVisible()
    await act(async () => { vi.advanceTimersByTime(10_000) })
    expect(retryImage).toBeVisible()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'ヒント画像' }))
    // 閉じるアニメーション（D-59追記）の間は内容が保持され、終わると外れる。
    expect(document.querySelector('img.optional-hint-image')).toBeInTheDocument()
    await act(async () => { vi.advanceTimersByTime(300) })
    expect(document.querySelector('img.optional-hint-image')).not.toBeInTheDocument()
    await act(async () => { vi.advanceTimersByTime(10_000) })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(document.querySelector('img.optional-hint-image')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'ヒント画像' }))
    const reopenedImage = document.querySelector('img.optional-hint-image') as HTMLImageElement
    fireEvent.error(retryImage)
    expect(screen.getByRole('status')).toHaveTextContent('画像読込中')
    fireEvent.load(reopenedImage)
    expect(reopenedImage).toBeVisible()
    expect(consoleError).not.toHaveBeenCalled()
  } finally {
    vi.useRealTimers()
  }
})

it('does not create an object URL when an authenticated image response resolves after close', async () => {
  const user = userEvent.setup()
  const quest = { ...demoQuest, optionalHintImage: '/api/v1/quests/demo-quest/hint-image?expectedVersion=1' }
  let resolvePhoto!: (photo: Blob) => void
  const getPhoto = vi.fn(() => new Promise<Blob>((resolve) => { resolvePhoto = resolve }))
  const createObjectURL = vi.fn(() => 'blob:late-hint')
  const revokeObjectURL = vi.fn()
  vi.stubGlobal('URL', class extends URL { static createObjectURL = createObjectURL; static revokeObjectURL = revokeObjectURL })
  try {
    render(<QuestDetails quest={quest} getHintPhoto={getPhoto} areaLabel="地域" open disabled={false} buttonLabel="挑戦する" note="" onToggle={vi.fn()} onStart={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'ヒント画像' }))
    expect(getPhoto).toHaveBeenCalledWith(quest.questId, quest.version, expect.objectContaining({ signal: expect.any(AbortSignal) }))
    await user.click(screen.getByRole('button', { name: 'ヒント画像' }))
    await act(async () => resolvePhoto(new Blob(['image'], { type: 'image/jpeg' })))
    expect(createObjectURL).not.toHaveBeenCalled()
    expect(revokeObjectURL).not.toHaveBeenCalled()
    expect(document.querySelector('img.optional-hint-image')).not.toBeInTheDocument()
  } finally { vi.unstubAllGlobals() }
})

it('times out an authenticated fetch, retries, keeps one blob URL after load, and revokes it once on unmount', async () => {
  vi.useFakeTimers()
  const quest = { ...demoQuest, optionalHintImage: '/api/v1/quests/demo-quest/hint-image?expectedVersion=1' }
  const blob = new Blob(['image'], { type: 'image/jpeg' })
  const getPhoto = vi.fn()
    .mockImplementationOnce(() => new Promise<Blob>(() => {}))
    .mockResolvedValueOnce(blob)
  const createObjectURL = vi.fn(() => 'blob:retry-hint')
  const revokeObjectURL = vi.fn()
  vi.stubGlobal('URL', class extends URL { static createObjectURL = createObjectURL; static revokeObjectURL = revokeObjectURL })
  try {
    const { unmount } = render(<QuestDetails quest={quest} getHintPhoto={getPhoto} areaLabel="地域" open disabled={false} buttonLabel="挑戦する" note="" onToggle={vi.fn()} onStart={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'ヒント画像' }))
    await act(async () => { vi.advanceTimersByTime(10_000) })
    expect(screen.getByRole('alert')).toHaveTextContent('時間切れ')
    expect(getPhoto).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: '再試行' }))
    await act(async () => { await Promise.resolve() })
    const image = document.querySelector('img.optional-hint-image') as HTMLImageElement
    expect(image).toBeInTheDocument()
    expect(getPhoto).toHaveBeenCalledTimes(2)
    expect(createObjectURL).toHaveBeenCalledTimes(1)
    fireEvent.load(image)
    expect(image).toBeVisible()
    await act(async () => { vi.advanceTimersByTime(10_000) })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(getPhoto).toHaveBeenCalledTimes(2)
    expect(revokeObjectURL).not.toHaveBeenCalled()

    unmount()
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:retry-hint')
  } finally {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  }
})

it('disposes the current protected image when the authenticated photo provider changes', async () => {
  const quest = { ...demoQuest, optionalHintImage: '/api/v1/quests/demo-quest/hint-image?expectedVersion=1' }
  const firstPhoto = vi.fn().mockResolvedValue(new Blob(['one'], { type: 'image/jpeg' }))
  const secondPhoto = vi.fn().mockResolvedValue(new Blob(['two'], { type: 'image/jpeg' }))
  const createObjectURL = vi.fn().mockReturnValueOnce('blob:first-provider').mockReturnValueOnce('blob:second-provider')
  const revokeObjectURL = vi.fn()
  vi.stubGlobal('URL', class extends URL { static createObjectURL = createObjectURL; static revokeObjectURL = revokeObjectURL })
  try {
    const base = { quest, areaLabel: '地域', open: true, disabled: false, buttonLabel: '挑戦する', note: '', onToggle: vi.fn(), onStart: vi.fn() }
    const { rerender } = render(<QuestDetails {...base} getHintPhoto={firstPhoto} />)
    fireEvent.click(screen.getByRole('button', { name: 'ヒント画像' }))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    const oldImage = document.querySelector('img.optional-hint-image') as HTMLImageElement
    expect(oldImage).toHaveAttribute('src', 'blob:first-provider')
    fireEvent.load(oldImage)

    rerender(<QuestDetails {...base} getHintPhoto={secondPhoto} />)
    expect(document.querySelector('img.optional-hint-image')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'ヒント画像' })).toHaveAttribute('aria-expanded', 'false')
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:first-provider')

    fireEvent.click(screen.getByRole('button', { name: 'ヒント画像' }))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(secondPhoto).toHaveBeenCalledTimes(1)
    expect(document.querySelector('img.optional-hint-image')).toHaveAttribute('src', 'blob:second-provider')
  } finally { vi.unstubAllGlobals() }
})

it('fetches each public hint only on explicit request, retries failures, and gives 404 its own state', async () => {
  const user = userEvent.setup()
  const quest = { ...demoQuest, hintCount: 3 }
  const reload = vi.fn()
  const getHint = vi.fn().mockRejectedValueOnce(new ApiError('NOT_FOUND', { status: 404 }))
    .mockResolvedValueOnce({ questId: quest.questId, version: quest.version, index: 1, text: '第一段階' })
    .mockResolvedValueOnce({ questId: quest.questId, version: quest.version, index: 2, text: '第二段階' })
    .mockResolvedValueOnce({ questId: quest.questId, version: quest.version, index: 3, text: '第三段階' })
  render(<QuestDetails quest={quest} areaLabel="地域" open disabled={false} buttonLabel="挑戦する" note="" onToggle={vi.fn()} onStart={vi.fn()} getHint={getHint} onReloadQuest={reload} />)
  expect(getHint).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: 'ヒントを見る' })).toBeVisible()
  expect(screen.queryByRole('button', { name: '2' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'ヒントを見る' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('ヒントなし')
  expect(reload).not.toHaveBeenCalled()
  expect(screen.getAllByRole('button', { name: '問題を再読込' })).toHaveLength(1)
  expect(screen.getByRole('heading', { name: quest.title }).parentElement?.parentElement).toContainElement(screen.getByRole('button', { name: '問題を再読込' }))
  expect(screen.getByRole('alert')).not.toContainElement(screen.getByRole('button', { name: '問題を再読込' }))
  await user.click(screen.getByRole('button', { name: '問題を再読込' }))
  expect(reload).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('button', { name: '挑戦する' })).toBeEnabled()
  screen.getByRole('button', { name: '再試行' }).focus()
  expect(screen.getByRole('button', { name: '再試行' })).toHaveFocus()
  await user.keyboard('{Enter}')
  expect(await screen.findByText('第一段階')).toBeVisible()
  expect(screen.getByRole('button', { name: '1' })).toHaveFocus()
  expect(screen.getByRole('button', { name: '3' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '3' })).toHaveAttribute('title', 'まだ開けません')
  expect(screen.getByRole('button', { name: '3' })).toHaveAttribute('aria-disabled', 'true')
  expect(screen.getByRole('button', { name: '2' })).toBeEnabled()
  await user.click(screen.getByRole('button', { name: '2' }))
  expect(await screen.findByText('第二段階')).toBeVisible()
  expect(screen.queryByRole('button', { name: '戻る' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '1' }))
  expect(await screen.findByText('第一段階')).toBeVisible()
  await user.click(screen.getByRole('button', { name: '2' }))
  await user.click(screen.getByRole('button', { name: '3' }))
  expect(await screen.findByText('第三段階')).toBeVisible()
  expect(screen.getByRole('button', { name: '2' })).toBeEnabled()
  await user.click(screen.getByRole('button', { name: '2' }))
  expect(await screen.findByText('第二段階')).toBeVisible()
  expect(screen.getByRole('button', { name: '2' })).toHaveAttribute('aria-current', 'step')
  expect(screen.getByRole('button', { name: '2' })).toHaveFocus()
  await user.click(screen.getByRole('button', { name: '1' }))
  expect(screen.getByText('第一段階')).toBeVisible()
  expect(getHint.mock.calls.map(([input]) => input)).toEqual([
    { questId: quest.questId, expectedVersion: quest.version, index: 1 },
    { questId: quest.questId, expectedVersion: quest.version, index: 1 },
    { questId: quest.questId, expectedVersion: quest.version, index: 2 },
    { questId: quest.questId, expectedVersion: quest.version, index: 3 },
  ])
})

it('keeps full-width hint actions without the sequential fine-print note', async () => {
  const user = userEvent.setup()
  const quest = { ...demoQuest, hintCount: 2 }
  const getHint = vi.fn(async ({ index }: { index: number }) => ({
    questId: quest.questId, version: quest.version, index, text: `hint-${index}`,
  }))
  render(<QuestDetails quest={quest} areaLabel="港区" open disabled={false} buttonLabel="挑戦する" note="" onToggle={vi.fn()} onStart={vi.fn()} getHint={getHint} />)
  const button = screen.getByRole('button', { name: 'ヒントを見る' })
  expect(button).toBeVisible()
  expect(screen.queryByText('ヒントは順番に開けます。最終案内は含みません。')).not.toBeInTheDocument()
  await user.click(button)
  expect(await screen.findByText('hint-1')).toBeVisible()
  expect(screen.getByLabelText('ヒント 1 / 2')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '2' })).toBeVisible()
  expect(screen.queryByRole('button', { name: '次へ' })).not.toBeInTheDocument()
})

it('resets unlocked hint buttons when the quest version changes', async () => {
  const user = userEvent.setup()
  const quest = { ...demoQuest, hintCount: 2 }
  const getHint = vi.fn(async ({ index, expectedVersion }: { questId: string; expectedVersion: number; index: number }) => ({
    questId: quest.questId, version: expectedVersion, index, text: `ヒント${index}`,
  }))
  const props = { quest, areaLabel: '地域', open: true, disabled: false, buttonLabel: '挑戦する', note: '', onToggle: vi.fn(), onStart: vi.fn(), getHint }
  const { rerender } = render(<QuestDetails {...props} />)
  await user.click(screen.getByRole('button', { name: 'ヒントを見る' }))
  expect(await screen.findByText('ヒント1')).toBeVisible()
  expect(screen.getByRole('button', { name: '2' })).toBeEnabled()
  rerender(<QuestDetails {...props} quest={{ ...quest, version: quest.version + 1 }} />)
  expect(screen.getByRole('button', { name: 'ヒントを見る' })).toBeVisible()
  expect(screen.queryByRole('button', { name: '2' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'ヒントを見る' }))
  expect(await screen.findByText('ヒント1')).toBeVisible()
  expect(screen.getByRole('button', { name: '2' })).toBeEnabled()
  rerender(<QuestDetails {...props} quest={{ ...quest, questId: 'different-quest' }} />)
  expect(screen.getByRole('button', { name: 'ヒントを見る' })).toBeVisible()
  expect(screen.queryByRole('button', { name: '2' })).not.toBeInTheDocument()
})

it('offers manual quest reload for INVALID_INPUT, invoked once with Enter, but not for transport errors', async () => {
  const user = userEvent.setup()
  const quest = { ...demoQuest, hintCount: 1 }
  const reload = vi.fn()
  const getHint = vi.fn().mockRejectedValueOnce(new ApiError('INVALID_INPUT', { status: 400 }))
    .mockRejectedValueOnce(new Error('network down'))
  render(<QuestDetails quest={quest} areaLabel="地域" open disabled={false} buttonLabel="挑戦する" note="" onToggle={vi.fn()} onStart={vi.fn()} getHint={getHint} onReloadQuest={reload} />)
  await user.click(screen.getByRole('button', { name: 'ヒントを見る' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('ヒント番号エラー')
  expect(reload).not.toHaveBeenCalled()
  expect(screen.getAllByRole('button', { name: '問題を再読込' })).toHaveLength(1)
  screen.getByRole('button', { name: '問題を再読込' }).focus()
  await user.keyboard('{Enter}')
  expect(reload).toHaveBeenCalledTimes(1)

  await user.click(screen.getByRole('button', { name: '再試行' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('ヒント取得失敗')
  expect(screen.queryByRole('button', { name: '問題を再読込' })).not.toBeInTheDocument()
  expect(reload).toHaveBeenCalledTimes(1)
})

it('keeps later hints locked through failures and clears reload state when the first hint succeeds or details close', async () => {
  const user = userEvent.setup()
  const quest = { ...demoQuest, hintCount: 2 }
  const getHint = vi.fn()
    .mockRejectedValueOnce(new ApiError('NOT_FOUND', { status: 404 }))
    .mockRejectedValueOnce(new ApiError('INVALID_INPUT', { status: 400 }))
    .mockResolvedValueOnce({ questId: quest.questId, version: quest.version, index: 1, text: '復旧済み' })
  const base = { quest, areaLabel: '地域', disabled: false, buttonLabel: '挑戦する', note: '', onToggle: vi.fn(), onStart: vi.fn(), getHint, onReloadQuest: vi.fn() }
  const { rerender } = render(<QuestDetails {...base} open />)
  await user.click(screen.getByRole('button', { name: 'ヒントを見る' }))
  await screen.findByText(/ヒントなし/)
  expect(screen.getByRole('button', { name: '2' })).toBeDisabled()
  expect(screen.getAllByRole('button', { name: '問題を再読込' })).toHaveLength(1)
  await user.click(screen.getByRole('button', { name: '再試行' }))
  await screen.findByText(/ヒント番号エラー/)
  expect(screen.getAllByRole('button', { name: '問題を再読込' })).toHaveLength(1)
  expect(screen.getByRole('button', { name: '2' })).toBeDisabled()
  await user.click(screen.getByRole('button', { name: '再試行' }))
  await screen.findByText('復旧済み')
  expect(screen.getByRole('button', { name: '2' })).toBeVisible()
  expect(screen.queryByRole('button', { name: '問題を再読込' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '問題を見る' }))
  rerender(<QuestDetails {...base} open={false} />)
  rerender(<QuestDetails {...base} open />)
  expect(screen.queryByRole('button', { name: '問題を再読込' })).not.toBeInTheDocument()
})

it('clears reload-needed hints when the controlled open prop closes and reopens details', async () => {
  const user = userEvent.setup()
  const quest = { ...demoQuest, hintCount: 1 }
  const getHint = vi.fn().mockRejectedValue(new ApiError('NOT_FOUND', { status: 404 }))
  const base = { quest, areaLabel: '地域', disabled: false, buttonLabel: '挑戦する', note: '', onToggle: vi.fn(), onStart: vi.fn(), getHint }
  const { rerender } = render(<QuestDetails {...base} open />)
  await user.click(screen.getByRole('button', { name: 'ヒントを見る' }))
  await screen.findByText(/ヒントなし/)
  expect(screen.getByRole('button', { name: '問題を再読込' })).toBeInTheDocument()

  rerender(<QuestDetails {...base} open={false} />)
  rerender(<QuestDetails {...base} open />)
  expect(screen.queryByRole('button', { name: '問題を再読込' })).not.toBeInTheDocument()
})

it('discards an old response when details close, and routes QUEST_CHANGED to reload', async () => {
  const user = userEvent.setup()
  const quest = { ...demoQuest, hintCount: 1 }
  let resolveHint!: (value: { questId: string; version: number; index: number; text: string }) => void
  const getHint = vi.fn(() => new Promise<{ questId: string; version: number; index: number; text: string }>(resolve => { resolveHint = resolve }))
  const base = { areaLabel: '地域', disabled: false, buttonLabel: '挑戦する', note: '', onToggle: vi.fn(), onStart: vi.fn(), getHint }
  const { rerender } = render(<QuestDetails {...base} quest={quest} open />)
  await user.click(screen.getByRole('button', { name: 'ヒントを見る' }))
  expect(getHint).toHaveBeenCalledWith({ questId: quest.questId, expectedVersion: quest.version, index: 1 }, expect.objectContaining({ signal: expect.any(AbortSignal) }))
  const replacement = vi.fn().mockResolvedValue({ questId: quest.questId, version: quest.version, index: 1, text: '新APIのヒント' })
  rerender(<QuestDetails {...base} quest={quest} open getHint={replacement} />)
  await act(async () => resolveHint({ questId: quest.questId, version: quest.version, index: 1, text: '古いヒント' }))
  expect(screen.queryByText('古いヒント')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'ヒントを見る' }))
  expect(await screen.findByText('新APIのヒント')).toBeVisible()

  const changed = vi.fn().mockRejectedValue(new ApiError('QUEST_CHANGED', { status: 409 }))
  const reload = vi.fn()
  const onVersionChanged = vi.fn()
  rerender(<QuestDetails {...base} quest={quest} open getHint={changed} onHintVersionChanged={onVersionChanged} onReloadQuest={reload} />)
  await user.click(screen.getByRole('button', { name: 'ヒントを見る' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('問題更新')
  expect(onVersionChanged).toHaveBeenCalledTimes(1)
  expect(screen.queryByRole('button', { name: '2' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '問題を再読込' }))
  expect(reload).toHaveBeenCalledTimes(1)
})

it('times out even when the transport ignores AbortSignal', async () => {
  vi.useFakeTimers()
  const quest = { ...demoQuest, hintCount: 1 }
  const getHint = vi.fn(() => new Promise<{ questId: string; version: number; index: number; text: string }>(() => {}))
  render(<QuestDetails quest={quest} areaLabel="地域" open disabled={false} buttonLabel="挑戦する" note="" onToggle={vi.fn()} onStart={vi.fn()} getHint={getHint} />)
  fireEvent.click(screen.getByRole('button', { name: 'ヒントを見る' }))
  expect(screen.getByRole('status')).toHaveTextContent('ヒント取得中')
  await act(async () => { vi.advanceTimersByTime(10_001) })
  expect(screen.getByRole('alert')).toHaveTextContent('時間切れ')
  expect(screen.getByRole('button', { name: '再試行' })).toBeInTheDocument()
  vi.useRealTimers()
})


it.each(['quest', 'version'] as const)('releases authenticated hint images when leaving a card and on %s change', async (change) => {
  const user = userEvent.setup()
  const getHint = vi.fn(async ({ index }: { index: number }) => ({ questId: demoQuest.questId, version: demoQuest.version, index, text: `本文${index}` }))
  const getPhoto = vi.fn(async () => new Blob(['synthetic']))
  const createObjectURL = vi.fn().mockReturnValueOnce('blob:one').mockReturnValueOnce('blob:two').mockReturnValueOnce('blob:three')
  const revokeObjectURL = vi.fn()
  vi.stubGlobal('URL', class extends URL { static createObjectURL = createObjectURL; static revokeObjectURL = revokeObjectURL })
  try {
    const quest = { ...demoQuest, hintCount: 3, hintImages: ['/one', '/two', '/three'] }
    const props = { areaLabel: '地域', open: true, disabled: false, buttonLabel: '挑戦する', note: '', onToggle: vi.fn(), onStart: vi.fn(), getHint, getHintPhoto: getPhoto }
    const { rerender } = render(<QuestDetails {...props} quest={quest} />)
    await user.click(screen.getByRole('button', { name: 'ヒントを見る' }))
    await screen.findByText('本文1')
    await waitFor(() => expect(document.querySelector('img.optional-hint-image')).toHaveAttribute('src', 'blob:one'))
    expect(getPhoto).toHaveBeenNthCalledWith(1, quest.questId, quest.version, 1, { signal: expect.any(AbortSignal) })
    await user.click(screen.getByRole('button', { name: '2' }))
    await screen.findByText('本文2')
    await waitFor(() => expect(document.querySelector('img.optional-hint-image')).toHaveAttribute('src', 'blob:two'))
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:one')
    await user.click(screen.getByRole('button', { name: '3' }))
    await screen.findByText('本文3')
    await waitFor(() => expect(document.querySelector('img.optional-hint-image')).toHaveAttribute('src', 'blob:three'))
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:two')
    expect(document.querySelectorAll('img.optional-hint-image')).toHaveLength(1)
    rerender(<QuestDetails {...props} quest={{ ...quest, ...(change === 'quest' ? { questId: 'another-quest' } : { version: quest.version + 1 }) }} />)
    expect(document.querySelectorAll('img.optional-hint-image')).toHaveLength(0)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:three')
    expect(screen.queryByText('本文3')).not.toBeInTheDocument()
  } finally { vi.unstubAllGlobals() }
})

describe('広い画面でのスマホ受け渡し', () => {
  const handoffUrl = 'https://example.test/?area=demo-area&quest=demo-harbor-clock'
  function stubViewport(wide: boolean) {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: wide && query === '(min-width: 981px)',
      media: query, onchange: null,
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
      addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(() => false),
    }))
  }
  afterEach(() => { vi.unstubAllGlobals() })

  it('PCではQRだけを表示し、挑戦開始を呼ばない', async () => {
    stubViewport(true)
    const onStart = vi.fn()
    render(<QuestDetails quest={demoQuest} areaLabel="地域" open disabled={false} buttonLabel="挑戦する" note="注記" onToggle={vi.fn()} onStart={onStart} handoffUrl={handoffUrl} />)
    expect(screen.queryByRole('button', { name: 'スマホで挑戦する' })).not.toBeInTheDocument()
    expect(screen.getByRole('img', { name: /QRコード/ })).toBeVisible()
    expect(screen.queryByRole('button', { name: '挑戦する' })).not.toBeInTheDocument()
    expect(onStart).not.toHaveBeenCalled()

  })

  it('狭い画面では従来どおり挑戦が主導線で、受け渡しは出ない', async () => {
    stubViewport(false)
    const user = userEvent.setup()
    const onStart = vi.fn()
    render(<QuestDetails quest={demoQuest} areaLabel="地域" open disabled={false} buttonLabel="挑戦する" note="注記" onToggle={vi.fn()} onStart={onStart} handoffUrl={handoffUrl} />)
    expect(screen.queryByRole('button', { name: 'スマホで挑戦する' })).not.toBeInTheDocument()
    expect(screen.queryByRole('img', { name: /QRコード/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '挑戦する' }))
    expect(onStart).toHaveBeenCalledWith({ questId: demoQuest.questId, expectedVersion: demoQuest.version })
  })

  it('挑戦導線を隠す設定では、広い画面でも受け渡しを出さない', () => {
    stubViewport(true)
    render(<QuestDetails quest={demoQuest} areaLabel="地域" open disabled={false} buttonLabel="挑戦する" note="注記" onToggle={vi.fn()} onStart={vi.fn()} hideStartAction handoffUrl={handoffUrl} />)
    expect(screen.queryByRole('button', { name: 'スマホで挑戦する' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '挑戦する' })).not.toBeInTheDocument()
  })
})

it('一覧内の詳細は題名を読み上げ用に残し、番号と地域を繰り返さない', () => {
  const { container } = render(<QuestDetails quest={{ ...demoQuest, questNumber: '07-04' }} areaLabel="架空の探索地域" open hideToggle disabled={false} buttonLabel="挑戦する" onToggle={vi.fn()} onStart={vi.fn()} />)
  expect(screen.getByRole('heading', { name: demoQuest.title })).toHaveClass('sr-only')
  expect(screen.getByRole('article')).toHaveAccessibleName(demoQuest.title)
  expect(screen.queryByText('No. 07-04')).not.toBeInTheDocument()
  expect(screen.queryByText('架空の探索地域')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /閉じる|×/ })).not.toBeInTheDocument()
  expect(container.querySelector('.quest-meta')).toBeNull()
})

it('hides amounts in previously published free price conditions', () => {
  render(<QuestDetails quest={{ ...demoQuest, visitConditions: '料金 無料：500\n注意：足元に注意\n旧注意の続き' }} areaLabel="地域" open disabled={false} buttonLabel="挑戦する" onToggle={vi.fn()} onStart={vi.fn()} />)
  expect(screen.getByText(/料金 無料/)).not.toHaveTextContent('500')
  expect(screen.queryByText(/足元に注意|旧注意の続き/)).not.toBeInTheDocument()
})

it('ヒント見出しを重ねず、ヒントなしでは領域ごと表示しない', () => {
  const props = { areaLabel: '地域', open: true, disabled: false, buttonLabel: '挑戦する',
    onToggle: vi.fn(), onStart: vi.fn(), getHint: vi.fn() }
  const { container, rerender } = render(<QuestDetails {...props} quest={{ ...demoQuest, hintCount: 1 }} />)
  expect(screen.getByRole('button', { name: 'ヒントを見る' })).toBeVisible()
  expect(screen.queryByRole('heading', { name: 'ヒント' })).not.toBeInTheDocument()
  expect(container.querySelector('.quest-hints')).toHaveAttribute('aria-label', 'ヒント')
  rerender(<QuestDetails {...props} quest={{ ...demoQuest, hintCount: 0 }} />)
  expect(container.querySelector('.quest-hints')).not.toBeInTheDocument()
  expect(screen.queryByText('ヒントなし')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'ヒントを見る' })).not.toBeInTheDocument()
})

it('omits the condition paragraph when a legacy publication contains only a photo note', () => {
  const { container } = render(<QuestDetails quest={{ ...demoQuest, visitConditions: '注意：旧注意\n続き' }} areaLabel="地域" open disabled={false} buttonLabel="挑戦する" onToggle={vi.fn()} onStart={vi.fn()} />)
  expect(screen.queryByText(/旧注意|続き/)).not.toBeInTheDocument()
  expect(container.querySelector('.sample-note')).toBeNull()
})


it('keeps the PC handoff on initial HTML and hint updates using the parent viewport', async () => {
  // 子の実測値がまだ親と一致しなくても、同じ詳細ツリーは親の幅を使う。
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
  const getHint = vi.fn().mockResolvedValue({ text: '最初のヒント' })
  const tree = <PrerenderViewport value={true}><QuestDetails quest={demoQuest} areaLabel="地域" open disabled={false}
    buttonLabel="挑戦を開始" onToggle={vi.fn()} onStart={vi.fn()} getHint={getHint} /></PrerenderViewport>
  try {
    expect(renderToString(tree)).not.toContain('quest-mobile-start')
    const { container } = render(tree)
    const starts: Element[] = []
    const observer = new MutationObserver(() => { starts.push(...container.querySelectorAll('.quest-mobile-start')) })
    observer.observe(container, { childList: true, subtree: true })
    try {
      expect(container.querySelector('.quest-mobile-start')).toBeNull()
      expect(screen.getByRole('img', { name: /QRコード/ })).toBeVisible()
      expect(screen.getByText('ヒントは順番に開けます')).toBeVisible()
      await userEvent.setup().click(screen.getByRole('button', { name: 'ヒントを見る' }))
      await screen.findByText('最初のヒント')
      expect(starts).toHaveLength(0)
      expect(screen.queryByRole('button', { name: '挑戦を開始' })).not.toBeInTheDocument()
    } finally { observer.disconnect() }
  } finally { vi.unstubAllGlobals() }
})


it('blocks painting a mobile start action at the PC breakpoint even before React updates', () => {
  const css = readFileSync('src/App.css', 'utf8')
  expect(css).toMatch(/@media \(min-width: 981px\)\s*\{\s*\.quest-mobile-start\s*\{\s*display: none;/)
})
