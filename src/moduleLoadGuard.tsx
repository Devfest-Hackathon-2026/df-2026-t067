import type { ReactNode } from 'react'
import type { Root } from 'react-dom/client'

/** Share one failure path for initial imports and Vite's later chunk preloads. */
export function createModuleLoadGuard(root: Pick<Root, 'render'>, reload = () => window.location.reload()) {
  let failed = false
  const fail = () => {
    if (failed) return
    failed = true
    root.render(
      <main style={{ minHeight: '100dvh', padding: '24px', boxSizing: 'border-box', background: '#fff', color: '#222' }}>
        <p role="alert">読み込めませんでした。</p>
        <button type="button" onClick={reload}>再読み込み</button>
      </main>,
    )
  }
  const onPreloadError = (event: Event) => {
    event.preventDefault()
    fail()
  }
  window.addEventListener('vite:preloadError', onPreloadError)
  return {
    async load<T>(module: Promise<T>, render: (value: T) => ReactNode): Promise<void> {
      try {
        const value = await module
        if (!failed) root.render(render(value))
      } catch { fail() }
    },
    dispose() { window.removeEventListener('vite:preloadError', onPreloadError) },
  }
}
