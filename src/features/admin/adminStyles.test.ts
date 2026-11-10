import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync('src/features/admin/admin.css', 'utf8')

// These contracts cover the later managed/workflow overrides as well as the base form.
describe('管理画面の見た目の規則', () => {
  it('ブランドリンクは旅行者と同じ文字色・フォントで下線を付けず、フォーカスを残す', () => {
    const brand = css.match(/\.admin-demo \.brand \{([^}]+)\}/)?.[1]
    expect(brand).toContain('color: var(--ui-ink);')
    expect(brand).toContain('text-decoration: none;')
    expect(brand).toContain('font-family: inherit;')
    expect(css).toContain('.admin-demo :focus-visible { outline: 3px solid var(--ui-focus);')
    expect(brand).not.toMatch(/outline\s*:/)
  })
  it('外枠をページ上端のヘッダーの下端から12px以上離し、見出しは枠内の通常配置に残す', () => {
    // PC: account 10 + 44 + 12 = 66、スマホ: brand 16 + 44 + 12 = 72。
    const desktop = css.slice(0, css.lastIndexOf('@media (max-width: 980px)'))
    const desktopSpacing = desktop.match(/\.admin-demo,\s*\.admin-demo\.admin-managed \{([^}]+)\}/)?.[1]
    expect(desktopSpacing).toContain('margin-top: calc(64px + 2px + env(safe-area-inset-top, 0px));')
    expect(desktopSpacing).toContain('min-height: calc(100vh - 64px - 2px - env(safe-area-inset-top, 0px));')
    // 詳細度の高い旧24px規則を残すと、通常のadmin-demoだけの検査では見逃す。
    expect(css).not.toMatch(/(?:^|[{}])\s*\.admin-demo\.admin-managed\s*\{[^}]*(?:margin(?:-top)?|min-height)\s*:/)
    const mobile = css.slice(css.lastIndexOf('@media (max-width: 980px)'))
    const mobileSpacing = mobile.match(/\.admin-demo,\s*\.admin-demo\.admin-managed \{([^}]+)\}/)?.[1]
    expect(mobileSpacing).toContain('margin-top: calc(64px + 8px + env(safe-area-inset-top, 0px));')
    expect(mobileSpacing).toContain('min-height: calc(100vh - 64px - 8px - env(safe-area-inset-top, 0px));')
    expect(css).toContain('.admin-demo > .admin-header { padding-top: 0; }')
    expect(css.match(/\.admin-demo > \.admin-header \{[^}]+\}/g)).toEqual([
      '.admin-demo > .admin-header { padding-top: 0; }',
    ])
    const workspace = readFileSync('src/features/admin/LocalAdminWorkspace.tsx', 'utf8')
    expect(workspace).toMatch(/<main className=\{[^\n]+\}>\s*<header[^>]+>[\s\S]*?<h1>謎づくり<\/h1>[\s\S]*?<\/header>/)
  })
  it('管理画面の上余白をroot内に閉じ込め、body/htmlに帯を出さない', () => {
    const root = css.match(/#root:has\(> main\.admin-demo\) \{([^}]+)\}/)?.[1]
    expect(root).toContain('display: flow-root;')
    const html = css.match(/html:has\(main\.admin-demo\) \{([^}]+)\}/)?.[1]
    expect(html).toContain('background: var(--ui-blue, #c5e8f5);')
  })
  it('PCのブランドは透明・枠なし、スマホは白いピルを保つ', () => {
    const desktop = css.slice(0, css.lastIndexOf('@media (max-width: 980px)'))
    const brand = desktop.match(/\.admin-demo \.brand \{([^}]+)\}/)?.[1]
    expect(brand).toContain('background: transparent;')
    expect(brand).toContain('border: 0;')
    expect(brand).toContain('width: 220px; height: 52px;')
    const mobile = css.slice(css.lastIndexOf('@media (max-width: 980px)'))
    const pill = mobile.match(/\.admin-demo \.brand \{([^}]+)\}/)?.[1]
    expect(pill).toContain('background: var(--ui-surface);')
    expect(pill).toContain('border: var(--ui-border-width) solid var(--ui-line);')
  })
  it('写真選択は他の入力と同じ8px間隔でラベルの下に置く', () => {
    const rule = css.match(/\.admin-demo \.photo-picker \{([^}]+)\}/)?.[1]
    expect(rule).toContain('display: flex;')
    expect(rule).toContain('flex-direction: column;')
    expect(rule).toContain('gap: 8px;')
    expect(rule).toContain('align-items: start;')
    expect(css).toContain('.photo-picker:has(input:focus-visible) .photo-picker-button { outline: 3px solid var(--ui-focus); outline-offset: 2px; }')
  })
  it('場所の先頭fieldsetは外側の箱に余分な上余白を足さない', () => {
    const fieldset = css.match(/\.admin-workflow #workflow-spot > fieldset \{([^}]+)\}/)?.[1]
    expect(fieldset).toContain('margin: 0;')
    expect(fieldset).toContain('padding: 0;')
    const legend = css.match(/\.admin-workflow #workflow-spot > fieldset > legend \{([^}]+)\}/)?.[1]
    expect(legend).toContain('padding: 0;')
    expect(legend).toContain('margin: 0 0 12px;')
  })
  it('共有・永続カードは黒2px、角丸16、影なし', () => {
    expect(css).toContain('.admin-managed .form-section { border: 2px solid var(--ui-line); border-radius: 16px; box-shadow: none; }')
    expect(css).toContain('--ui-shadow: none; --ui-control-shadow: none;')
    expect(css.replace(/\.admin-demo \.google-continue \{[^}]+\}/g, '')).not.toMatch(/border(?:-top)?: 1px|border-width: 1px|#e2e5e9/)
  })
  it('主操作は黄色、48px、副操作は44px以上・角丸12', () => {
    expect(css).toContain('.admin-managed .workflow-primary { background: var(--role-primary); color: var(--ui-accent-ink); border-color: var(--ui-line); }')
    expect(css).toMatch(/\.admin-demo \.workflow-primary \{ min-height: 48px; \}/)
    expect(css).toMatch(/\.admin-demo button,\s*\.admin-demo input::file-selector-button \{ min-height: 44px; border-radius: 12px; \}/)
  })
  it('入力欄は44px以上、角丸12でキーボードフォーカスを示す', () => {
    expect(css).toMatch(/\.admin-demo select \{ min-height: 44px;/)
    expect(css).toMatch(/\.admin-demo select \{ border-radius: 12px; \}/)
    expect(css).toContain('.admin-demo :focus-visible { outline: 3px solid var(--ui-focus);')
    expect(css).toContain('.admin-demo [aria-invalid="true"]')
  })
  it('余白はPC24px・スマホ16pxで、工程内の面も16pxを保つ', () => {
    expect(css).toContain('padding: 24px 24px 64px')
    expect(css).toContain('.form-section, .traveler-card { padding: 16px; }')
    expect(css).toContain('padding: 16px 16px 48px')
    expect(css).toContain('.admin-workflow .form-section { padding: 16px; }')
  })
  it('ブランドとアカウントはページ上端で旅行者と同じ位置、戻ると写真のフォーカスは保持する', () => {
    const account = css.match(/\.admin-demo \.admin-account-trigger \{([^}]+)\}/g)?.at(-1)
    expect(account).toContain('background: var(--ui-surface);')
    expect(account).toContain('color: var(--ui-ink);')
    expect(css).toContain('width: 220px; height: 52px;')
    expect(css).toContain('top: calc(10px + env(safe-area-inset-top, 0px)); right: 20px;')
    expect(css).toContain('top: calc(6px + env(safe-area-inset-top, 0px)); right: 10px;')
    expect(css).toContain('top: calc(16px + env(safe-area-inset-top, 0px)); left: 16px;')
    expect(css).toContain('width: 44px; height: 44px; min-height: 44px; padding: 0;')
    expect(css).toContain('.photo-picker:has(input:focus-visible) .photo-picker-button')
    expect(css).toContain('.admin-workflow .form-section fieldset,')
    expect(css).toContain('.admin-workflow fieldset fieldset { border: 0;')
  })
  it('PC・スマホのブランドとアカウントはabsoluteでスクロールと一緒に流れ、fixedに戻らない', () => {
    const header = css.slice(css.indexOf('/* D-47:'))
    for (const selector of ['\\.admin-demo \\.brand', '\\.admin-demo \\.admin-header-actions']) {
      const rules = [...header.matchAll(new RegExp(`${selector} \\{([^}]+)\\}`, 'g'))]
      expect(rules.length).toBe(2)
      expect(rules[0][1]).toMatch(/position:\s*absolute\s*;/)
      for (const rule of rules) {
        expect(rule[1]).not.toMatch(/position:\s*fixed\b/)
      }
    }
    // 途中の祖先を配置基準にせず、ページ上端の座標を維持する。
    for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (rule[1].split(',').some((selector) => /^(?:main)?\.admin-demo(?:\.admin-managed)?$|^\.admin-header$|^\.admin-demo\s*>?\s*\.admin-header$|^#root(?::has\(> main\.admin-demo\))?$/.test(selector.trim()))) {
        expect(rule[2]).not.toMatch(/position:\s*(?:relative|absolute|fixed|sticky)\b/)
      }
    }
  })
})
