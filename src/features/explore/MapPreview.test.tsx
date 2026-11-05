import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import App from '../../App'
import { MapPreview } from './MapPreview'

describe('demo map', () => {
  it('makes the preview and fictional location explicit', () => {
    render(<MapPreview selected={false} onSelectQuest={() => {}} />)
    expect(screen.getByRole('img', { name: '日本周辺の簡略地図' })).toBeVisible()
    expect(screen.getByText('デモ位置・実在スポットではありません')).toBeVisible()
  })
  it('supports zoom and returning to the original view with accessible controls', async () => {
    const user = userEvent.setup()
    render(<MapPreview selected={false} onSelectQuest={() => {}} />)
    expect(screen.getByRole('status', { name: '地図の表示倍率' })).toHaveTextContent('100%')
    expect(screen.getByRole('button', { name: '地図を縮小' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: '地図を拡大' }))
    expect(screen.getByRole('status', { name: '地図の表示倍率' })).toHaveTextContent('125%')
    await user.click(screen.getByRole('button', { name: '地図の表示を戻す' }))
    expect(screen.getByRole('status', { name: '地図の表示倍率' })).toHaveTextContent('100%')
    expect(screen.getByRole('button', { name: '地図を縮小' })).toBeDisabled()
  })
  it('opens the same question from the map marker', async () => {
    const user = userEvent.setup()
    render(<App />)
    const marker = screen.getByRole('button', { name: 'デモの謎を地図から見る' })
    await user.click(marker)
    expect(marker).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('region', { name: 'サンプル問題の詳細' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Googleログインして挑戦する' })).toBeDisabled()
  })
})
