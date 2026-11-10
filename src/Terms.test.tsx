import { readFileSync } from 'node:fs'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it } from 'vitest'
import App from './App'
import { Terms } from './Terms'
import { LocalAdminWorkspace } from './features/admin/LocalAdminWorkspace'
import type { AuthClient, AuthSnapshot } from './features/auth/authTypes'

const snapshot: AuthSnapshot = { status: 'signed-out', user: null }
const authClient: AuthClient = {
  getSnapshot: () => snapshot, subscribe: () => () => {},
  signInWithGoogle: async () => {}, signOut: async () => {}, getIdToken: async () => null,
}

it('/terms は全環境の入口より先に選ばれ、見出しと撮影の決まりを表示する', () => {
  const entry = readFileSync('src/main.tsx', 'utf8')
  expect(entry.indexOf("pathname === '/terms'")).toBeLessThan(entry.indexOf("import.meta.env.VITE_QUEST_DATA_SOURCE === 'team-preview'"))
  expect(entry).toContain("import('./Terms')")
  expect(readFileSync('public/terms/index.html', 'utf8')).toContain('url=/?page=terms')
  expect(entry).toContain("window.history.replaceState(null, '', '/terms')")
  render(<Terms />)
  expect(screen.getByRole('heading', { level: 1, name: '利用規約' })).toBeVisible()
  expect(screen.getByRole('heading', { level: 2, name: '撮影の決まり' })).toBeVisible()
  expect(screen.getAllByRole('listitem').map(item => item.textContent)).toEqual([
    '立入禁止の場所に入らない', '他人の顔を写さない', '私有地や施設のルールを守る',
    '歩きながら撮らない', '交通に気をつける', '通行や施設の利用を妨げない',
  ])
  expect(screen.getByRole('link', { name: 'NAZOP 旅行者画面へ戻る' })).toHaveAttribute('href', '/')
})

it('旅行者ログインの同意文を保ち、利用規約にリンクする', async () => {
  render(<App authClient={authClient} apiMode apiDataMode="durable-local" />)
  await userEvent.click(screen.getAllByRole('button', { name: '自分の記録' })[0])
  const link = screen.getByRole('link', { name: '利用規約' })
  expect(link).toHaveAttribute('href', '/terms')
  expect(link.parentElement).toHaveTextContent('続行すると利用規約に同意したものとみなします')
})

it.each(['team-preview', 'durable-local'] as const)('%s の管理ログインは規約にリンクし、枠を内容の高さにする', dataMode => {
  const { container } = render(<LocalAdminWorkspace authClient={authClient} dataMode={dataMode} />)
  const link = screen.getByRole('link', { name: '利用規約' })
  expect(link).toHaveAttribute('href', '/terms')
  expect(link.parentElement).toHaveTextContent('続行すると利用規約に同意したものとみなします')
  expect(container.querySelector('main')).toHaveClass('admin-signed-out')
  const css = readFileSync('src/features/admin/admin.css', 'utf8')
  const override = css.lastIndexOf('.admin-demo.admin-signed-out { min-height: 0; }')
  expect(override).toBeGreaterThan(css.lastIndexOf('min-height: calc(100vh'))
})
