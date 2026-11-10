import { act, fireEvent, screen } from '@testing-library/react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { createModuleLoadGuard } from './moduleLoadGuard'

const cleanups: (() => void)[] = []
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup() })

function setup() {
  const host = document.createElement('div')
  host.innerHTML = '<main>ビルド時の初期画面</main>'
  document.body.append(host)
  const root = createRoot(host)
  const reload = vi.fn()
  const guard = createModuleLoadGuard(root, reload)
  cleanups.push(() => { guard.dispose(); act(() => root.unmount()); host.remove() })
  return { ...guard, host, reload }
}

it('keeps prerendered HTML until a successful import commits', async () => {
  const { load, host } = setup()
  let resolve!: (value: string) => void
  const module = new Promise<string>(done => { resolve = done })
  const pending = load(module, value => <main>{value}</main>)
  expect(host).toHaveTextContent('ビルド時の初期画面')
  await act(async () => { resolve('起動完了'); await pending })
  expect(host).toHaveTextContent('起動完了')
  expect(screen.queryByRole('button', { name: '再読み込み' })).toBeNull()
})

it('handles import rejection with one short message and a manual reload', async () => {
  const { load, reload } = setup()
  await act(async () => { await load(Promise.reject(new Error('internal chunk URL')), () => <main>成功</main>) })
  expect(screen.getByRole('alert')).toHaveTextContent('読み込めませんでした。')
  expect(document.body).not.toHaveTextContent('internal chunk URL')
  expect(reload).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '再読み込み' }))
  expect(reload).toHaveBeenCalledTimes(1)
})

it('handles preloadError once and prevents a pending import overwriting the error', async () => {
  const { load, reload } = setup()
  let resolve!: (value: string) => void
  const pending = load(new Promise<string>(done => { resolve = done }), value => <main>{value}</main>)
  const event = new Event('vite:preloadError', { cancelable: true })
  act(() => { window.dispatchEvent(event); window.dispatchEvent(new Event('vite:preloadError')) })
  expect(event.defaultPrevented).toBe(true)
  await act(async () => { resolve('成功'); await pending })
  expect(screen.getAllByRole('button', { name: '再読み込み' })).toHaveLength(1)
  expect(document.body).not.toHaveTextContent('成功')
  expect(reload).not.toHaveBeenCalled()
})

it('also catches an import rejection after preloadError', async () => {
  const { load } = setup()
  act(() => { window.dispatchEvent(new Event('vite:preloadError')) })
  await act(async () => { await load(Promise.reject(new Error('chunk')), () => <main>成功</main>) })
  expect(screen.getAllByRole('alert')).toHaveLength(1)
})
