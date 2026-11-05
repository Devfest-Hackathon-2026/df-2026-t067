import { render, screen } from '@testing-library/react'
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
