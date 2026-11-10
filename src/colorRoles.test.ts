import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const theme = readFileSync('src/theme.css', 'utf8')
const admin = readFileSync('src/features/admin/admin.css', 'utf8')
const conditions = readFileSync('src/components/ShootingConditionIndicators.css', 'utf8')
const traveler = readFileSync('src/App.css', 'utf8')
function rules(css: string): CSSStyleRule[] {
  const style = document.createElement('style')
  style.textContent = css.replace(/^@import[^;]+;/gm, '')
  document.head.append(style)
  const result = Array.from(style.sheet!.cssRules).filter((rule): rule is CSSStyleRule => 'selectorText' in rule)
  style.remove()
  return result
}
function background(css: string, selector: string) {
  return rules(css).filter(rule => rule.selectorText.split(',').map(s => s.trim()).includes(selector))
    .map(rule => rule.style.getPropertyValue('background')).filter(Boolean).at(-1)
}

describe('色の役割', () => {
  it('地方を開くだけでは選択色を付けず、未選択県のhoverとfocusも白面にする', () => {
    for (const rule of rules(traveler).filter(rule => rule.selectorText.includes('.filter-accordion-body'))) {
      expect(rule.cssText).not.toMatch(/--role-selected(?:-soft)?/)
    }
    for (const selector of ['.filter-prefecture:hover', '.filter-prefecture:focus-visible']) {
      expect(background(traveler, selector)).toBe('var(--ui-surface)')
    }
    expect(background(traveler, '.filter-prefecture[aria-pressed="true"]')).toBe('var(--role-selected)')
  })
  it('各状態をdemoの白上書きから独立した変数にする', () => {
    for (const [status, role, color] of [
      ['draft', 'off', '#e9e8e2'], ['review_pending', 'off', '#e9e8e2'],
      ['published', 'done', '#c7ed93'], ['paused', 'off', '#e9e8e2'],
    ]) {
      expect(background(admin, `.admin-quest-status[data-status="${status}"]`)).toBe(`var(--role-${role})`)
      expect(theme).toContain(`--role-${role}: ${color};`)
      expect(admin).not.toContain(`--role-${role}:`)
    }
    expect(admin).toContain('--ui-tint: #fff')
    expect(admin).toContain('--ui-soft: #fff')
  })
  it('黄の地は主操作だけに限定する', () => {
    for (const css of [theme, admin, traveler, conditions]) {
      for (const rule of rules(css)) {
        const bg = rule.style.getPropertyValue('background') + rule.style.getPropertyValue('background-color')
        expect(bg).not.toMatch(/#ffe66b|#fff3bb|var\(--ui-soft\)|var\(--ui-accent(?:-hover)?[,)]/)
        if (bg.includes('--role-primary')) {
          for (const selector of rule.selectorText.split(',')) {
            expect(selector).toMatch(/primary-button|submit-button|workflow-primary|api-load-state > button/)
          }
        }
      }
    }
  })
  it('入力エラーだけにピンク地と赤枠を付け、旅行者のエラー文は塗らない', () => {
    expect(background(admin, '.admin-demo input[aria-invalid="true"]:not([type=checkbox]):not([type=file]):not([type=radio])')).toBe('var(--role-error-bg)')
    expect(admin).toMatch(/\.admin-demo input\[aria-invalid="true"\][^}]+border-color: var\(--ui-error\)/)
    expect(background(traveler, '.camera-error')).toBeUndefined()
    expect(background(traveler, '.auth-feedback[role="alert"]')).toBeUndefined()
    expect(background(admin, '.admin-demo .save-success')).toBe('var(--role-done)')
  })
  it('管理のピンク地は入力要素だけに限定する', () => {
    const selectors = rules(admin)
      .filter(rule => rule.style.getPropertyValue('background') === 'var(--role-error-bg)')
      .flatMap(rule => rule.selectorText.split(',').map(selector => selector.trim()))
    const expected = ['.admin-demo', '.admin-editor'].flatMap(scope => [
      `${scope} input[aria-invalid="true"]:not([type=checkbox]):not([type=file]):not([type=radio])`,
      `${scope} textarea[aria-invalid="true"]`,
      `${scope} select[aria-invalid="true"]`,
    ])
    expect(selectors.sort()).toEqual(expected.sort())
    for (const tag of ['section', 'fieldset', 'div']) {
      const section = document.createElement(tag)
      section.setAttribute('aria-invalid', 'true')
      const editor = document.createElement('div')
      editor.className = 'admin-editor'
      editor.append(section)
      expect(selectors.some(selector => section.matches(selector))).toBe(false)
    }
  })
  it('撮影のエラー文は地を塗らず赤文字にする', () => {
    const selector = '.camera-actions > .answer-result[role="alert"]'
    expect(background(traveler, selector)).toBe('transparent')
    expect(rules(traveler).find(rule => rule.selectorText === selector)?.style.color).toBe('var(--ui-error)')
  })
  it('選択地域の「地名×」チップ用の色は出さない', () => {
    const selector = '.map-filter-selection .filter-chip'
    expect(rules(traveler).every(rule => !rule.selectorText.split(',').map(s => s.trim()).includes(selector))).toBe(true)
  })
  it('結果と待機に役割色を付ける', () => {
    expect(background(traveler, '.answer-result')).toBe('var(--ui-surface)')
    expect(background(traveler, '.answer-result[data-outcome="CORRECT"]::before')).toBe('var(--role-done)')
    expect(background(traveler, '.camera-panel .answer-waiting')).toBe('var(--role-off)')
    expect(background(traveler, '.answer-result:not([data-outcome])')).toBe('var(--role-off)')
  })
})

