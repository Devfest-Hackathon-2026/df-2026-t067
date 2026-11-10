import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const fontSteps = [12, 14, 16, 20, 24, 28]
const spaceSteps = [4, 8, 12, 16, 24, 32, 48, 64]
const files = ['src/theme.css', 'src/App.css', ...readdirSync('src/components')
  .filter(name => name.endsWith('.css')).map(name => `src/components/${name}`)]
const theme = readFileSync('src/theme.css', 'utf8')
// Exact declarations only: dimensions of existing chrome are not spacing rhythm.
const exceptions = new Map([
  ['padding: var(--sp-16) max(var(--sp-32), calc((100% - 1440px) / 2))', '中央コンテナの最大幅'],
  ['padding: var(--sp-16) var(--sp-12) calc(var(--mobile-tabbar-h, 70px) + var(--sp-16))', '既存タブバー高さのフォールバック'],
  ['padding-bottom: calc(90px + env(safe-area-inset-bottom))', '固定ナビとの重なり防止'],
  ['padding-bottom: calc(104px + env(safe-area-inset-bottom))', '固定ナビとの重なり防止'],
  ['padding-bottom: calc(var(--mobile-tabbar-h) + 120px)', '地図上の固定操作欄の退避領域'],
  ['padding-bottom: calc(var(--mobile-tabbar-h, 70px) + 120px)', '固定操作欄と既存タブバー高さ'],
  ['margin: calc(80px + env(safe-area-inset-top)) var(--sp-16) calc(var(--mobile-tabbar-h) + var(--sp-16))', '固定ヘッダーとナビの間の表示領域'],
  ['margin-top: calc(var(--map-filter-bottom, 112px) + var(--sp-12))', 'フィルター下端の位置フォールバック'],
  ['padding: calc(env(safe-area-inset-top, 0px) + 68px) var(--sp-12) var(--sp-12)', '固定アカウント操作と干渉しない上端領域'],
  ['margin-top: clamp(var(--sp-32), 12vh, 120px)', 'ログイン見出しの画面高に応じた既存配置'],
])

function declarations(css: string) {
  return [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(?:^|[;{])\s*([\w-]+)\s*:\s*([^;{}]+)/g)]
    .map(match => ({ property: match[1], value: match[2].trim() }))
}

describe('旅行者・共通CSSの文字と余白の段階（admin.cssは対象外）', () => {
  it('共有トークンを指定のpx値で定義する', () => {
    for (const [prefix, steps] of [['fs', fontSteps], ['sp', spaceSteps]] as const) {
      for (const step of steps) expect(theme).toContain(`--${prefix}-${step}: ${step}px;`)
    }
  })

  it('font-sizeと余白のリテラル・参照トークンが段階に収まる', () => {
    const usedExceptions = new Set<string>()
    for (const file of files) {
      for (const { property, value } of declarations(readFileSync(file, 'utf8'))) {
        const font = property === 'font-size'
        if (!font && !/^(?:(?:padding|margin)(?:-[\w-]+)?|(?:row-|column-)?gap)$/.test(property)) continue
        const key = `${property}: ${value}`
        if (file === 'src/App.css' && exceptions.has(key)) {
          expect(exceptions.get(key)).toBeTruthy()
          usedExceptions.add(key)
          continue
        }
        const allowed = font ? fontSteps : [0, 1, 2, 3, ...spaceSteps]
        for (const match of value.matchAll(/(-?\d*\.?\d+)px\b/g)) {
          expect(allowed, `${file}: ${key}`).toContain(Math.abs(Number(match[1])))
        }
        expect(value, `${file}: ${key}`).not.toMatch(/\d(?:rem|em|vw)\b/)
        for (const match of value.matchAll(/var\(--(fs|sp)-(\d+)\)/g)) {
          expect(match[1]).toBe(font ? 'fs' : 'sp')
          expect(font ? fontSteps : spaceSteps).toContain(Number(match[2]))
        }
      }
    }
    expect([...usedExceptions].sort()).toEqual([...exceptions.keys()].sort())
  })

  it('入力の文字は16pxを確保し、共通ボタンの最小44pxを保つ', () => {
    expect(theme).toContain('input, textarea, select { font-size: var(--fs-16); }')
    expect(theme).toContain('min-height: 44px;')
  })
})
