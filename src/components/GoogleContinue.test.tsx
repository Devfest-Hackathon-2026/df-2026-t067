import { readFileSync } from 'node:fs'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { GoogleContinue } from './GoogleContinue'

const css = readFileSync('src/components/GoogleContinue.css', 'utf8')
const rule = (selector: string) => css.slice(css.indexOf(`${selector} {`)).split('}')[0]

describe('共通Googleログインの表示', () => {
  it('画面固有のCSSに依存せず、全幅と中央配置を指定する', () => {
    expect(readFileSync('src/components/GoogleContinue.tsx', 'utf8')).toContain("import './GoogleContinue.css'")
    for (const declaration of ['width: 100%;', 'display: flex;', 'align-items: center;', 'justify-content: center;', 'gap: var(--sp-12);']) {
      expect(rule('.google-continue')).toContain(declaration)
    }
    expect(rule('.google-continue svg')).toContain('flex: none;')
    expect(css).not.toContain('position: absolute')
  })

  it('規約は12pxの補助色、管理ログインは中央の最大400pxに収める', () => {
    expect(rule('.login-terms')).toContain('font-size: var(--fs-12);')
    expect(rule('.login-terms')).toContain('color: var(--ui-muted);')
    const adminCss = readFileSync('src/features/admin/admin.css', 'utf8')
    expect(adminCss).toContain('.admin-login-heading, .admin-login { width: min(100%, 400px); margin-inline: auto; }')
    expect(readFileSync('src/App.css', 'utf8')).toContain('.owner-records > .google-continue, .owner-records > .login-terms { max-width: 400px; margin-inline: auto; }')
  })

  it('Gアイコンと既存の文言を表示する', () => {
    render(<button><GoogleContinue /></button>)
    const button = screen.getByRole('button', { name: 'Googleで続行' })
    expect(button.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    expect(button.querySelector('svg')?.nextElementSibling).toHaveTextContent('Googleで続行')
  })
})
