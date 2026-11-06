import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { QuestDetails } from './QuestDetails'
import { ApiError } from '../../shared/api/client'
import { demoQuest } from './demoQuest'

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
  expect(screen.getByText(demoQuest.visitConditions)).toBeVisible()
  expect(screen.getByText(props.areaLabel)).toBeVisible()
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
  await user.click(screen.getByRole('button', { name: 'ヒント画像を見る' }))
  let image = document.querySelector('img.optional-hint-image') as HTMLImageElement
  expect(image).toHaveAttribute('src', quest.optionalHintImage)
  expect(screen.getByRole('status')).toHaveTextContent('読み込み中')
  fireEvent.load(image)
  expect(image).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'ヒント画像を閉じる' }))
  expect(document.querySelector('img.optional-hint-image')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'ヒント画像を見る' }))
  image = document.querySelector('img.optional-hint-image') as HTMLImageElement
  fireEvent.error(image)
  expect(screen.getByRole('alert')).toHaveTextContent('読み込めませんでした')
  await user.tab()
  expect(screen.getByRole('button', { name: '再試行' })).toHaveFocus()
  await user.keyboard('{Enter}')
  expect(screen.getByRole('status')).toHaveTextContent('読み込み中')
  expect(screen.getByRole('button', { name: 'ヒント画像を閉じる' })).toHaveFocus()
  expect(document.querySelector('img.optional-hint-image')).toBeInTheDocument()
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
  await user.click(screen.getByRole('button', { name: 'ヒント画像を見る' }))
  expect(document.querySelector('img.optional-hint-image')).toBeInTheDocument()
  const changed = { ...quest, version: quest.version + 1 }
  rerender(<QuestDetails {...base} quest={changed} />)
  expect(document.querySelector('img.optional-hint-image')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'ヒント画像を見る' })).toHaveAttribute('aria-expanded', 'false')
  await user.click(screen.getByRole('button', { name: 'ヒント画像を見る' }))
  rerender(<QuestDetails {...base} quest={{ ...changed, optionalHintImage: 'https://example.test/two.jpg' }} />)
  expect(screen.getByRole('button', { name: 'ヒント画像を見る' })).toHaveAttribute('aria-expanded', 'false')
  await user.click(screen.getByRole('button', { name: 'ヒント画像を見る' }))
  rerender(<QuestDetails {...base} quest={{ ...changed, questId: 'other-quest', optionalHintImage: 'https://example.test/two.jpg' }} />)
  expect(screen.getByRole('button', { name: 'ヒント画像を見る' })).toHaveAttribute('aria-expanded', 'false')
  await user.click(screen.getByRole('button', { name: 'ヒント画像を見る' }))
  rerender(<QuestDetails {...base} open={false} quest={{ ...changed, questId: 'other-quest', optionalHintImage: 'https://example.test/two.jpg' }} />)
  rerender(<QuestDetails {...base} open quest={{ ...changed, questId: 'other-quest', optionalHintImage: 'https://example.test/two.jpg' }} />)
  expect(screen.getByRole('button', { name: 'ヒント画像を見る' })).toHaveAttribute('aria-expanded', 'false')
  rerender(<QuestDetails {...base} quest={{ ...changed, questId: 'other-quest', optionalHintImage: undefined }} />)
  expect(screen.queryByRole('button', { name: /ヒント画像/ })).not.toBeInTheDocument()
})

