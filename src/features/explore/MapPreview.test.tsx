import { act, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MapPreview } from './MapPreview'
import type { PublicArea } from '../../shared/api/types'

const areas: PublicArea[] = [{ areaId: 'area-a', label: 'A', publishedCount: 1, marker: { latitude: 35, longitude: 139 },
  publicGeometry: { type: 'Polygon', coordinates: [[[139, 35], [140, 35], [140, 36], [139, 36], [139, 35]], [[139.2, 35.2], [139.3, 35.2], [139.3, 35.3], [139.2, 35.3], [139.2, 35.2]]] } }]

describe('Google map panel', () => {
  it('explains that a key is required while leaving problem browsing available', () => {
    render(<MapPreview />)
    expect(screen.getByText('Google Mapsの設定が必要です')).toBeVisible()
    expect(screen.getByText('地図を表示するには設定をご確認ください。問題の閲覧は続けられます。')).toBeVisible()
  })
  it('does not create quest markers from the currently selected sample', () => {
    render(<MapPreview />)
    expect(screen.queryByRole('button', { name: /謎を地図から見る/ })).not.toBeInTheDocument()
  })
  it('keeps authentication failure visible when it occurs during map creation', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-key')
    vi.resetModules()
    const { MapPreview: ConfiguredMapPreview } = await import('./MapPreview')
    window.google = { maps: {
      Map: class {
        constructor() { window.gm_authFailure?.(); return mapInstance }
      },
      Data: class { setMap() {} addGeoJson() {} setStyle() {} addListener() { return { remove() {} } } forEach() {} remove() {} },
      event: { addListener: () => ({ remove() {} }) },
    } as never }
    try {
      const { unmount } = render(<ConfiguredMapPreview />)
      expect(await screen.findByRole('alert')).toHaveTextContent('地図を読み込めませんでした')
      expect(screen.queryByRole('button', { name: '地図を拡大' })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'ページを再読み込み' })).toBeVisible()
      unmount()
      render(<ConfiguredMapPreview />)
      expect(await screen.findByRole('alert')).toHaveTextContent('地図の設定を確認して')
      expect(screen.queryByRole('button', { name: '地図を拡大' })).not.toBeInTheDocument()
    } finally { delete window.google }
  })

  it('renders public GeoJSON in longitude/latitude order with holes and selects only current features', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-key')
    vi.resetModules()
    const addGeoJson = vi.fn()
    const setStyle = vi.fn()
    let click: ((event: { feature: { getProperty: () => string } }) => void) | undefined
    const removeFeature = vi.fn()
    class Data { setMap() {} addGeoJson = addGeoJson; setStyle = setStyle; addListener(_name: string, cb: typeof click) { click = cb; return { remove: removeFeature } } forEach() {} remove() {} }
    window.google = { maps: { Map: class { constructor() { return mapInstance } }, Data, LatLngBounds: class { extend() {} }, event: { addListener: () => ({ remove() {} }) } } as never }
    const { MapPreview: ConfiguredMapPreview } = await import('./MapPreview')
    const onSelectArea = vi.fn()
    const { rerender, unmount } = render(<ConfiguredMapPreview areas={areas} onSelectArea={onSelectArea} />)
    expect(await screen.findByRole('button', { name: '地図を拡大' })).toBeVisible()
    await waitFor(() => expect(addGeoJson).toHaveBeenCalledWith(expect.objectContaining({ features: [expect.objectContaining({
      geometry: { type: 'Polygon', coordinates: areas[0].publicGeometry.coordinates },
    })] })))
    expect(setStyle).toHaveBeenCalled()
    click?.({ feature: { getProperty: () => 'area-a' } })
    expect(onSelectArea).toHaveBeenCalledWith('area-a')
    rerender(<ConfiguredMapPreview areas={[]} onSelectArea={onSelectArea} />)
    expect(removeFeature).toHaveBeenCalled()
    unmount()
    delete window.google
  })

  it('does not add demo areas to the map', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-key')
    vi.resetModules()
    const addGeoJson = vi.fn()
    class Data { setMap() {} addGeoJson = addGeoJson; setStyle() {} addListener() { return { remove() {} } } forEach() {} remove() {} }
    window.google = { maps: { Map: class { constructor() { return mapInstance } }, Data, LatLngBounds: class { extend() {} }, event: { addListener: () => ({ remove() {} }) } } as never }
    const { MapPreview: ConfiguredMapPreview } = await import('./MapPreview')
    const { unmount } = render(<ConfiguredMapPreview areas={areas} showPublicAreas={false} />)
    expect(await screen.findByRole('button', { name: '地図を拡大' })).toBeVisible()
    expect(addGeoJson).not.toHaveBeenCalled()
    unmount()
    delete window.google
  })

  it('keeps the base map usable after a layer error and retries only the public areas', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-key')
    vi.resetModules()
    const addGeoJson = vi.fn().mockImplementationOnce(() => { throw new Error('sdk error') })
    class Data { setMap() {} addGeoJson = addGeoJson; setStyle() {} addListener() { return { remove() {} } } forEach() {} remove() {} }
    window.google = { maps: { Map: class { constructor() { return mapInstance } }, Data, LatLngBounds: class { extend() {} }, event: { addListener: () => ({ remove() {} }) } } as never }
    const { MapPreview: ConfiguredMapPreview } = await import('./MapPreview')
    const { userEvent } = await import('@testing-library/user-event')
    const user = userEvent.setup()
    render(<ConfiguredMapPreview areas={areas} />)
    expect(await screen.findByRole('button', { name: '地図を拡大' })).toBeVisible()
    const retry = await screen.findByRole('button', { name: '地域エリアを再試行' })
    expect(screen.getByRole('alert')).toHaveTextContent('地域エリアを表示できませんでした')
    await user.click(retry)
    await waitFor(() => expect(addGeoJson).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '地図を拡大' })).toBeVisible()
    delete window.google
  })

  it('keeps map controls usable while the area error is shown', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-key')
    vi.resetModules()
    const addGeoJson = vi.fn().mockImplementationOnce(() => { throw new Error('sdk error') })
    const setZoom = vi.fn()
    class Data { setMap() {} addGeoJson = addGeoJson; setStyle() {} addListener() { return { remove() {} } } forEach() {} remove() {} }
    window.google = { maps: { Map: class { constructor() { return { ...mapInstance, setZoom } } }, Data, LatLngBounds: class { extend() {} }, event: { addListener: () => ({ remove() {} }) } } as never }
    const { MapPreview: ConfiguredMapPreview } = await import('./MapPreview')
    const { userEvent } = await import('@testing-library/user-event')
    const user = userEvent.setup()
    render(<ConfiguredMapPreview areas={areas} />)
    const retry = await screen.findByRole('button', { name: '地域エリアを再試行' })
    expect(retry.parentElement).toHaveClass('map-area-error')
    await user.click(screen.getByRole('button', { name: '地図を拡大' }))
    expect(setZoom).toHaveBeenCalledWith(6)
    await user.click(retry)
    await waitFor(() => expect(addGeoJson).toHaveBeenCalledTimes(2))
    delete window.google
  })

  it('starts at zoom 5 and allows zooming through 12 up to the max of 20, then stops and respects min 3', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-key')
    vi.resetModules()
    let currentZoom = 5
    let zoomChanged: (() => void) | undefined
    const setZoom = vi.fn((next: number) => { currentZoom = next; zoomChanged?.() })
    const map = { ...mapInstance, getZoom: () => currentZoom, setZoom, addListener: (_name: string, callback: () => void) => { zoomChanged = callback; return { remove() {} } } }
    let mapOptions: Record<string, unknown> | undefined
    class Data { setMap() {} addGeoJson() {} setStyle() {} addListener() { return { remove() {} } } forEach() {} remove() {} }
    window.google = { maps: { Map: class { constructor(_element: HTMLElement, options: Record<string, unknown>) { mapOptions = options; return map } }, Data, event: { addListener: () => ({ remove() {} }) } } as never }
    const { MapPreview: ConfiguredMapPreview } = await import('./MapPreview')
    const { userEvent } = await import('@testing-library/user-event')
    const user = userEvent.setup()
    render(<ConfiguredMapPreview />)
    expect(await screen.findByRole('button', { name: '地図を拡大' })).toBeEnabled()
    expect(mapOptions).toMatchObject({ zoom: 5, minZoom: 3, maxZoom: 20 })
    expect(screen.getByRole('button', { name: '地図を縮小' })).toBeEnabled()
    for (let zoom = 6; zoom <= 12; zoom++) await user.click(screen.getByRole('button', { name: '地図を拡大' }))
    expect(currentZoom).toBe(12)
    expect(screen.getByRole('button', { name: '地図を拡大' })).toBeEnabled()
    for (let zoom = 13; zoom <= 20; zoom++) await user.click(screen.getByRole('button', { name: '地図を拡大' }))
    expect(currentZoom).toBe(20)
    expect(screen.getByRole('button', { name: '地図を拡大' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: '地図を縮小' }))
    expect(currentZoom).toBe(19)
    for (let zoom = 18; zoom >= 3; zoom--) await user.click(screen.getByRole('button', { name: '地図を縮小' }))
    expect(currentZoom).toBe(3)
    expect(screen.getByRole('button', { name: '地図を縮小' })).toBeDisabled()
    expect(setZoom).toHaveBeenLastCalledWith(3)
    delete window.google
  })

  it('fits selected public bounds once, keeps user panning on same selection, and fits initial selection after map readiness', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-key')
    vi.resetModules()
    const fitBounds = vi.fn()
    const setCenter = vi.fn()
    const map = { ...mapInstance, fitBounds, setCenter }
    class Data { setMap() {} addGeoJson() {} setStyle() {} addListener() { return { remove() {} } } forEach() {} remove() {} }
    window.google = { maps: { Map: class { constructor() { return map } }, Data, LatLngBounds: class { extend() {} }, event: { addListener: () => ({ remove() {} }) } } as never }
    const { MapPreview: ConfiguredMapPreview } = await import('./MapPreview')
    const { rerender, unmount } = render(<ConfiguredMapPreview areas={areas} selectedAreaId="area-a" />)
    await waitFor(() => expect(fitBounds).toHaveBeenCalledTimes(1))
    setCenter.mockClear()
    rerender(<ConfiguredMapPreview areas={[...areas]} selectedAreaId="area-a" />)
    expect(fitBounds).toHaveBeenCalledTimes(1)
    expect(setCenter).not.toHaveBeenCalled()
    unmount()
    delete window.google
  })

  it('requests location only on click and zooms to a valid location without changing region selection', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-key')
    vi.resetModules()
    let success: ((position: { coords: { latitude: number; longitude: number } }) => void) | undefined
    let failure: ((error: { code: number }) => void) | undefined
    const getCurrentPosition = vi.fn((callback: typeof success, onError: typeof failure) => { success = callback; failure = onError })
    const setCenter = vi.fn()
    const setZoom = vi.fn()
    const map = { ...mapInstance, setCenter, setZoom, fitBounds: vi.fn() }
    let mapOptions: Record<string, unknown> | undefined
    class Data { setMap() {} addGeoJson() {} setStyle() {} addListener() { return { remove() {} } } forEach() {} remove() {} }
    window.google = { maps: { Map: class { constructor(_element: HTMLElement, options: Record<string, unknown>) { mapOptions = options; return map } }, Data, LatLngBounds: class { extend() {} }, event: { addListener: () => ({ remove() {} }) } } as never }
    vi.stubGlobal('navigator', Object.assign(Object.create(navigator), { geolocation: { getCurrentPosition } }))
    const { MapPreview: ConfiguredMapPreview } = await import('./MapPreview')
    const { userEvent } = await import('@testing-library/user-event')
    const user = userEvent.setup()
    const onSelectArea = vi.fn()
    const { rerender, unmount } = render(<ConfiguredMapPreview areas={areas} selectedAreaId="area-a" onSelectArea={onSelectArea} />)
    expect(await screen.findByRole('button', { name: '現在地へ戻る' })).toBeVisible()
    expect(mapOptions?.zoom).toBe(5)
    expect(getCurrentPosition).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: '現在地へ戻る' }))
    expect(getCurrentPosition).toHaveBeenCalledTimes(1)
    expect(getCurrentPosition).toHaveBeenCalledWith(expect.any(Function), expect.any(Function), expect.objectContaining({ timeout: 10_000, maximumAge: 0 }))
    const lateSuccess = success
    rerender(<ConfiguredMapPreview areas={areas} selectedAreaId="" onSelectArea={onSelectArea} />)
    expect(document.querySelector('.map-location-status')).not.toBeInTheDocument()
    setCenter.mockClear()
    act(() => lateSuccess?.({ coords: { latitude: 35, longitude: 139 } }))
    expect(setCenter).not.toHaveBeenCalled()
    rerender(<ConfiguredMapPreview areas={areas} selectedAreaId="area-a" onSelectArea={onSelectArea} />)
    await user.click(screen.getByRole('button', { name: '現在地へ戻る' }))
    act(() => failure?.({ code: 1 }))
    expect(document.querySelector('.map-location-status')).toHaveTextContent('位置情報が許可されませんでした')
    expect(document.querySelector('.map-location-status')).toHaveTextContent('アドレスバーのサイト情報から位置情報を「確認」または「許可」に変更')
    await user.click(screen.getByRole('button', { name: '現在地へ戻る' }))
    expect(getCurrentPosition).toHaveBeenCalledTimes(3)
    act(() => success?.({ coords: { latitude: 35.6812, longitude: 139.7671 } }))
    expect(setCenter).toHaveBeenCalledWith({ lat: 35.6812, lng: 139.7671 })
    expect(setZoom).toHaveBeenCalledWith(12)
    expect(document.querySelector('.map-location-status')).toHaveTextContent('現在地を地図の中心に表示しました')
    expect(onSelectArea).not.toHaveBeenCalled()
    unmount()
    delete window.google
  })

  it('cancels a pending location request when the selected region changes without a usable boundary', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-key')
    vi.resetModules()
    let success: ((position: { coords: { latitude: number; longitude: number } }) => void) | undefined
    const getCurrentPosition = vi.fn((callback: typeof success) => { success = callback })
    const setCenter = vi.fn()
    const map = { ...mapInstance, setCenter, fitBounds: vi.fn() }
    class Data { setMap() {} addGeoJson() {} setStyle() {} addListener() { return { remove() {} } } forEach() {} remove() {} }
    window.google = { maps: { Map: class { constructor() { return map } }, Data, LatLngBounds: class { extend() {} }, event: { addListener: () => ({ remove() {} }) } } as never }
    vi.stubGlobal('navigator', Object.assign(Object.create(navigator), { geolocation: { getCurrentPosition } }))
    const { MapPreview: ConfiguredMapPreview } = await import('./MapPreview')
    const { userEvent } = await import('@testing-library/user-event')
    const user = userEvent.setup()
    const { rerender, unmount } = render(<ConfiguredMapPreview selectedAreaId="area-a" />)
    await user.click(await screen.findByRole('button', { name: '現在地へ戻る' }))
    rerender(<ConfiguredMapPreview selectedAreaId="area-b" />)
    act(() => success?.({ coords: { latitude: 35, longitude: 139 } }))
    expect(setCenter).not.toHaveBeenCalled()
    expect(document.querySelector('.map-location-status')).not.toBeInTheDocument()
    unmount()
    delete window.google
  })

  it('ignores a location callback arriving after the ten second deadline', async () => {
    vi.useFakeTimers()
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-key')
    vi.resetModules()
    let success: ((position: { coords: { latitude: number; longitude: number } }) => void) | undefined
    const getCurrentPosition = vi.fn((callback: typeof success) => { success = callback })
    const setCenter = vi.fn()
    const map = { ...mapInstance, setCenter }
    class Data { setMap() {} addGeoJson() {} setStyle() {} addListener() { return { remove() {} } } forEach() {} remove() {} }
    window.google = { maps: { Map: class { constructor() { return map } }, Data, LatLngBounds: class { extend() {} }, event: { addListener: () => ({ remove() {} }) } } as never }
    vi.stubGlobal('navigator', Object.assign(Object.create(navigator), { geolocation: { getCurrentPosition } }))
    const { MapPreview: ConfiguredMapPreview } = await import('./MapPreview')
    render(<ConfiguredMapPreview />)
    await vi.waitFor(() => expect(screen.getByRole('button', { name: '現在地へ戻る' })).toBeVisible())
    setCenter.mockClear()
    act(() => { screen.getByRole('button', { name: '現在地へ戻る' }).click() })
    await act(() => vi.advanceTimersByTimeAsync(10_000))
    expect(document.querySelector('.map-location-status')).toHaveTextContent('現在地を取得できませんでした')
    act(() => success?.({ coords: { latitude: 35, longitude: 139 } }))
    expect(setCenter).not.toHaveBeenCalled()
    delete window.google
    vi.useRealTimers()
  })
})

const mapInstance = { setZoom() {}, getZoom: () => 5, setCenter() {}, addListener: () => ({ remove() {} }) }
