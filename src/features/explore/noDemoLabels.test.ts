import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()

/** UIソース（テスト・CSS以外）から、表示に出うる文字列リテラル内の「デモ」を拾う。 */
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === 'coverage') continue
    const path = join(dir, name)
    const st = statSync(path)
    if (st.isDirectory()) walk(path, out)
    else if (/\.(tsx|ts|html)$/.test(name) && !/\.test\./.test(name) && !/\.spec\./.test(name)) out.push(path)
  }
  return out
}

const STRING_RE = /(['"`])(?:\\.|(?!\1)[\s\S])*?\1/g

describe('no traveler/admin display strings contain デモ', () => {
  it('production UI sources have no デモ inside string literals', () => {
    const files = [
      ...walk(join(ROOT, 'src')),
      join(ROOT, 'index.html'),
    ]
    const hits: string[] = []
    for (const file of files) {
      const text = readFileSync(file, 'utf8')
      // Skip pure type/identifier files? Still scan — but allow comments outside strings.
      for (const match of text.matchAll(STRING_RE)) {
        const lit = match[0]
        if (!lit.includes('デモ')) continue
        // CSS class names / paths that are not visible copy are still in strings —
        // allow only known non-visible identifiers if any slip in. Currently none should.
        const rel = relative(ROOT, file)
        hits.push(`${rel}: ${lit.slice(0, 80)}`)
      }
    }
    expect(hits, hits.join('\n')).toEqual([])
  })
})