it('fetches each public hint only on explicit request, retries failures, and gives 404 its own state', async () => {
  const user = userEvent.setup()
  const quest = { ...demoQuest, hintCount: 2 }
  const reload = vi.fn()
  const getHint = vi.fn().mockRejectedValueOnce(new ApiError('NOT_FOUND', { status: 404 }))
    .mockResolvedValueOnce({ questId: quest.questId, version: quest.version, index: 1, text: '第一段階' })
    .mockResolvedValueOnce({ questId: quest.questId, version: quest.version, index: 2, text: '第二段階' })
  render(<QuestDetails quest={quest} areaLabel="地域" open disabled={false} buttonLabel="挑戦する" note="" onToggle={vi.fn()} onStart={vi.fn()} getHint={getHint} onReloadQuest={reload} />)
  expect(getHint).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'ヒント1を見る' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('見つかりません（404）')
  expect(reload).not.toHaveBeenCalled()
  expect(screen.getAllByRole('button', { name: '問題を読みなおす' })).toHaveLength(1)
  expect(screen.getByRole('heading', { name: quest.title }).parentElement?.parentElement).toContainElement(screen.getByRole('button', { name: '問題を読みなおす' }))
  expect(screen.getByRole('alert')).not.toContainElement(screen.getByRole('button', { name: '問題を読みなおす' }))
  await user.click(screen.getByRole('button', { name: '問題を読みなおす' }))
  expect(reload).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('button', { name: '挑戦する' })).toBeEnabled()
  screen.getByRole('button', { name: 'ヒント1を再試行' }).focus()
  expect(screen.getByRole('button', { name: 'ヒント1を再試行' })).toHaveFocus()
  await user.keyboard('{Enter}')
  expect(await screen.findByText('第一段階')).toBeVisible()
  expect(screen.getByRole('button', { name: 'ヒント1を閉じる' })).toHaveFocus()
  await user.click(screen.getByRole('button', { name: 'ヒント1を閉じる' }))
  await user.click(screen.getByRole('button', { name: 'ヒント2を見る' }))
  expect(await screen.findByText('第二段階')).toBeVisible()
  expect(getHint.mock.calls.map(([input]) => input)).toEqual([
    { questId: quest.questId, expectedVersion: quest.version, index: 1 },
    { questId: quest.questId, expectedVersion: quest.version, index: 1 },
    { questId: quest.questId, expectedVersion: quest.version, index: 2 },
  ])
})

