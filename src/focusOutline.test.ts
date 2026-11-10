import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const theme = readFileSync('src/theme.css', 'utf8')
const app = readFileSync('src/App.css', 'utf8')
const admin = readFileSync('src/features/admin/admin.css', 'utf8')

describe('プログラムによるフォーカスの枠', () => {
  it.each([['theme.css', theme], ['App.css', app], ['admin.css', admin]])('%s は tabindex=-1 の focus と focus-visible の枠を消す', (_name, css) => {
    expect(css).toMatch(/\[tabindex="-1"\]:focus,\s*\[tabindex="-1"\]:focus-visible\s*\{\s*outline: none;\s*\}/)
  })

  it('管理画面では例外の詳細度が通常の focus-visible より高い', () => {
    // .admin-demo :focus-visible は (0,2,0)、以下の例外は (0,3,0)。
    expect(admin).toMatch(/\.admin-demo \[tabindex="-1"\]:focus,\s*\.admin-demo \[tabindex="-1"\]:focus-visible,\s*\[tabindex="-1"\]:focus,\s*\[tabindex="-1"\]:focus-visible\s*\{\s*outline: none;\s*\}/)
    expect(admin).not.toMatch(/\.admin-read-list > li:focus\s*\{/)
  })

  it.each([['theme.css', theme], ['App.css', app], ['admin.css', admin]])('%s はボタン等に適用するキーボードフォーカスの枠を残す', (_name, css) => {
    expect(css).toContain(':focus-visible { outline: 3px solid var(--ui-focus);')

  })
})
