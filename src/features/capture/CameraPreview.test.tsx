import { StrictMode } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { CameraPreview } from './CameraPreview'

function position(coords: Partial<GeolocationCoordinates> = {}, timestamp = Date.now()) {
  return { coords: { latitude: 35, longitude: 135, accuracy: 12.4, altitude: null,
    altitudeAccuracy: null, heading: null, speed: null, ...coords }, timestamp } as GeolocationPosition
}

function positionError(code: number): GeolocationPositionError {
  return { code, message: 'private-location-details', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 }
}

function setup() {
  const stop = vi.fn()
  const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream
  const getUserMedia = vi.fn(async () => stream)
  const getCurrentPosition = vi.fn<Geolocation['getCurrentPosition']>((success) => success(position()))
  vi.stubGlobal('navigator', Object.assign(Object.create(navigator), {
    mediaDevices: { getUserMedia }, geolocation: { getCurrentPosition },
  }))
  const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
  const drawImage = vi.fn()
  const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D)
  const toBlob = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => callback(new Blob(['synthetic-photo'], { type: 'image/jpeg' })))
  const createObjectURL = vi.fn((_blob: Blob | MediaSource) => 'blob:synthetic-photo')
  const revokeObjectURL = vi.fn((_url: string) => {})
  vi.stubGlobal('URL', class extends URL { static createObjectURL = createObjectURL; static revokeObjectURL = revokeObjectURL })
  const onClose = vi.fn()
  return { stop, stream, getUserMedia, getCurrentPosition, play, drawImage, getContext, toBlob, createObjectURL, revokeObjectURL, onClose, user: userEvent.setup() }
}

async function loadFrame(stream: MediaStream) {
  const video = screen.getByLabelText('カメラ映像') as HTMLVideoElement
  await waitFor(() => expect(video.srcObject).toBe(stream))
  Object.defineProperties(video, {
    videoWidth: { value: 640, configurable: true }, videoHeight: { value: 480, configurable: true }, readyState: { value: 2, configurable: true },
  })
  fireEvent.loadedData(video)
  return video
}

