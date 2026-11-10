import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { renderToString } from 'react-dom/server'
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderBoot } from '../../prerender'
import { TeamPreview } from '../quests/TeamPreview'
import { PrerenderViewport } from '../quests/useWideViewport'

// Restore browser globals before the shared jsdom cleanup hook.
afterEach(() => vi.unstubAllGlobals())

const template = readFileSync(resolve('index.html'), 'utf8')

describe('React boot prerender without browser globals', () => {
  it('leaves a build insertion point instead of maintaining duplicate icons and CSS', () => {
    expect(template).toContain('<!--prerender-->')
    expect(template).not.toContain('boot-shell')
    expect(template).not.toContain('<svg')
    expect(template).not.toContain('<style>')
  })

  it('renders both actual responsive trees without window, Firebase startup or network', () => {
    vi.stubEnv('VITE_QUEST_DATA_SOURCE', 'team-preview')
    const fetch = vi.fn(() => { throw new Error('SSR must not fetch') })
    vi.stubGlobal('fetch', fetch)
    vi.stubGlobal('window', undefined)
    vi.stubGlobal('document', undefined)
    expect(typeof window).toBe('undefined')
    const { html, fullbleed } = renderBoot()
    expect(fullbleed).toBe(true)
    expect(html).toContain('prerender-pc')
    expect(html).toContain('prerender-mobile')
    expect(html.match(/class="brand-mark"/g)).toHaveLength(2)
    const marks = [...html.matchAll(/<span class="brand-mark">(.*?)<\/span>/g)]
    expect(marks).toHaveLength(2)
    for (const [, content] of marks) {
      expect(content).toContain('<img src="/favicon.svg" alt="" aria-hidden="true"')
      expect(content).not.toContain('<svg')
    }
    expect(html.match(/class="account-icon-button"/g)).toHaveLength(2)
    expect(html).toContain('explore-side-panel')
    expect(html).toContain('explore-sheet')
    expect(html).toContain('sidebar-toggle')
    expect(html).toContain('explore-quest-skeleton')
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each([true, false])('uses the same TeamPreview components for wide=%s', (wide) => {
    vi.stubEnv('VITE_QUEST_DATA_SOURCE', 'team-preview')
    vi.stubGlobal('window', undefined)
    vi.stubGlobal('document', undefined)
    const actual = renderToString(createElement(PrerenderViewport, { value: wide }, createElement(TeamPreview)),
      { identifierPrefix: wide ? 'boot-pc-' : 'boot-mobile-' })
    expect(renderBoot().html).toContain(actual)
  })

  it('also renders the existing offline entry for a default build', () => {
    vi.stubEnv('VITE_QUEST_DATA_SOURCE', '')
    vi.stubGlobal('window', undefined)
    vi.stubGlobal('document', undefined)
    const { html, fullbleed } = renderBoot()
    expect(fullbleed).toBe(false)
    expect(html).toContain('NAZOP')
    expect(html).toContain('mobile-nav')
  })
})