// WCAG 2.x: sRGBを線形化して相対輝度を求める。丸める前の値で判定する。
function contrast(a: string, b: string) {
  const luminance = (hex: string) => {
    const [r, g, b] = hex.slice(1).match(/../g)!.map(channel => {
      const value = parseInt(channel, 16) / 255
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (values[0] + 0.05) / (values[1] + 0.05)
}
function token(name: string) {
  return theme.match(new RegExp(`--${name}: (#[0-9a-f]{6});`))![1]
}

describe('作業13c: 実際の文字と枠のコントラスト', () => {
  const surfaces = ['ui-surface', 'role-done', 'role-selected', 'role-selected-soft',
    'role-error-bg', 'role-off', 'ui-accent', 'role-hover']
  it.each(surfaces)('%s 上の黒文字と黒枠を読める', surface => {
    expect(contrast(token('ui-ink'), token(surface))).toBeGreaterThanOrEqual(4.5)
    expect(contrast('#000000', token(surface))).toBeGreaterThanOrEqual(4.5)
    expect(contrast(token('ui-line'), token(surface))).toBeGreaterThanOrEqual(3)
  })
  it.each(surfaces.filter(surface => surface !== 'ui-accent'))('%s 上の補助文字を読める', surface => {
    expect(contrast(token('ui-muted'), token(surface))).toBeGreaterThanOrEqual(4.5)
  })
  it('ピンク上の赤は枠に使い、入力文字は黒にする', () => {
    expect(contrast(token('ui-error'), token('role-error-bg'))).toBeLessThan(4.5)
    expect(contrast(token('ui-error'), token('role-error-bg'))).toBeGreaterThanOrEqual(3)
    expect(contrast(token('ui-error'), token('ui-surface'))).toBeGreaterThanOrEqual(4.5)
    const selector = '.admin-demo input[aria-invalid="true"]:not([type=checkbox]):not([type=file]):not([type=radio])'
    const invalid = rules(admin).find(rule => rule.style.background === 'var(--role-error-bg)' && rule.selectorText.includes(selector))!
    expect(invalid.style.color).toBe('var(--ui-ink)')
    expect(invalid.style.borderColor).toBe('var(--ui-error)')
  })
  it('ホバーに成功の緑を使わない', () => {
    for (const selector of ['.map-locate-fab:hover:not(:disabled)', '.map-zoom button:hover:not(:disabled)']) {
      expect(background(traveler, selector)).toBe('var(--role-hover)')
    }
    expect(background(traveler, '.retry-button:hover')).toBe('rgb(255, 255, 255)')
  })
})

it('撮影条件と地図なしの候補は白い面を使う（方針差分2）', () => {
  expect(background(conditions, '.condition-indicator')).toBe('var(--ui-surface)')
  expect(background(traveler, '.api-quest-picker')).toBe('var(--ui-surface)')
})

it('記録の外枠を外し、クリアバッジは共通の枠・余白にする（方針差分3・6）', () => {
  const record = rules(traveler).find(rule => rule.selectorText === '.owner-records')!
  expect(record.style.background).toBe('transparent')
  expect(record.style.border).toBe('0px')
  expect(record.style.padding).toBe('0px')
  const badge = rules(traveler).find(rule => rule.selectorText === '.quest-cleared-label')!
  expect(badge.style.display).toBe('inline-flex')
  expect(badge.style.padding).toBe('var(--sp-4) var(--sp-8)')
  expect(badge.style.border).toBe('var(--ui-border-width) solid var(--ui-line)')
  expect(background(traveler, '.explore-row-icon.is-cleared')).toBe('var(--role-done)')
})

it('クリアと不正解は白いカードの上端だけに役割色を使う', () => {
  expect(background(traveler, '.clear-screen-card')).toBe('var(--ui-surface)')
  expect(background(traveler, '.clear-screen-card::before')).toBe('var(--role-done)')
  // 判定結果は面を塗らず、上端の帯だけ: 正解・クリア済みは黄緑、それ以外の結果はピンク。
  expect(background(traveler, '.answer-result[data-outcome]::before')).toBe('var(--ui-badge)')
  expect(background(traveler, '.answer-result[data-outcome]')).toBeUndefined()
  expect(background(traveler, '.answer-result[data-outcome="CORRECT"]')).toBeUndefined()
  for (const selector of ['.clear-screen-card::before', '.answer-result[data-outcome]::before']) {
    const band = rules(traveler).find(rule => rule.selectorText === selector)!
    expect(band.style.height).toBe('10px')
    expect(band.style.top).toBe('0px')
  }
  expect(background(traveler, '.record-empty-icon')).toBe('var(--role-done)')
  expect(background(traveler, '.clear-screen-card .clear-celebration-badge')).toBe('var(--role-done)')
})
it('地図の出典を透過せずAAの文字色とし、行の題名を太くする', () => {
  for (const bg of ['#faf8f1', '#ffffff']) expect(contrast(token('ui-muted'), bg)).toBeGreaterThanOrEqual(4.5)
  expect(traveler).not.toMatch(/\.map-boundary-credit[^}]*opacity:/)
  expect(rules(traveler).find(rule => rule.selectorText === '.traveler-row-title')!.style.fontWeight).toBe('700')
})
