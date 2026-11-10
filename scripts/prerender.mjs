import assert from 'node:assert/strict'
import { build } from 'vite'
import { parseArgs } from 'node:util'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const { values } = parseArgs({ options: { outDir: { type: 'string', default: 'dist' }, mode: { type: 'string', default: 'production' } } })
const outDir = resolve(values.outDir)
await build({ mode: values.mode, build: { outDir } })
const temporary = await mkdtemp(resolve('.prerender-'))
try {
  await build({ mode: values.mode, build: { ssr: 'src/prerender.tsx', outDir: temporary, emptyOutDir: true }, logLevel: 'warn' })
  const { renderBoot } = await import(pathToFileURL(join(temporary, 'prerender.js')))
  const { html, fullbleed } = renderBoot()
  const file = join(outDir, 'index.html')
  let document = await readFile(file, 'utf8')
  // Include the actual app CSS in the head; async route imports must not delay first paint.
  const manifest = JSON.parse(await readFile(join(outDir, '.vite/manifest.json'), 'utf8'))
  const styles = new Set()
  const visited = new Set()
  function collect(key) {
    if (visited.has(key)) return
    visited.add(key)
    const entry = manifest[key]
    if (!entry) throw new Error(`Missing prerender CSS entry: ${key}`)
    for (const dependency of entry.imports ?? []) collect(dependency)
    for (const css of entry.css ?? []) styles.add(css)
  }
  collect(fullbleed ? 'src/features/quests/TeamPreview.tsx' : 'src/App.tsx')
  const css = (await Promise.all([...styles].map(style => readFile(join(outDir, style), 'utf8')))).join('\n')
  document = document.replace('</head>', `<style>${css}\n.prerender-pc{display:contents}.prerender-mobile{display:none}@media(max-width:980px){.prerender-pc{display:none}.prerender-mobile{display:contents}}</style></head>`)
    .replace('<!--prerender-->', html)
  if (fullbleed) document = document.replace('<body>', '<body class="explore-fullbleed">')
  assert(!document.includes('<!--prerender-->'), 'Missing prerender insertion point')
  for (const component of ['brand-mark', 'account-icon-button', 'desktop-nav', 'mobile-nav']) {
    assert(html.includes(`class="${component}"`), `Missing React component: ${component}`)
  }
  assert(css.includes('.brand-mark'), 'Missing app CSS')
  if (fullbleed) {
    assert(html.includes('sidebar-toggle') && html.includes('explore-sheet'), 'Missing responsive map chrome')
  }
  await writeFile(file, document)
  console.log(`Prerendered React boot HTML + CSS: ${Buffer.byteLength(document)} bytes (${fullbleed ? 'team-preview' : 'offline'})`)
} finally {
  await rm(temporary, { recursive: true, force: true })
}
