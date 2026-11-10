import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { createApiClient } from '../../shared/api'
import { PausePublication } from './PausePublication'

it('prefixes the pause reason with the chosen category and keeps the detail', async () => {
  const user = userEvent.setup()
  const pauseManagedQuest = vi.fn().mockResolvedValue({})
  const onPaused = vi.fn()
  render(<PausePublication api={{ ...createApiClient(), pauseManagedQuest }} orgId="org" questId="q" version={2}
    onPaused={onPaused} onReload={vi.fn()} />)
  await user.click(screen.getByRole('button', { name: '休止' }))
  await user.selectOptions(screen.getByLabelText('種類'), '安全上の問題')
  await user.type(screen.getByLabelText('休止理由'), '足場が崩れている')
  await user.click(screen.getByRole('button', { name: '休止する' }))
  expect(pauseManagedQuest).toHaveBeenCalledExactlyOnceWith('org', 'q',
    { expectedPublishedVersion: 2, reason: '安全上の問題：足場が崩れている' }, { signal: expect.any(AbortSignal) })
  expect(onPaused).toHaveBeenCalledOnce()
})

it('requires a detail when the category is other, and sends detail-only reasons unchanged', async () => {
  const user = userEvent.setup()
  const pauseManagedQuest = vi.fn().mockResolvedValue({})
  render(<PausePublication api={{ ...createApiClient(), pauseManagedQuest }} orgId="org" questId="q" version={1}
    onPaused={vi.fn()} onReload={vi.fn()} />)
  await user.click(screen.getByRole('button', { name: '休止' }))
  await user.selectOptions(screen.getByLabelText('種類'), 'その他')
  expect(screen.getByRole('button', { name: '休止する' })).toBeDisabled()
  await user.type(screen.getByLabelText('休止理由'), '個別の事情')
  await user.click(screen.getByRole('button', { name: '休止する' }))
  expect(pauseManagedQuest.mock.calls[0][2].reason).toBe('その他：個別の事情')
})

it('focuses the category on open and returns to the pause trigger on cancel', async () => {
  const user = userEvent.setup()
  render(<PausePublication api={createApiClient()} orgId="org" questId="q" version={1} onPaused={vi.fn()} onReload={vi.fn()} />)
  await user.click(screen.getByRole('button', { name: '休止' }))
  expect(screen.getByLabelText('種類')).toHaveFocus()
  await user.click(screen.getByRole('button', { name: 'キャンセル' }))
  expect(screen.getByRole('button', { name: '休止' })).toHaveFocus()
})
