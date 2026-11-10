import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import { MAP_STYLES } from '../explore/mapStyles'
const loader = vi.hoisted(() => ({ loadGoogleMaps: vi.fn(), subscribeMapsAuthFailure: vi.fn(() => () => {}) }))
vi.mock('../explore/googleMapsLoader', () => loader)
beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-key') })
it('selects a shooting position on click, draws private radius and removes listeners and circles', async () => {
  let click!: (event: { latLng: { lat(): number; lng(): number } }) => void
  const remove = vi.fn(), setMap = vi.fn(), onSelect = vi.fn()
  const Map = vi.fn(function (_element: HTMLElement, _options: Record<string, unknown>) { return { addListener: (_: string, fn: typeof click) => { click = fn; return { remove } } } })
  const Circle = vi.fn(function (_options: Record<string, unknown>) { return { setMap } })
  loader.loadGoogleMaps.mockResolvedValue({ Map, Circle, event: { addListener: (_map: unknown, _name: string, fn: typeof click) => { click = fn; return { remove } } } })
  const { ShootingAreasMap } = await import('./ShootingAreasMap')
  const view = render(<ShootingAreasMap zones={[{ latitude: 35, longitude: 135, radiusMeters: 80 }]} selectedIndex={0} disabled={false} onSelect={onSelect} />)
  await waitFor(() => expect(Circle).toHaveBeenCalled())
  expect(Map.mock.calls[0][1]).toMatchObject({ styles: MAP_STYLES })
  expect(Circle.mock.calls[0][0]).toMatchObject({ center: { lat: 35, lng: 135 }, radius: 80 })
  expect(Circle.mock.calls[0][0]).toMatchObject({ strokeColor: '#f6d84a', fillColor: '#4eb8d0', fillOpacity: 0.25 })
  act(() => click({ latLng: { lat: () => 36, lng: () => 136 } }))
  expect(onSelect).toHaveBeenCalledWith(36, 136)
  view.rerender(<ShootingAreasMap zones={[{ latitude: 36, longitude: 136, radiusMeters: 1000 }]} selectedIndex={0} disabled={true} onSelect={onSelect} />)
  await waitFor(() => expect(Circle.mock.calls.at(-1)?.[0]).toMatchObject({ radius: 1000 }))
  expect(Map).toHaveBeenCalledTimes(1)
  act(() => click({ latLng: { lat: () => 37, lng: () => 137 } }))
  expect(onSelect).toHaveBeenCalledTimes(1)
  view.unmount()
  expect(remove).toHaveBeenCalled()
  expect(setMap).toHaveBeenCalledWith(null)
})
it('draws unselected shooting areas with the traveler pin teal', async () => {
  const Map = vi.fn(function () { return { addListener: () => ({ remove() {} }) } })
  const Circle = vi.fn(function (_options: Record<string, unknown>) { return { setMap: vi.fn() } })
  loader.loadGoogleMaps.mockResolvedValue({ Map, Circle, event: { addListener: () => ({ remove: () => {} }) } })
  const { ShootingAreasMap } = await import('./ShootingAreasMap')
  render(<ShootingAreasMap zones={[{ latitude: 35, longitude: 135, radiusMeters: 80 }, { latitude: 36, longitude: 136, radiusMeters: 50 }]} selectedIndex={1} disabled={false} onSelect={vi.fn()} />)
  await waitFor(() => expect(Circle).toHaveBeenCalledTimes(2))
  expect(Circle.mock.calls[0][0]).toMatchObject({ strokeColor: '#4eb8d0', fillColor: '#4eb8d0', fillOpacity: 0.1 })
  expect(Circle.mock.calls[1][0]).toMatchObject({ strokeColor: '#f6d84a', fillColor: '#4eb8d0', fillOpacity: 0.25 })
})
it('shows a spot marker independently of any private GPS circle', async () => {
  const setMap = vi.fn(), setCenter = vi.fn(), setZoom = vi.fn()
  const Marker = vi.fn(function (_options: Record<string, unknown>) { return { setMap } })
  const Circle = vi.fn()
  loader.loadGoogleMaps.mockResolvedValue({ Map: function () { return { setCenter, setZoom } }, Marker, Circle,
    event: { addListener: () => ({ remove() {} }) } })
  const { ShootingAreasMap } = await import('./ShootingAreasMap')
  const view = render(<ShootingAreasMap zones={[]} selectedIndex={null} disabled={false} onSelect={vi.fn()}
    spot={{ latitude: 1.25, longitude: 2.6 }} />)
  await waitFor(() => expect(Marker).toHaveBeenCalled())
  expect(Marker.mock.calls[0][0]).toMatchObject({ position: { lat: 1.25, lng: 2.6 } })
  expect(Circle).not.toHaveBeenCalled()
  view.unmount()
  expect(setMap).toHaveBeenCalledWith(null)
})
it('moves the spot picker to the current location only on request and leaves the registered spot alone', async () => {
  const setCenter = vi.fn(), setZoom = vi.fn(), onSelect = vi.fn()
  const Marker = vi.fn(function (_options: Record<string, unknown>) { return { setMap: vi.fn() } })
  const getCurrentPosition = vi.fn<Geolocation['getCurrentPosition']>()
  const user = userEvent.setup()
  vi.stubGlobal('navigator', Object.assign(Object.create(navigator), { geolocation: { getCurrentPosition } }))
  try {
    let zoom = 17
    let onZoom = () => {}
    const map = { setCenter, getZoom: () => zoom, setZoom: (value: number) => { zoom = value; setZoom(value); onZoom() } }
    loader.loadGoogleMaps.mockResolvedValue({ Map: function () { return map }, Marker,
      event: { addListener: (_map: unknown, event: string, callback: () => void) => {
        if (event === 'zoom_changed') onZoom = callback
        return { remove() {} }
      } } })
    const { ShootingAreasMap } = await import('./ShootingAreasMap')
    const view = render(<ShootingAreasMap zones={[]} selectedIndex={null} disabled={false} onSelect={onSelect}
      spot={{ latitude: 35, longitude: 135 }} pickPlace />)
    const locate = await screen.findByRole('button', { name: '現在地へ戻る' })
    expect(getCurrentPosition).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: '地図を拡大' }))
    expect(setZoom).toHaveBeenLastCalledWith(18)
    await user.click(screen.getByRole('button', { name: '地図を縮小' }))
    expect(setZoom).toHaveBeenLastCalledWith(17)
    await user.click(locate)
    expect(locate).toBeDisabled()
    act(() => getCurrentPosition.mock.calls[0][1]?.({ code: 1 } as GeolocationPositionError))
    expect(screen.getByRole('status')).toHaveTextContent('位置情報未許可')
    await user.click(locate)
    const position = { coords: { latitude: 36, longitude: 136 } } as GeolocationPosition
    act(() => getCurrentPosition.mock.calls[1][0](position))
    expect(setCenter).toHaveBeenLastCalledWith({ lat: 36, lng: 136 })
    expect(Marker).toHaveBeenCalledTimes(1)
    expect(onSelect).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: '地図の表示を戻す' }))
    expect(setCenter).toHaveBeenLastCalledWith({ lat: 35, lng: 135 })
    await user.click(locate)
    view.unmount()
    act(() => getCurrentPosition.mock.calls[2][0](position))
    expect(setCenter).toHaveBeenCalledTimes(3)
  } finally {
    vi.unstubAllGlobals()
  }
})