it('offers manual quest reload for INVALID_INPUT, invoked once with Enter, but not for transport errors', async () => {
  const user = userEvent.setup()
  const quest = { ...demoQuest, hintCount: 1 }
  const reload = vi.fn()
  const getHint = vi.fn().mockRejectedValueOnce(new ApiError('INVALID_INPUT', { status: 400 }))
    .mockRejectedValueOnce(new Error('network down'))
  render(<QuestDetails quest={quest} areaLabel="地域" open disabled={false} buttonLabel="挑戦する" note="" onToggle={vi.fn()} onStart={vi.fn()} getHint={getHint} onReloadQuest={reload} />)
  await user.click(screen.getByRole('button', { name: 'ヒント1を見る' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('ヒント番号が無効')
  expect(reload).not.toHaveBeenCalled()
  expect(screen.getAllByRole('button', { name: '問題を読みなおす' })).toHaveLength(1)
  screen.getByRole('button', { name: '問題を読みなおす' }).focus()
  await user.keyboard('{Enter}')
  expect(reload).toHaveBeenCalledTimes(1)

  await user.click(screen.getByRole('button', { name: 'ヒント1を閉じる' }))
  await user.click(screen.getByRole('button', { name: 'ヒント1を見る' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('通信を確認')
  expect(screen.queryByRole('button', { name: '問題を読みなおす' })).not.toBeInTheDocument()
  expect(reload).toHaveBeenCalledTimes(1)
})

it('keeps one title reload for multiple invalid hints and clears it when all failures resolve or details close', async () => {
  const user = userEvent.setup()
  const quest = { ...demoQuest, hintCount: 2 }
  const getHint = vi.fn()
    .mockRejectedValueOnce(new ApiError('NOT_FOUND', { status: 404 }))
    .mockRejectedValueOnce(new ApiError('INVALID_INPUT', { status: 400 }))
    .mockResolvedValueOnce({ questId: quest.questId, version: quest.version, index: 1, text: '復旧済み' })
  const base = { quest, areaLabel: '地域', disabled: false, buttonLabel: '挑戦する', note: '', onToggle: vi.fn(), onStart: vi.fn(), getHint, onReloadQuest: vi.fn() }
  const { rerender } = render(<QuestDetails {...base} open />)
  await user.click(screen.getByRole('button', { name: 'ヒント1を見る' }))
  await screen.findByText(/見つかりません（404）/)
  expect(screen.getAllByRole('button', { name: '問題を読みなおす' })).toHaveLength(1)
  await user.click(screen.getByRole('button', { name: 'ヒント2を見る' }))
  await screen.findByText(/ヒント番号が無効/)
  expect(screen.getAllByRole('button', { name: '問題を読みなおす' })).toHaveLength(1)
  await user.click(screen.getByRole('button', { name: 'ヒント1を閉じる' }))
  await user.click(screen.getByRole('button', { name: 'ヒント1を見る' }))
  await screen.findByText('復旧済み')
  expect(screen.getAllByRole('button', { name: '問題を読みなおす' })).toHaveLength(1)
  await user.click(screen.getByRole('button', { name: '問題を閉じる' }))
  rerender(<QuestDetails {...base} open={false} />)
  rerender(<QuestDetails {...base} open />)
  expect(screen.queryByRole('button', { name: '問題を読みなおす' })).not.toBeInTheDocument()
})

it('clears reload-needed hints when the controlled open prop closes and reopens details', async () => {
  const user = userEvent.setup()
  const quest = { ...demoQuest, hintCount: 1 }
  const getHint = vi.fn().mockRejectedValue(new ApiError('NOT_FOUND', { status: 404 }))
  const base = { quest, areaLabel: '地域', disabled: false, buttonLabel: '挑戦する', note: '', onToggle: vi.fn(), onStart: vi.fn(), getHint }
  const { rerender } = render(<QuestDetails {...base} open />)
  await user.click(screen.getByRole('button', { name: 'ヒント1を見る' }))
  await screen.findByText(/見つかりません（404）/)
  expect(screen.getByRole('button', { name: '問題を読みなおす' })).toBeInTheDocument()

  rerender(<QuestDetails {...base} open={false} />)
  rerender(<QuestDetails {...base} open />)
  expect(screen.queryByRole('button', { name: '問題を読みなおす' })).not.toBeInTheDocument()
})

it('discards an old response when details close, and routes QUEST_CHANGED to reload', async () => {
  const user = userEvent.setup()
  const quest = { ...demoQuest, hintCount: 1 }
  let resolveHint!: (value: { questId: string; version: number; index: number; text: string }) => void
  const getHint = vi.fn(() => new Promise<{ questId: string; version: number; index: number; text: string }>(resolve => { resolveHint = resolve }))
  const base = { areaLabel: '地域', disabled: false, buttonLabel: '挑戦する', note: '', onToggle: vi.fn(), onStart: vi.fn(), getHint }
  const { rerender } = render(<QuestDetails {...base} quest={quest} open />)
  await user.click(screen.getByRole('button', { name: 'ヒント1を見る' }))
  expect(getHint).toHaveBeenCalledWith({ questId: quest.questId, expectedVersion: quest.version, index: 1 }, expect.objectContaining({ signal: expect.any(AbortSignal) }))
  const replacement = vi.fn().mockResolvedValue({ questId: quest.questId, version: quest.version, index: 1, text: '新APIのヒント' })
  rerender(<QuestDetails {...base} quest={quest} open getHint={replacement} />)
  await act(async () => resolveHint({ questId: quest.questId, version: quest.version, index: 1, text: '古いヒント' }))
  expect(screen.queryByText('古いヒント')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'ヒント1を見る' }))
  expect(await screen.findByText('新APIのヒント')).toBeVisible()

  const changed = vi.fn().mockRejectedValue(new ApiError('QUEST_CHANGED', { status: 409 }))
  const reload = vi.fn()
  const onVersionChanged = vi.fn()
  rerender(<QuestDetails {...base} quest={quest} open getHint={changed} onHintVersionChanged={onVersionChanged} onReloadQuest={reload} />)
  await user.click(screen.getByRole('button', { name: 'ヒント1を見る' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('問題の版が変わりました')
  expect(onVersionChanged).toHaveBeenCalledTimes(1)
  expect(screen.queryByRole('button', { name: 'ヒント2を見る' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '問題を読みなおす' }))
  expect(reload).toHaveBeenCalledTimes(1)
})

it('times out even when the transport ignores AbortSignal', async () => {
  vi.useFakeTimers()
  const quest = { ...demoQuest, hintCount: 1 }
  const getHint = vi.fn(() => new Promise<{ questId: string; version: number; index: number; text: string }>(() => {}))
  render(<QuestDetails quest={quest} areaLabel="地域" open disabled={false} buttonLabel="挑戦する" note="" onToggle={vi.fn()} onStart={vi.fn()} getHint={getHint} />)
  fireEvent.click(screen.getByRole('button', { name: 'ヒント1を見る' }))
  expect(screen.getByRole('status')).toHaveTextContent('取得しています')
  await act(async () => { vi.advanceTimersByTime(10_001) })
  expect(screen.getByRole('alert')).toHaveTextContent('タイムアウト')
  expect(screen.getByRole('button', { name: 'ヒント1を再試行' })).toBeInTheDocument()
  vi.useRealTimers()
})
