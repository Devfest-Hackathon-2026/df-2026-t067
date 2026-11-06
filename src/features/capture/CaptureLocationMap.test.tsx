import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const maps = vi.hoisted(() => ({
  loadGoogleMaps: vi.fn(),
  subscribeMapsAuthFailure: vi.fn(() => () => {}),
}))

vi.mock('../explore/googleMapsLoader', () => maps)

describe('capture location map', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-key')
  })

  async function loadComponent() {
    return (await import('./CaptureLocationMap')).CaptureLocationMap
  }

  function googleApi() {
    const mapInstance = { id: 'map-instance' }
    const Map = vi.fn(function (this: object, _element: HTMLElement, _options: Record<string, unknown>) {
      Object.assign(this, mapInstance)
    })
    const Marker = vi.fn()
    return { api: { Map, Marker }, Map, Marker, mapInstance }
  }

  it('centers Google Maps on the captured coordinates and places a marker there', async () => {
    const { api, Map, Marker, mapInstance } = googleApi()
    maps.loadGoogleMaps.mockResolvedValue(api)
    const Component = await loadComponent()
    render(<Component latitude={35.6812} longitude={139.7671} />)

    await waitFor(() => expect(Marker).toHaveBeenCalledOnce())
    const [, options] = Map.mock.calls[0]
    expect(options).toMatchObject({ center: { lat: 35.6812, lng: 139.7671 }, zoom: 17 })
    expect(Marker).toHaveBeenCalledWith({ map: expect.objectContaining(mapInstance), position: { lat: 35.6812, lng: 139.7671 }, title: '撮影地' })
    expect(await screen.findByLabelText('撮影地の地図')).toBeInTheDocument()
    expect(screen.queryByText('地図を読み込んでいます…')).not.toBeInTheDocument()
  })

  it('explains missing key configuration without requesting the Maps SDK', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', '')
    const Component = await loadComponent()
    render(<Component latitude={35} longitude={135} />)

    expect(await screen.findByText('Google Mapsの設定が必要です')).toBeVisible()
    expect(maps.loadGoogleMaps).not.toHaveBeenCalled()
  })

  it('shows a load failure and retries the SDK request', async () => {
    const { api, Map } = googleApi()
    maps.loadGoogleMaps.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce(api)
    const Component = await loadComponent()
    render(<Component latitude={35} longitude={135} />)

    expect(await screen.findByRole('alert')).toHaveTextContent('地図を読み込めませんでした')
    screen.getByRole('button', { name: '地図を再試行' }).click()
    await waitFor(() => expect(Map).toHaveBeenCalledOnce())
    expect(maps.loadGoogleMaps).toHaveBeenCalledTimes(2)
  })

  it('ignores a late SDK response after unmount', async () => {
    let resolveMaps!: (value: ReturnType<typeof googleApi>['api']) => void
    maps.loadGoogleMaps.mockReturnValue(new Promise((resolve) => { resolveMaps = resolve }))
    const { api, Map, Marker } = googleApi()
    const Component = await loadComponent()
    const view = render(<Component latitude={35} longitude={135} />)
    view.unmount()
    resolveMaps(api)
    await Promise.resolve()

    expect(Map).not.toHaveBeenCalled()
    expect(Marker).not.toHaveBeenCalled()
  })
})