describe('local camera preview', () => {
  it('requests video only and waits for a decoded frame before enabling capture', async () => {
    const media = setup()
    render(<CameraPreview onClose={media.onClose} />)
    expect(screen.getByRole('button', { name: '撮影する' })).toBeDisabled()
    await loadFrame(media.stream)
    expect(screen.getByRole('button', { name: '撮影する' })).toBeEnabled()
    expect(media.getUserMedia).toHaveBeenCalledExactlyOnceWith({ video: { facingMode: 'environment' }, audio: false })
    expect(media.getCurrentPosition).not.toHaveBeenCalled()
  })

  it('explains permission denial and supports retry and closing', async () => {
    const media = setup()
    media.getUserMedia.mockRejectedValueOnce(new DOMException('private-device-details', 'NotAllowedError'))
    render(<CameraPreview onClose={media.onClose} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('許可されませんでした')
    expect(document.body).not.toHaveTextContent('private-device-details')
    await media.user.click(screen.getByRole('button', { name: 'カメラを再試行' }))
    await loadFrame(media.stream)
    expect(media.getUserMedia).toHaveBeenCalledTimes(2)
    await media.user.click(screen.getByRole('button', { name: '撮影を終了' }))
    expect(media.onClose).toHaveBeenCalledTimes(1)
  })

  it('allows closing when camera APIs are unavailable', async () => {
    const media = setup()
    vi.stubGlobal('navigator', Object.assign(Object.create(navigator), { mediaDevices: undefined }))
    render(<CameraPreview onClose={media.onClose} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('カメラを起動できませんでした')
    await media.user.click(screen.getByRole('button', { name: '撮影を終了' }))
    expect(media.onClose).toHaveBeenCalledTimes(1)
    expect(media.getUserMedia).not.toHaveBeenCalled()
  })

  it('stops an acquired stream when playback fails', async () => {
    const media = setup()
    media.play.mockRejectedValueOnce(new Error('private-playback-details'))
    render(<CameraPreview onClose={media.onClose} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('カメラを起動できませんでした')
    expect(media.stop).toHaveBeenCalledTimes(1)
    expect(document.body).not.toHaveTextContent('private-playback-details')
  })

  it('shows a local photo, stops capture, and releases the URL on unmount', async () => {
    const media = setup()
    const view = render(<CameraPreview onClose={media.onClose} />)
    await loadFrame(media.stream)
    await media.user.click(screen.getByRole('button', { name: '撮影する' }))
    expect(await screen.findByRole('img', { name: '撮影した写真のプレビュー' })).toHaveAttribute('src', 'blob:synthetic-photo')
    expect(media.stop).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('status')).toHaveTextContent('精度 約12m')
    const mapLink = screen.getByRole('link', { name: '撮影地を地図で見る（OpenStreetMap）' })
    expect(mapLink).toHaveAttribute('href', expect.stringContaining('mlat=35&mlon=135'))
    expect(mapLink).toHaveAttribute('target', '_blank')
    expect(mapLink).toHaveAttribute('rel', 'noreferrer')
    expect(screen.getByText(/座標がOpenStreetMapに送られます/)).toBeInTheDocument()
    expect(media.getCurrentPosition).toHaveBeenCalledExactlyOnceWith(expect.any(Function), expect.any(Function),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 })
    expect(media.toBlob.mock.calls[0].slice(1)).toEqual(['image/jpeg', .9])
    view.unmount()
    expect(media.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:synthetic-photo')
  })

  it('captures the frame immediately and obtains GPS afterward', async () => {
    const media = setup()
    media.getCurrentPosition.mockImplementationOnce(() => {})
    render(<CameraPreview onClose={media.onClose} />)
    await loadFrame(media.stream)
    await media.user.click(screen.getByRole('button', { name: '撮影する' }))
    expect(await screen.findByRole('img', { name: '撮影した写真のプレビュー' })).toBeVisible()
    expect(media.toBlob).toHaveBeenCalledTimes(1)
    expect(media.drawImage.mock.invocationCallOrder[0]).toBeLessThan(media.getCurrentPosition.mock.invocationCallOrder[0])
    expect(screen.getByText('撮影地を取得しています…')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '撮影地を地図で見る（OpenStreetMap）' })).not.toBeInTheDocument()
    act(() => media.getCurrentPosition.mock.calls[0][0](position()))
    expect(screen.getByRole('status')).toHaveTextContent('精度 約12m')
    expect(screen.getByRole('link', { name: '撮影地を地図で見る（OpenStreetMap）' })).toHaveAttribute('href', 'https://www.openstreetmap.org/?mlat=35&mlon=135#map=18/35/135')
  })

  it('releases the photo before retaking and stops the second camera on exit', async () => {
    const media = setup()
    const stopSecond = vi.fn()
    const second = { getTracks: () => [{ stop: stopSecond }] } as unknown as MediaStream
    media.getUserMedia.mockResolvedValueOnce(media.stream).mockResolvedValueOnce(second)
    const view = render(<CameraPreview onClose={media.onClose} />)
    await loadFrame(media.stream)
    await media.user.click(screen.getByRole('button', { name: '撮影する' }))
    await media.user.click(screen.getByRole('button', { name: '撮り直す' }))
    await loadFrame(second)
    expect(media.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:synthetic-photo')
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '撮影地を地図で見る（OpenStreetMap）' })).not.toBeInTheDocument()
    view.unmount()
    expect(stopSecond).toHaveBeenCalledTimes(1)
  })

  it('does not let a late playback failure overwrite a completed photo', async () => {
    const media = setup()
    let reject!: (cause: Error) => void
    media.play.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail }))
    render(<CameraPreview onClose={media.onClose} />)
    await loadFrame(media.stream)
    await media.user.click(screen.getByRole('button', { name: '撮影する' }))
    expect(screen.getByRole('img', { name: '撮影した写真のプレビュー' })).toBeVisible()
    await act(async () => reject(new Error('late-playback-failure')))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '撮り直す' })).toBeEnabled()
  })

  it('discards an encoding result after closing without allocating a photo URL', async () => {
    const media = setup()
    let callback!: BlobCallback
    media.toBlob.mockImplementationOnce((done) => { callback = done })
    const view = render(<CameraPreview onClose={media.onClose} />)
    await loadFrame(media.stream)
    await media.user.click(screen.getByRole('button', { name: '撮影する' }))
    view.unmount()
    act(() => callback(new Blob(['late-synthetic-photo'])))
    expect(media.createObjectURL).not.toHaveBeenCalled()
    expect(media.stop).toHaveBeenCalledTimes(1)
  })

  it('rejects empty encoding results and allows retry', async () => {
    const media = setup()
    media.toBlob.mockImplementationOnce((callback) => callback(null))
    render(<CameraPreview onClose={media.onClose} />)
    await loadFrame(media.stream)
    await media.user.click(screen.getByRole('button', { name: '撮影する' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('写真を作成できませんでした')
    expect(media.createObjectURL).not.toHaveBeenCalled()
    expect(media.stop).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'カメラを再試行' })).toBeEnabled()
  })

  it('does not present a blank photo when canvas drawing is unavailable', async () => {
    const media = setup()
    media.getContext.mockReturnValueOnce(null)
    render(<CameraPreview onClose={media.onClose} />)
    await loadFrame(media.stream)
    await media.user.click(screen.getByRole('button', { name: '撮影する' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('写真を作成できませんでした')
    expect(media.toBlob).not.toHaveBeenCalled()
    expect(media.stop).toHaveBeenCalledTimes(1)
  })

  it('stops camera access on pagehide', async () => {
    const media = setup()
    render(<CameraPreview onClose={media.onClose} />)
    await loadFrame(media.stream)
    fireEvent(window, new Event('pagehide'))
    expect(media.stop).toHaveBeenCalledTimes(1)
    expect(media.onClose).toHaveBeenCalledTimes(1)
  })

  it('avoids duplicate permission requests in StrictMode', async () => {
    const media = setup()
    render(<StrictMode><CameraPreview onClose={media.onClose} /></StrictMode>)
    await loadFrame(media.stream)
    expect(media.getUserMedia).toHaveBeenCalledTimes(1)
  })

  it('encodes only once for a repeated capture click', async () => {
    const media = setup()
    let callback!: BlobCallback
    media.toBlob.mockImplementationOnce((done) => { callback = done })
    render(<CameraPreview onClose={media.onClose} />)
    await loadFrame(media.stream)
    await media.user.dblClick(screen.getByRole('button', { name: '撮影する' }))
    expect(media.toBlob).toHaveBeenCalledTimes(1)
    act(() => callback(new Blob(['synthetic-photo'])))
    expect(media.createObjectURL).toHaveBeenCalledTimes(1)
  })

  it.each([1, 2, 3])('keeps the photo after location error %s and allows a location retry', async (code) => {
    const media = setup()
    media.getCurrentPosition.mockImplementationOnce((_success, failure) => failure?.(positionError(code)))
    render(<CameraPreview onClose={media.onClose} />)
    await loadFrame(media.stream)
    await media.user.click(screen.getByRole('button', { name: '撮影する' }))
    expect(screen.getByRole('alert')).toHaveTextContent(code === 1 ? '許可されませんでした' : '取得できませんでした')
    expect(document.body).not.toHaveTextContent('private-location-details')
    expect(await screen.findByRole('img', { name: '撮影した写真のプレビュー' })).toBeVisible()
    expect(screen.queryByRole('link', { name: '撮影地を地図で見る（OpenStreetMap）' })).not.toBeInTheDocument()
    expect(media.toBlob).toHaveBeenCalledTimes(1)
    expect(media.getCurrentPosition).toHaveBeenCalledTimes(1)
    await media.user.click(screen.getByRole('button', { name: '位置情報を再試行' }))
    expect(screen.getByRole('img', { name: '撮影した写真のプレビュー' })).toBeVisible()
    expect(screen.getByRole('status')).toHaveTextContent('精度 約12m')
    expect(media.getCurrentPosition).toHaveBeenCalledTimes(2)
  })

  it('keeps a photo when the location API is unavailable', async () => {
    const media = setup()
    vi.stubGlobal('navigator', Object.assign(Object.create(navigator), { geolocation: undefined }))
    render(<CameraPreview onClose={media.onClose} />)
    await loadFrame(media.stream)
    await media.user.click(screen.getByRole('button', { name: '撮影する' }))
    expect(screen.getByRole('alert')).toHaveTextContent('位置情報を取得できません')
    expect(screen.getByRole('button', { name: '位置情報を再試行' })).toBeEnabled()
    expect(media.toBlob).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('img', { name: '撮影した写真のプレビュー' })).toBeVisible()
  })

  it('recovers from a synchronous location API exception without exposing device details', async () => {
    const media = setup()
    media.getCurrentPosition.mockImplementationOnce(() => { throw new DOMException('private-location-details', 'SecurityError') })
    render(<CameraPreview onClose={media.onClose} />)
    await loadFrame(media.stream)
    await media.user.click(screen.getByRole('button', { name: '撮影する' }))
    expect(screen.getByRole('alert')).toHaveTextContent('位置情報')
    expect(document.body).not.toHaveTextContent('private-location-details')
    expect(screen.getByRole('button', { name: '位置情報を再試行' })).toBeEnabled()
    expect(screen.getByRole('img')).toBeVisible()
    await media.user.click(screen.getByRole('button', { name: '位置情報を再試行' }))
    expect(media.toBlob).toHaveBeenCalledTimes(1)
  })

  it.each([
    position({ latitude: NaN }), position({ latitude: 91 }), position({ longitude: 181 }),
    position({ accuracy: -1 }), position({ accuracy: Infinity }), position({}, NaN),
  ])('rejects invalid location metadata and enables retry: %o', async (location) => {
    const media = setup()
    media.getCurrentPosition.mockImplementationOnce(() => {})
    render(<CameraPreview onClose={media.onClose} />)
    await loadFrame(media.stream)
    await media.user.click(screen.getByRole('button', { name: '撮影する' }))
    const success = media.getCurrentPosition.mock.calls[0][0]
    expect(() => act(() => success(location))).not.toThrow()
    expect(screen.getByRole('alert')).toHaveTextContent('位置情報')
    expect(screen.getByRole('button', { name: '位置情報を再試行' })).toBeEnabled()
    expect(media.toBlob).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('img', { name: '撮影した写真のプレビュー' })).toBeVisible()
    await media.user.click(screen.getByRole('button', { name: '位置情報を再試行' }))
    expect(screen.getByRole('img')).toBeVisible()
  })

  it.each(['close', 'unmount', 'pagehide'] as const)('ignores a pending location after %s', async (leave) => {
    const media = setup()
    media.getCurrentPosition.mockImplementationOnce(() => {})
    const view = render(<CameraPreview onClose={media.onClose} />)
    await loadFrame(media.stream)
    await media.user.click(screen.getByRole('button', { name: '撮影する' }))
    const success = media.getCurrentPosition.mock.calls[0][0]
    if (leave === 'close') await media.user.click(screen.getByRole('button', { name: '撮影を終了' }))
    else if (leave === 'unmount') view.unmount()
    else fireEvent(window, new Event('pagehide'))
    act(() => success(position()))
    expect(media.stop).toHaveBeenCalledTimes(1)
    expect(media.toBlob).toHaveBeenCalledTimes(1)
    expect(media.createObjectURL).toHaveBeenCalledTimes(1)
    expect(media.revokeObjectURL).toHaveBeenCalledTimes(1)
  })

  it('locks capture while locating and requests a new position for a retake', async () => {
    const media = setup()
    media.getCurrentPosition.mockImplementationOnce(() => {})
    render(<CameraPreview onClose={media.onClose} />)
    await loadFrame(media.stream)
    const capture = screen.getByRole('button', { name: '撮影する' })
    fireEvent.click(capture)
    fireEvent.click(capture)
    expect(media.getCurrentPosition).toHaveBeenCalledTimes(1)
    expect(media.toBlob).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: '撮影地を取得中…' })).toBeDisabled()
    act(() => media.getCurrentPosition.mock.calls[0][0](position()))
    await media.user.click(screen.getByRole('button', { name: '撮り直す' }))
    await loadFrame(media.stream)
    expect(screen.queryByText(/撮影地を写真に紐づけました/)).not.toBeInTheDocument()
    media.getCurrentPosition.mockImplementationOnce(success => success(position({ accuracy: 32 })))
    await media.user.click(screen.getByRole('button', { name: '撮影する' }))
    expect(screen.getByRole('status')).toHaveTextContent('精度 約32m')
    expect(media.getCurrentPosition).toHaveBeenCalledTimes(2)
  })

  it.each(['success', 'error'] as const)('ignores the previous photo location %s while a retake is locating', async (result) => {
    const media = setup()
    media.getCurrentPosition.mockImplementation(() => {})
    media.createObjectURL.mockReturnValueOnce('blob:first-photo').mockReturnValueOnce('blob:second-photo')
    render(<CameraPreview onClose={media.onClose} />)
    await loadFrame(media.stream)
    await media.user.click(screen.getByRole('button', { name: '撮影する' }))
    const [oldSuccess, oldFailure] = media.getCurrentPosition.mock.calls[0]
    await media.user.click(screen.getByRole('button', { name: '撮り直す' }))
    await loadFrame(media.stream)
    await media.user.click(screen.getByRole('button', { name: '撮影する' }))
    act(() => result === 'success' ? oldSuccess(position({ accuracy: 99 })) : oldFailure?.(positionError(2)))
    expect(screen.getByRole('img')).toHaveAttribute('src', 'blob:second-photo')
    expect(screen.getByRole('status')).toHaveTextContent('撮影地を取得しています')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByText(/撮影地を写真に紐づけました/)).not.toBeInTheDocument()
    expect(media.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:first-photo')
    act(() => media.getCurrentPosition.mock.calls[1][0](position({ accuracy: 32 })))
    expect(screen.getByRole('status')).toHaveTextContent('精度 約32m')
    expect(media.toBlob).toHaveBeenCalledTimes(2)
  })

  it.each(['success', 'error'] as const)('ignores a location %s after photo encoding fails', async (result) => {
    const media = setup()
    media.getCurrentPosition.mockImplementationOnce(() => {})
    let encode!: BlobCallback
    media.toBlob.mockImplementationOnce(done => { encode = done })
    render(<CameraPreview onClose={media.onClose} />)
    await loadFrame(media.stream)
    await media.user.click(screen.getByRole('button', { name: '撮影する' }))
    const [success, failure] = media.getCurrentPosition.mock.calls[0]
    act(() => encode(null))
    act(() => result === 'success' ? success(position()) : failure?.(positionError(2)))
    expect(screen.getByRole('alert')).toHaveTextContent('写真を作成できませんでした')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'カメラを再試行' })).toBeEnabled()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(media.createObjectURL).not.toHaveBeenCalled()
  })
})
