import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(resolve(process.cwd(), 'src/App.css'), 'utf8')

function firstBlock(selector: string): string {
  const start = css.indexOf(selector)
  expect(start, selector).toBeGreaterThanOrEqual(0)
  const open = css.indexOf('{', start)
  const close = css.indexOf('}', open)
  return css.slice(open + 1, close)
}

describe('account icon slot (t154u)', () => {
  it('pins the account control to a shared fixed slot size and position tokens', () => {
    expect(css).toContain('--account-slot-top:')
    expect(css).toContain('--account-slot-right:')
    expect(css).toContain('--account-slot-size: 44px')
    const area = firstBlock('.account-area {')
    expect(area).toContain('position: fixed')
    expect(area).toContain('top: var(--account-slot-top)')
    expect(area).toContain('right: var(--account-slot-right)')
    const button = firstBlock('.account-icon-button {')
    expect(button).toContain('width: var(--account-slot-size)')
    expect(button).toContain('height: var(--account-slot-size)')
  })

  it('keeps the shared account slot visible in mobile quest detail', () => {
    expect(css).not.toContain('body.explore-fullbleed:has(.explore-quest-detail-wrap.is-open) .account-area')
    expect(css).not.toContain('body.explore-fullbleed:has(.quest-card.is-open) .account-area')
  })

  it('does not override account top/right per screen so map/records/clear stay aligned', () => {
    const overrides = [...css.matchAll(/\.account-area \{([^}]*)\}/g)].map((match) => match[1])
    expect(overrides.length).toBeGreaterThan(0)
    for (const body of overrides) {
      if (body.includes('--account-slot')) continue
      expect(body).not.toMatch(/(?:^|;|\s)top\s*:/)
      expect(body).not.toMatch(/(?:^|;|\s)right\s*:/)
      expect(body).not.toMatch(/(?:^|;|\s)width\s*:/)
      expect(body).not.toMatch(/(?:^|;|\s)height\s*:/)
    }
  })

  it('uses one mobile slot token pair for both fullbleed map and records headers', () => {
    expect(css).toContain('--account-slot-top: calc(6px + env(safe-area-inset-top, 0px))')
    expect(css).toContain('--account-slot-right: 10px')
    // 記録画面ヘッダーの padding は残ってよいが、account-area の top/right 上書きは無い。
    const recordsHeader = css.slice(css.indexOf('body:has(.traveler-shell) .site-header { background: transparent'))
    expect(recordsHeader.split('}')[0]).not.toContain('.account-area')
  })
})
