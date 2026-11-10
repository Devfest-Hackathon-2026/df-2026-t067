import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync('src/App.css', 'utf8')
const emptyRule = css.match(/\.owner-records:not\(\[hidden\]\):has\(\.record-empty\) \{([^}]+)\}/)?.[1]

describe('記録0件の配置', () => {
  it('0件だけを縦flexにし、残りの高さを空表示へ渡す', () => {
    expect(emptyRule).toContain('display: flex;')
    expect(emptyRule).toContain('flex-direction: column;')
    expect(css).toMatch(/\.owner-records:not\(\[hidden\]\):has\(\.record-empty\) > \.record-empty \{[^}]*flex: 1;/)
    expect(css).toMatch(/\.owner-records:not\(\[hidden\]\):has\(\.record-empty\) > h1 \{[^}]*align-self: stretch;/)
    expect(css).not.toMatch(/\.owner-records:not\(\[hidden\]\):has\(\.record-empty\)[^{]*\{[^}]*text-align: center/)
  })

  it('PCとスマホで上下の既存余白を高さから除き、下タブのsafe-areaを二重計上しない', () => {
    expect(css).toContain('min-height: calc(100dvh - var(--account-slot-top) - var(--account-slot-size) - var(--sp-24) - var(--sp-24));')
    expect(css).toContain('min-height: calc(100dvh - 80px - env(safe-area-inset-top, 0px) - var(--mobile-tabbar-h) - var(--sp-16));')
    expect(emptyRule).toContain('padding-bottom: 0;')
  })

  it('一覧と見出しの既存規則を保ち、空表示用規則は他の状態に一致しない', () => {
    expect(css).toContain('.record-list { display: grid; gap: var(--sp-8); width: 100%; margin: 0; padding: 0; list-style: none; }')
    expect(css).toContain('.record-list li { min-width: 0; }')
    expect(css).toContain('.owner-records > h1 { font-size: var(--fs-24); line-height: 1.4; font-weight: var(--ui-weight-strong); }')
    const hidden = document.createElement('section')
    hidden.className = 'owner-records'
    hidden.hidden = true
    hidden.innerHTML = '<div class="record-empty"></div>'
    expect(hidden.matches('.owner-records:not([hidden]):has(.record-empty)')).toBe(false)
    for (const content of ['<ul class="record-list"><li>記録</li></ul>', '<p role="status">読込中</p>', '<p role="alert">記録読込失敗</p>', '<button class="google-continue">ログイン</button>']) {
      const section = document.createElement('section')
      section.className = 'owner-records'
      section.innerHTML = content
      expect(section.matches('.owner-records:not([hidden]):has(.record-empty)')).toBe(false)
    }
  })
})
