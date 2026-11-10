import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { ClearScreen } from './ClearScreen'

it('isolates clear-screen gestures and restores the background state on unmount', () => {
  const alreadyInert = document.createElement('aside')
  alreadyInert.setAttribute('inert', '')
  document.body.append(alreadyInert)
  const onPointerDown = vi.fn()
  const onTouchStart = vi.fn()
  const view = render(<div onPointerDown={onPointerDown} onTouchStart={onTouchStart}>
    <ClearScreen photo={new Blob(['synthetic'])} onReturnToMap={vi.fn()} />
  </div>)
  const dialog = screen.getByRole('dialog')
  expect(dialog.parentElement).toBe(document.body)
  expect(view.container).toHaveAttribute('inert')
  fireEvent.pointerDown(dialog)
  fireEvent.touchStart(dialog)
  expect(onPointerDown).not.toHaveBeenCalled()
  expect(onTouchStart).not.toHaveBeenCalled()
  view.unmount()
  expect(view.container).not.toHaveAttribute('inert')
  expect(alreadyInert).toHaveAttribute('inert')
  alreadyInert.remove()
})

it('白いカードの完了帯とチェックを表示し、記録へ進む', () => {
  const onViewRecord = vi.fn()
  render(<ClearScreen photo={new Blob(['synthetic'])} onViewRecord={onViewRecord} />)
  const card = screen.getByRole('dialog').querySelector('.clear-screen-card')!
  expect(card.querySelector('.clear-celebration')).toHaveAttribute('aria-hidden', 'true')
  expect(card.querySelector('.clear-celebration-badge .icon')).toBeInTheDocument()
  expect(card.querySelector('.clear-celebration')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '記録を見る' }))
  expect(onViewRecord).toHaveBeenCalledOnce()
})