it('does not request Maps without configuration', async () => {
  vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', '')
  const { ShootingAreasMap } = await import('./ShootingAreasMap')
  render(<ShootingAreasMap zones={[]} selectedIndex={null} disabled={false} onSelect={vi.fn()} />)
  expect(screen.getByText(/地図未設定/)).toBeVisible()
  expect(loader.loadGoogleMaps).not.toHaveBeenCalled()
})
it('offers numerical fallback and retry after load failure', async () => {
  loader.loadGoogleMaps.mockRejectedValueOnce(new Error('network')).mockResolvedValue({ Map: function () { return {} }, Circle: function () {}, event: { addListener: () => ({ remove() {} }) } })
  const { ShootingAreasMap } = await import('./ShootingAreasMap')
  render(<ShootingAreasMap zones={[]} selectedIndex={null} disabled={false} onSelect={vi.fn()} />)
  expect(await screen.findByRole('alert')).toHaveTextContent('座標を入力')
  act(() => screen.getByRole('button', { name: '地図を再試行' }).click())
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  expect(loader.loadGoogleMaps).toHaveBeenCalledTimes(2)
})

it.each([false, true])('adds hours fields only with explicit flag %s, in the same request', async enabled => {
  vi.stubEnv('VITE_GOOGLE_MAPS_PLACES_PICKER', 'true')
  vi.stubEnv('VITE_GOOGLE_MAPS_PLACES_HOURS', String(enabled))
  let click!: (event: { latLng: { lat(): number; lng(): number }; placeId: string }) => void
  const fetchFields = vi.fn().mockResolvedValue({})
  const importLibrary = vi.fn().mockResolvedValue({ Place: class { fetchFields = fetchFields; displayName = '施設の名称'; formattedAddress = '施設の住所' } })
  loader.loadGoogleMaps.mockResolvedValue({ Map: function () { return {} }, Marker: function () {}, importLibrary,
    event: { addListener: (_: unknown, name: string, fn: typeof click) => { if (name === 'click') click = fn; return { remove() {} } } } })
  const onSelect = vi.fn()
  const { ShootingAreasMap } = await import('./ShootingAreasMap')
  render(<ShootingAreasMap zones={[]} selectedIndex={null} disabled={false} onSelect={onSelect} spot={null} pickPlace />)
  await waitFor(() => expect(click).toBeTypeOf('function'))
  act(() => click({ latLng: { lat: () => 0, lng: () => 0 }, placeId: 'fixture' }))
  expect(await onSelect.mock.calls[0][2].loadDetails()).toMatchObject({ name: '施設の名称', address: '施設の住所' })
  expect(fetchFields).toHaveBeenCalledExactlyOnceWith({ fields: ['displayName', 'formattedAddress', ...(enabled ? ['regularOpeningHours'] : [])] })
})


it('restores the opening view after a selected spot is cleared', async () => {
  const setCenter = vi.fn(), setZoom = vi.fn()
  loader.loadGoogleMaps.mockResolvedValue({ Map: function () { return { setCenter, setZoom } },
    Marker: function () { return { setMap() {} } }, event: { addListener: () => ({ remove() {} }) } })
  const { ShootingAreasMap } = await import('./ShootingAreasMap')
  const props = { zones: [], selectedIndex: null, disabled: false, onSelect: vi.fn(), pickPlace: true }
  const view = render(<ShootingAreasMap {...props} spot={{ latitude: 35, longitude: 135 }} />)
  await screen.findByRole('button', { name: '地図の表示を戻す' })
  view.rerender(<ShootingAreasMap {...props} spot={{ latitude: 36, longitude: 136 }} />)
  view.rerender(<ShootingAreasMap {...props} spot={null} />)
  await userEvent.setup().click(screen.getByRole('button', { name: '地図の表示を戻す' }))
  expect(setCenter).toHaveBeenLastCalledWith({ lat: 35, lng: 135 })
  expect(setZoom).toHaveBeenLastCalledWith(17)
})
