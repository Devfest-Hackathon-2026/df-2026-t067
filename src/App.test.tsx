import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import App from './App'
import { demoQuest } from './features/quests/demoQuest'

describe('未接続の起動画面', () => {
  it('ブランドはコンパスではなく装飾用の新アイコンを表示する', () => {
    const { container } = render(<App />)
    const mark = container.querySelector('.brand-mark')
    const image = mark?.querySelector('img')
    expect(image).toHaveAttribute('src', '/favicon.svg')
    expect(image).toHaveAttribute('alt', '')
    expect(image).toHaveAttribute('aria-hidden', 'true')
    expect(mark?.querySelector('svg')).toBeNull()
    expect(container.querySelector('.brand')).toHaveTextContent('NAZOP')
  })

  it('認証設定がなくても入口を閲覧でき、未接続であることが分かる', () => {
    render(<App />)

    expect(screen.getByRole('main')).toBeVisible()
    expect(screen.getByRole('heading', { level: 1 })).toBeVisible()
    // ヘッダーにログイン状態の常時表示は無く、未接続時はログインアイコンがスロットに残る。
    // disabled だと --ui-disabled で色が落ちて boot→React でチラつくので aria-disabled で操作だけ塞ぐ。
    expect(screen.queryByRole('status', { name: 'ログイン状態' })).not.toBeInTheDocument()
    const login = screen.getByRole('button', { name: 'ログイン' })
    expect(login).toHaveAttribute('aria-disabled', 'true')
    expect(login).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'アカウントメニュー' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '問題を見る' })).toBeEnabled()
    expect(screen.queryByRole('region', { name: 'サンプル問題の詳細' })).not.toBeInTheDocument()
  })

  it('架空問題を開閉・再表示できるが、挑戦開始や認証成功には進まない', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: '問題を見る' }))
    const details = screen.getByRole('region', { name: 'サンプル問題の詳細' })
    expect(details).not.toHaveTextContent(/デモ|実際に訪問・撮影できる場所ではありません/)
    const startButton = within(details).getByRole('button', { name: 'Googleでログイン' })
    expect(startButton).toBeDisabled()
    await user.click(startButton)
    expect(details).toBeVisible()
    expect(screen.queryByRole('status', { name: 'ログイン状態' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '問題を見る' }))
    expect(screen.queryByRole('region', { name: 'サンプル問題の詳細' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '問題を見る' }))
    expect(screen.getByRole('button', { name: 'Googleでログイン' })).toBeDisabled()
  })

  it('キーボードで問題を開閉でき、開閉状態が支援技術に伝わる', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.tab()
    expect(screen.getByRole('link', { name: '本文へ移動' })).toHaveFocus()
    const toggle = screen.getByRole('button', { name: '問題を見る' })
    for (let i = 0; i < 20 && document.activeElement !== toggle; i++) await user.tab()
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

describe('ディープリンク', () => {
  it('URLで問題を指定すると、その問題の詳細が開いた状態で表示される', async () => {
    window.history.replaceState(null, '', `/?quest=${demoQuest.questId}`)
    try {
      render(<App />)
      expect(await screen.findByRole('region', { name: 'サンプル問題の詳細' })).toBeVisible()
      expect(screen.getByRole('button', { name: '問題を見る' })).toBeVisible()
    } finally {
      window.history.replaceState(null, '', '/')
    }
  })
})


it('shows only one PC handoff before and after opening hints and reopening details', async () => {
  let measuredWide = true
  vi.stubGlobal('matchMedia', () => ({ matches: measuredWide, addEventListener() {}, removeEventListener() {} }))
  try {
    const user = userEvent.setup()
    const { container } = render(<App />)
    await user.click(screen.getByRole('button', { name: '問題を見る' }))
    expect(screen.getAllByRole('img', { name: /QRコード/ })).toHaveLength(1)
    expect(container.querySelector('.quest-mobile-start')).toBeNull()
    // 子だけが再描画した際の実測値が異なっても、親のレイアウト判定にそろえる。
    measuredWide = false
    await user.click(screen.getByRole('button', { name: 'ヒントを見る' }))
    expect(await screen.findByText('ヒントは順番に開けます')).toBeVisible()
    expect(screen.getAllByRole('img', { name: /QRコード/ })).toHaveLength(1)
    expect(container.querySelector('.quest-mobile-start')).toBeNull()
    measuredWide = true
    await user.click(screen.getByRole('button', { name: '問題を見る' }))
    await user.click(screen.getByRole('button', { name: '問題を見る' }))
    expect(screen.getAllByRole('img', { name: /QRコード/ })).toHaveLength(1)
    expect(container.querySelector('.quest-mobile-start')).toBeNull()
  } finally { vi.unstubAllGlobals() }
})
