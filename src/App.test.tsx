import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import App from './App'

describe('未接続の起動画面', () => {
  it('認証設定がなくても入口を閲覧でき、未接続であることが分かる', () => {
    render(<App />)

    expect(screen.getByRole('main')).toBeVisible()
    expect(screen.getByRole('heading', { level: 1 })).toBeVisible()
    expect(screen.getByRole('status')).toHaveTextContent('Firebase未接続')
    expect(screen.getByRole('button', { name: '問題を見てみる' })).toBeEnabled()
    expect(screen.queryByRole('region', { name: 'サンプル問題の詳細' })).not.toBeInTheDocument()
  })

  it('架空問題を開閉・再表示できるが、挑戦開始や認証成功には進まない', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: '問題を見てみる' }))
    const details = screen.getByRole('region', { name: 'サンプル問題の詳細' })
    expect(details).toHaveTextContent('実際に訪問・撮影できる場所ではありません')
    const startButton = within(details).getByRole('button', { name: 'Googleログインして挑戦する' })
    expect(startButton).toBeDisabled()
    await user.click(startButton)
    expect(details).toBeVisible()
    expect(screen.getByRole('status')).toHaveTextContent('Firebase未接続')

    await user.click(screen.getByRole('button', { name: '問題を閉じる' }))
    expect(screen.queryByRole('region', { name: 'サンプル問題の詳細' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '問題を見てみる' }))
    expect(screen.getByRole('button', { name: 'Googleログインして挑戦する' })).toBeDisabled()
  })

  it('キーボードで問題を開閉でき、開閉状態が支援技術に伝わる', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.tab()
    expect(screen.getByRole('link', { name: '本文へ移動' })).toHaveFocus()
    await user.tab()
    const toggle = screen.getByRole('button', { name: '問題を見てみる' })
    expect(toggle).toHaveFocus()
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await user.keyboard('{Enter}')
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('region', { name: 'サンプル問題の詳細' })).toBeVisible()
    await user.keyboard('{Enter}')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle).toHaveFocus()
  })
})
