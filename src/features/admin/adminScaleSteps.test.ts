import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync('src/features/admin/admin.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
const fontSteps = [12, 14, 16, 20, 24, 28]
const spaceSteps = [0, 1, 2, 3, 4, 8, 12, 16, 24, 32, 48, 64]
// 既存の非表示と旧固定バーの重なり防止を保つ。セレクタ・プロパティ・値を限定する。
const exceptions = [
  { selector: '.admin-demo input.reference-photo-input', property: 'font-size', value: '0', reason: '日本語の写真選択UIでネイティブのファイル名を隠す' },
  { selector: '.admin-demo .photo-picker input[type="file"]', property: 'margin', value: '-1px', reason: 'キーボード操作可能な視覚的非表示の入力を保つ' },
  { selector: '.admin-workflow', property: 'padding-bottom', value: '176px', reason: '旧固定保存バーの予約領域。後続の静的バー指定で上書きされる' },
]

describe('管理CSSの文字と余白の段階', () => {
  it('文字は6段、余白は8段と微小値に限定する', () => {
    const usedExceptions = new Set<string>()
    for (const [, selectorText, body] of rules) {
      const selector = selectorText.trim()
      for (const declaration of body.split(';')) {
        const match = declaration.trim().match(/^([\w-]+):\s*(.+)$/)
        if (!match) continue
        const [, property, value] = match
        const isFont = property === 'font-size'
        if (!isFont && !/^(?:(?:padding|margin)(?:-[\w-]+)?|(?:row-|column-)?gap)$/.test(property)) continue
        const exception = exceptions.find(entry => entry.selector === selector && entry.property === property && entry.value === value)
        if (exception) {
          expect(exception.reason.length).toBeGreaterThan(0)
          usedExceptions.add(exception.reason)
          continue
        }
        if (isFont) {
          expect(value, `${selector}: ${property}`).toMatch(/^\d+px$/)
          expect(fontSteps, `${selector}: ${value}`).toContain(Number.parseFloat(value))
        } else {
          expect(value, `${selector}: ${property}`).not.toMatch(/[\d.]+(?:rem|em)\b/)
          for (const number of value.matchAll(/(-?(?:\d*\.)?\d+)px\b/g)) {
            expect(spaceSteps, `${selector}: ${property}: ${value}`).toContain(Number(number[1]))
          }
        }
      }
    }
    expect(usedExceptions.size).toBe(exceptions.length)
  })

  it('ボタンの最小高さは44pxを下回らない', () => {
    for (const [, selector, body] of rules) {
      if (!/button|\.phrase-chip/.test(selector)) continue
      for (const height of body.matchAll(/min-height:\s*(\d+)px/g)) {
        expect(Number(height[1]), selector.trim()).toBeGreaterThanOrEqual(44)
      }
    }
    expect(css).toContain('.admin-demo input[type=file] { font-size: 16px; }')
    expect(css).toContain('.admin-demo input.reference-photo-input::file-selector-button { font-size: 16px; }')
  })
})
