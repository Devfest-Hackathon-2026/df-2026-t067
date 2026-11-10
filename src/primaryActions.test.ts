import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const traveler = readFileSync('src/App.css', 'utf8')
const admin = readFileSync('src/features/admin/admin.css', 'utf8')

function sheet(css: string) {
  const style = document.createElement('style')
  style.textContent = css.replace(/^@import[^;]+;/gm, '')
  document.head.append(style)
  const rules = Array.from(style.sheet!.cssRules)
  style.remove()
  return rules
}
function declarations(rules: CSSRule[], selector: string): CSSStyleDeclaration[] {
  return rules.flatMap(rule => {
    if ('selectorText' in rule) {
      const styleRule = rule as CSSStyleRule
      return styleRule.selectorText.split(',').map(s => s.trim()).includes(selector) ? [styleRule.style] : []
    }
    return []
  })
}
function last(rules: CSSRule[], selector: string, property: string) {
  return declarations(rules, selector).map(style => style.getPropertyValue(property)).filter(Boolean).at(-1)
}
function media(rules: CSSRule[], query: string) {
  return rules.flatMap(rule => 'conditionText' in rule && (rule as CSSMediaRule).conditionText === query
    ? Array.from((rule as CSSMediaRule).cssRules) : [])
}

describe('主ボタンの形と配置', () => {
  const travelerRules = sheet(traveler)
  const adminRules = sheet(admin)
  it('文字の主操作はパネル幅にする', () => {
    expect(last(travelerRules, '.primary-button', 'width')).toBe('100%')
    expect(last(travelerRules, '.primary-button:not(.camera-shutter)', 'width')).toBe('100%')
    for (const selector of ['.admin-demo .workflow-primary', '.admin-demo .submit-button']) {
      expect(last(adminRules, selector, 'width')).toBe('100%')
    }
  })
  it('シャッターは指定順とスマホ・PCの共通幅指定に影響されず中央の64px円を保つ', () => {
    const overlay = document.createElement('div')
    overlay.className = 'camera-panel camera-overlay'
    const shutter = document.createElement('button')
    shutter.className = 'primary-button camera-shutter'
    overlay.append(shutter)
    // ソース順に適用候補を集める。メディア規則は各画面幅で別々に確認する。
    for (const query of ['(max-width: 980px)', '(min-width: 981px)']) {
      const rules = travelerRules.flatMap(rule => 'conditionText' in rule
        ? (rule as CSSMediaRule).conditionText === query ? Array.from((rule as CSSMediaRule).cssRules) : []
        : [rule])
      const matching = rules.filter((rule): rule is CSSStyleRule => 'selectorText' in rule
        && shutter.matches((rule as CSSStyleRule).selectorText))
      for (const [property, value] of [['width', '64px'], ['height', '64px'], ['min-height', '64px'], ['border-radius', '50%'], ['padding', '0px']]) {
        expect(matching.map(rule => rule.style.getPropertyValue(property)).filter(Boolean).at(-1)).toBe(value)
      }
      // 作業9の共通幅ルールは、後ろに移動してもシャッターには一致しない。
      const fullWidthRules = rules.filter((rule): rule is CSSStyleRule => 'selectorText' in rule
        && (rule as CSSStyleRule).selectorText.includes(':not(.camera-shutter)')
        && (rule as CSSStyleRule).style.getPropertyValue('width') === '100%')
      expect(fullWidthRules.length).toBeGreaterThan(0)
      for (const rule of fullWidthRules) expect(shutter.matches(rule.selectorText)).toBe(false)
    }
    expect(last(travelerRules, '.camera-overlay .camera-shutter-controls', 'justify-content')).toBe('center')
  })
  it('PCの主操作と保存欄は画面下に固定しない', () => {
    for (const [rules, selectors] of [
      [travelerRules, ['.primary-button:not(.camera-shutter)', '.camera-panel .primary-button:not(.camera-shutter)', '.clear-screen-actions .primary-button']],
      [adminRules, ['.admin-demo .workflow-primary', '.admin-demo .submit-button', '.admin-demo .admin-save-bar']],
    ] as const) {
      for (const selector of selectors) {
        expect(last(media([...rules], '(min-width: 981px)'), selector, 'position')).toBe('static')
      }
    }
  })
  it('スマホでは主操作をシート・操作欄の下端へ寄せる', () => {
    const rules = media(travelerRules, '(max-width: 980px)')
    expect(last(rules, '.quest-details > .primary-button', 'margin-top')).toBe('auto')
    expect(last(rules, '.camera-panel.camera-overlay > .camera-actions', 'margin-top')).toBe('auto')
    expect(last(rules, '.owner-records > .primary-button', 'margin-top')).toBe('auto')
    expect(admin).toMatch(/\.admin-demo \.admin-save-bar \{[^}]*padding: 0 0 env\(safe-area-inset-bottom, 0px\)/)
    expect(last(rules, 'body.explore-fullbleed .explore-sheet', 'bottom')).toBe('var(--mobile-tabbar-h)')
    expect(traveler).toContain('--mobile-tabbar-h: calc(64px + env(safe-area-inset-bottom, 0px))')
  })
  it('主ボタンに黄色の役割を使う', () => {
    expect(last(travelerRules, '.primary-button', 'background')).toBe('var(--role-primary)')
    expect(last(adminRules, '.admin-managed .workflow-primary', 'background')).toBe('var(--role-primary)')
  })
  it('ナビ・一覧操作・工程の副操作を黄色にしない', () => {
    for (const selector of ['.traveler-shell .quest-toggle', 'body.explore-fullbleed .explore-sheet-reopen', '.quest-details:has(.camera-panel) > .primary-button', '.camera-actions:has(.primary-button) ~ .camera-actions > .primary-button']) {
      expect(last(travelerRules, selector, 'background')).toBe('var(--ui-surface)')
    }
    expect(last(travelerRules, '.traveler-shell .mobile-nav button[aria-current="page"]', 'background')).toBe('transparent')
    expect(last(adminRules, '.admin-workflow:has(.workflow-primary) .submit-button', 'background')).toBe('var(--ui-surface)')
  })
})
