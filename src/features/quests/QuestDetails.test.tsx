import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { QuestDetails } from './QuestDetails'
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
  await user.click(screen.getByRole('button', { name: '再試行' }))
  expect(screen.getByRole('status')).toHaveTextContent('読み込み中')
  expect(document.querySelector('img.optional-hint-image')).toBeInTheDocument()
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
