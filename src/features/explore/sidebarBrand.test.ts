import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(resolve(process.cwd(), 'src/App.css'), 'utf8')

describe('sidebar brand collapse (t161u)', () => {
  it('keeps the brand mark at a constant 32px when collapsed', () => {
    expect(css).toMatch(/explore-sidebar-collapsed \.brand-mark[^}]*width: 32px; height: 32px/)
    expect(css).not.toMatch(/explore-sidebar-collapsed \.brand-mark[^}]*width: 28px/)
  })

  it('fades the app name with max-width/opacity instead of display:none wrap', () => {
    expect(css).toMatch(/explore-sidebar-collapsed \.brand-copy[^{]*\{[^}]*max-width: 0; opacity: 0/)
    expect(css).not.toMatch(/explore-sidebar-collapsed \.brand-copy \{ display: none; \}/)
    expect(css).toContain('white-space: nowrap; overflow: hidden')
  })
})

describe('sidebar icon column stability on collapse', () => {
  it('parks the toggle inside the collapsed rail below navigation', () => {
    // 開いたときは open-w 基準の右端
    expect(css).toContain('left: calc(var(--pc-sidebar-open-w) - 48px)')
    // 閉じたときは細い列の中（中央寄せ）・ナビ直下。外へはみ出さない
    expect(css).toMatch(/explore-sidebar-collapsed \.sidebar-toggle[^}]*left: calc\(\(var\(--pc-sidebar-rail-w\) - 44px\) \/ 2\)/)
    expect(css).toMatch(/explore-sidebar-collapsed \.sidebar-toggle[^}]*top: calc\(var\(--pc-sidebar-brand-h\) \+ var\(--pc-sidebar-nav-h\)\)/)
  })

  it('centers the brand and nav icons without changing their sizes', () => {
    expect(css).not.toMatch(/explore-sidebar-collapsed \.desktop-nav[^}]*top: 92px/)
    expect(css).not.toMatch(/explore-sidebar-collapsed \.desktop-nav \.icon[^}]*width: 22px/)
    expect(css).toMatch(/explore-sidebar-collapsed \.desktop-nav \.icon[^}]*width: 18px/)
    expect(css).toMatch(/explore-sidebar-collapsed \.brand[^}]*justify-content: center/)
  })
})


describe('sidebar hit testing and rail containment', () => {
  it('opts the portal button back into hit testing above the map', () => {
    // The header intentionally lets map gestures through its empty space.
    expect(css).toMatch(/body\.explore-fullbleed \.site-header[^}]*pointer-events: none/)
    expect(css).toMatch(/body\.explore-fullbleed \.site-header[^}]*z-index: 32/)
    expect(css).toMatch(/body\.explore-fullbleed \.sidebar-toggle[^}]*z-index: 37[^}]*pointer-events: auto/)
  })

  it('keeps selected nav borders and both icons within the rail', () => {
    expect(css).toMatch(/explore-sidebar-collapsed \.desktop-nav\s*\{[^}]*width: var\(--pc-sidebar-rail-w\); padding-inline: var\(--sp-8\)/)
    expect(css).toMatch(/explore-sidebar-collapsed \.desktop-nav button\s*\{[^}]*width: 100%; min-width: 0; padding-inline: 0; gap: 0;[^}]*justify-content: center; align-items: center/)
    expect(css).toMatch(/explore-sidebar-collapsed \.brand\s*\{[^}]*justify-content: center; padding: 0; gap: 0/)
    expect(css).toMatch(/explore-sidebar-collapsed \.explore-side-panel\s*\{[^}]*visibility: hidden; pointer-events: none/)
  })
})

describe('sidebar icons keep the same x when opening and closing (11/10)', () => {
  const block = css.slice(css.lastIndexOf('PCサイドバーのアイコン列'))
  it('puts the brand mark center on the rail center in both states', () => {
    // 32pxのマークを rail/2 - 16px から置く＝中心が rail/2（28px）。開閉の両方のセレクタに効かせる。
    expect(block).toMatch(/body\.explore-fullbleed \.brand,[\s\S]*body\.explore-fullbleed\.explore-sidebar-collapsed \.brand \{[^}]*justify-content: flex-start; padding-left: calc\(var\(--pc-sidebar-rail-w\) \/ 2 - 16px\)/)
  })
  it('puts the 18px nav icons (half = sp-8 + 1px) on the rail center in both states and keeps the selected box inside the rail', () => {
    expect(block).toMatch(/body\.explore-fullbleed \.desktop-nav \{ padding-inline: var\(--sp-8\); \}/)
    expect(block).toMatch(/body\.explore-fullbleed\.explore-sidebar-collapsed \.desktop-nav button \{[^}]*justify-content: flex-start; border: var\(--ui-border-width\) solid transparent;[^}]*padding-left: calc\(var\(--pc-sidebar-rail-w\) \/ 2 - var\(--sp-8\) - var\(--sp-8\) - 1px - var\(--ui-border-width\)\)/)
    // 閉じた列のボタンは 8px + 幅100%（rail - 16px）で列内に収まる。
    expect(css).toMatch(/explore-sidebar-collapsed \.desktop-nav \{[^}]*width: var\(--pc-sidebar-rail-w\); padding-inline: var\(--sp-8\)/)
  })
})
