import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
const css = readFileSync('src/App.css', 'utf8')
it('待機キャンセルは44px以上の白い副ボタン、記録ヘッダーは固定する', () => {
  const cancel = [...css.matchAll(/\.answer-waiting-cancel\s*\{([^}]+)\}/g)].at(-1)![1]
  expect(cancel).toContain('min-height: 44px')
  expect(cancel).toContain('background: #fff')
  expect(cancel).toContain('border: 2px solid #000')
  const heading = [...css.matchAll(/\.record-dialog-heading\s*\{([^}]+)\}/g)].at(-1)![1]
  expect(heading).toContain('position: sticky')
  expect(heading).toContain('top: 0')
})
