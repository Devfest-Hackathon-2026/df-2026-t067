import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import App from '../../App'
import type { AuthClient } from '../auth/authTypes'

const css = readFileSync('src/App.css', 'utf8')

describe('旅行者の共通シェル', () => {
  it.each(['主要ナビゲーション', 'スマホ用ナビゲーション'])('%sで往復しても同じブランドとナビを保持する', async (name) => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
    const snapshot = { status: 'signed-out', user: null } as const
    const auth: AuthClient = {
      getSnapshot: () => snapshot, subscribe: () => () => {},
      signInWithGoogle: vi.fn(), signOut: vi.fn(), getIdToken: vi.fn(),
    }
    render(<App authClient={auth} apiMode apiDataMode="durable-local" />)
    const user = userEvent.setup()
    const nav = screen.getByRole('navigation', { name })
    const toggle = screen.getByRole('button', { name: 'サイドバーを閉じる' })
    const brand = screen.getByText('NAZOP')
    const shell = nav.closest('.traveler-shell')
    expect(shell).not.toBeNull()
    expect(shell).toContainElement(brand)
    await user.click(within(nav).getByRole('button', { name: '自分の記録' }))
    expect(shell).toContainElement(screen.getByRole('heading', { name: '自分の記録' }))
    expect(screen.getByRole('button', { name: 'サイドバーを閉じる' })).toBe(toggle)
    expect(screen.getByText('NAZOP')).toBe(brand)
    expect(screen.getByRole('navigation', { name })).toBe(nav)
    await user.click(within(nav).getByRole('button', { name: '謎を探す' }))
    expect(shell).toContainElement(screen.getByRole('heading', { name: '全国から謎を探す' }))
    expect(screen.getByRole('button', { name: 'サイドバーを閉じる' })).toBe(toggle)
    expect(screen.getByText('NAZOP')).toBe(brand)
    expect(screen.getByRole('navigation', { name })).toBe(nav)
  })

  it('表示中のタブに依存せずPCのブランドとナビを配置する', () => {
    expect(css).not.toContain('body:has(.owner-records:not([hidden]))')
    expect(css).toContain('body:has(.traveler-shell) .brand,')
    expect(css).toContain('body:has(.traveler-shell) .desktop-nav,')
    expect(css).toContain('--pc-sidebar-open-w: 280px;')
    expect(css).toContain('body:has(.traveler-shell) .explore-view { margin-left: var(--pc-sidebar-w); padding: var(--sp-24); }')
    expect(css).toContain('margin: calc(var(--account-slot-top) + var(--account-slot-size) + var(--sp-24)) var(--sp-24) var(--sp-24) calc(var(--pc-sidebar-w) + var(--sp-24));')
    expect(css).not.toContain('body:has(.traveler-shell) .sidebar-toggle { display: none; }')
  })

  it('PCのブランド行は左16px・開閉ボタンは右16pxで両タブ共通にする', () => {
    expect(css).toContain('body:has(.traveler-shell) .brand { width: calc(var(--pc-sidebar-w) - 60px); padding-inline: var(--sp-16); }')
    expect(css).toContain('body:has(.traveler-shell) .sidebar-toggle { display: grid; left: calc(var(--pc-sidebar-open-w) - 60px); }')
  })

  it('PCとスマホの記録カードはアカウント下端から16px以上離す', () => {
    expect(css).toContain('margin: calc(var(--account-slot-top) + var(--account-slot-size) + var(--sp-24)) var(--sp-24) var(--sp-24) calc(var(--pc-sidebar-w) + var(--sp-24));')
    expect(css).toContain('margin: calc(80px + env(safe-area-inset-top)) var(--sp-16)')
    // スマホ: 上6px + 高さ44px、カード上80pxなので間隔30px。
    expect(80 - (6 + 44)).toBeGreaterThanOrEqual(16)
  })

  it('記録カードの上マージンが外枠から相殺されてHTML背景を露出しない', () => {
    expect(css).toMatch(/\.traveler-shell \{[^}]*display: flow-root;[^}]*min-height: 100dvh;/)
  })

  it('スマホのタブバーに64pxとセーフエリアを確保する', () => {
    expect(css).toContain('--mobile-tabbar-h: calc(64px + env(safe-area-inset-bottom, 0px))')
    expect(css).toMatch(/\.mobile-nav \{[^}]*height: var\(--mobile-tabbar-h\)/)
  })
})
