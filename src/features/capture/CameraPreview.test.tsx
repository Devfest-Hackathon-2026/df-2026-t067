import { StrictMode } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { CameraPreview } from './CameraPreview'
import { isCaptureLocationMapDebugEnabled } from './captureMapDebug'
import type { DemoAnswerContext } from './DemoAnswerSubmission'

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
  const translate = vi.fn()
  const rotate = vi.fn()
  const canvasSize = vi.fn()
  const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    canvasSize(this.width, this.height)
    return { drawImage, translate, rotate } as unknown as CanvasRenderingContext2D
  })
  const toBlob = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => callback(new Blob([`synthetic-photo-${toBlob.mock.calls.length}`], { type: 'image/jpeg' })))
  const createObjectURL = vi.fn((_blob: Blob | MediaSource) => `blob:synthetic-photo-${createObjectURL.mock.calls.length - 1}`)
  const revokeObjectURL = vi.fn((_url: string) => {})
  const bitmap = { width: 640, height: 480, close: vi.fn() } as unknown as ImageBitmap
  const createImageBitmap = vi.fn(async () => bitmap)
  vi.stubGlobal('createImageBitmap', createImageBitmap)
  vi.stubGlobal('URL', class extends URL { static createObjectURL = createObjectURL; static revokeObjectURL = revokeObjectURL })
  const onClose = vi.fn()
  return { stop, stream, getUserMedia, getCurrentPosition, play, drawImage, translate, rotate, canvasSize, getContext, toBlob, createObjectURL, revokeObjectURL, createImageBitmap, bitmap, onClose, user: userEvent.setup() }
}

async function loadFrame(stream: MediaStream, width = 640, height = 480) {
  const video = screen.getByLabelText('カメラ映像') as HTMLVideoElement
  await waitFor(() => expect(video.srcObject).toBe(stream))
  Object.defineProperties(video, {
    videoWidth: { value: width, configurable: true }, videoHeight: { value: height, configurable: true }, readyState: { value: 2, configurable: true },
  })
  fireEvent.loadedData(video)
  return video
}

describe('local camera preview', () => {
  it('shows a disabled preparation submit action in the normal photo flow', async () => {
    const media = setup()
    render(<CameraPreview onClose={media.onClose} />)
    await loadFrame(media.stream)
    await media.user.click(screen.getByRole('button', { name: '撮影する' }))
    expect(await screen.findByRole('button', { name: '解答を送信する（準備中）' })).toBeDisabled()
  })

  it('requests video only and waits for a decoded frame before enabling capture', async () => {
    const media = setup()
    render(<CameraPreview onClose={media.onClose} />)
    expect(screen.getByRole('button', { name: '撮影する' })).toBeDisabled()
    await loadFrame(media.stream)
    expect(screen.getByRole('button', { name: '撮影する' })).toBeEnabled()
    expect(media.getUserMedia).toHaveBeenCalledExactlyOnceWith({ video: { facingMode: 'environment' }, audio: false })
    expect(media.getCurrentPosition).not.toHaveBeenCalled()
  })

  it.each([[640, 480], [480, 640]])('keeps the browser video orientation in the captured image (%i x %i)', async (width, height) => {
    const media = setup()
    render(<CameraPreview onClose={media.onClose} />)
    await loadFrame(media.stream, width, height)
    await media.user.click(screen.getByRole('button', { name: '撮影する' }))
    expect(media.canvasSize).toHaveBeenCalledWith(width, height)
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
    vi.stubEnv('VITE_CAPTURE_LOCATION_MAP_DEBUG', 'true')
    const media = setup()
    const view = render(<CameraPreview onClose={media.onClose} />)
    await loadFrame(media.stream)
    await media.user.click(screen.getByRole('button', { name: '撮影する' }))
    expect(await screen.findByRole('img', { name: '撮影した写真のプレビュー' })).toHaveAttribute('src', 'blob:synthetic-photo-0')
    expect(media.stop).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('status')).toHaveTextContent('精度 約12m')
    expect(screen.getByRole('button', { name: '撮影地を見る' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText(/座標がGoogle Mapsに送信されます/)).toBeInTheDocument()
    expect(media.getCurrentPosition).toHaveBeenCalledExactlyOnceWith(expect.any(Function), expect.any(Function),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 })
    expect(media.toBlob.mock.calls[0].slice(1)).toEqual(['image/jpeg', .9])
    view.unmount()
    expect(media.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:synthetic-photo-0')
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
    expect(screen.queryByRole('button', { name: '撮影地を見る' })).not.toBeInTheDocument()
    act(() => media.getCurrentPosition.mock.calls[0][0](position()))
    expect(screen.getByRole('status')).toHaveTextContent('精度 約12m')
    expect(screen.queryByRole('button', { name: '撮影地を見る' })).not.toBeInTheDocument()
  })

  it('rotates the encoded photo in quarter turns and keeps GPS and capture time', async () => {
    const media = setup()
    const submitAnswer = vi.fn(async (_input: { photo: Blob }) => ({ source: 'mock' as const, state: 'RECEIVED' as const, attemptId: 'attempt-1' }))
    const answer = { api: { submitAnswer, getAttempt: vi.fn() }, challengeId: 'challenge-1', onReloadQuest: vi.fn() } as unknown as DemoAnswerContext
    const view = render(<CameraPreview onClose={media.onClose} answer={answer} />)
    await loadFrame(media.stream)
    await media.user.click(screen.getByRole('button', { name: '撮影する' }))
    const capturedMetadata = screen.getByText(/撮影地を写真に紐づけました/).textContent
    await media.user.click(screen.getByRole('button', { name: '右に90度回転' }))
    await waitFor(() => expect(media.createObjectURL).toHaveBeenCalledTimes(2))
    expect(media.canvasSize).toHaveBeenLastCalledWith(480, 640)
    expect(media.translate).toHaveBeenCalledWith(240, 320)
    expect(media.rotate).toHaveBeenCalledWith(Math.PI / 2)
    expect(media.bitmap.close).toHaveBeenCalledOnce()
    expect(media.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:synthetic-photo-0')
    expect(screen.getByRole('img', { name: '撮影した写真のプレビュー' })).toHaveAttribute('src', 'blob:synthetic-photo-1')
    expect(screen.getByText(/撮影地を写真に紐づけました/).textContent).toBe(capturedMetadata)
    expect(screen.getByRole('button', { name: '左に90度回転' })).toBeEnabled()
    await media.user.click(screen.getByRole('button', { name: '写真と位置をデモ送信' }))
    await waitFor(() => expect(submitAnswer).toHaveBeenCalledOnce())
    expect(submitAnswer.mock.calls[0][0].photo).toBe(media.createObjectURL.mock.calls[1][0])
    view.unmount()
    expect(media.revokeObjectURL).toHaveBeenCalledTimes(2)
    expect(media.revokeObjectURL).toHaveBeenLastCalledWith('blob:synthetic-photo-1')
  })

  it('locks rotation as soon as a developer submission starts and preserves its receipt', async () => {
    const media = setup()
    const submitAnswer = vi.fn(async () => ({ source: 'mock' as const, state: 'RECEIVED' as const, attemptId: 'attempt-locked' }))
    const answer = { api: { submitAnswer, getAttempt: vi.fn() }, challengeId: 'challenge-1', onReloadQuest: vi.fn() } as unknown as DemoAnswerContext
    render(<CameraPreview onClose={media.onClose} answer={answer} />)
    await loadFrame(media.stream)
    await media.user.click(screen.getByRole('button', { name: '撮影する' }))
    await media.user.click(screen.getByRole('button', { name: '写真と位置をデモ送信' }))
    expect(screen.getByRole('button', { name: '左に90度回転' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '右に90度回転' })).toBeDisabled()
    expect(await screen.findByText('デモ受付済みです。写真判定と記録保存は未接続です。')).toBeVisible()
    expect(screen.getByRole('button', { name: '受付状態を確認' })).toBeEnabled()
    expect(submitAnswer).toHaveBeenCalledOnce()
  })

  it('keeps the developer submission mounted but disabled during rotation', async () => {
    const media = setup()
    let resolveBitmap!: (bitmap: ImageBitmap) => void
    media.createImageBitmap.mockImplementationOnce(() => new Promise(resolve => { resolveBitmap = resolve }))
    const submitAnswer = vi.fn(async () => ({ source: 'mock' as const, state: 'RECEIVED' as const, attemptId: 'attempt-after-rotation' }))
    const answer = { api: { submitAnswer, getAttempt: vi.fn() }, challengeId: 'challenge-1', onReloadQuest: vi.fn() } as unknown as DemoAnswerContext
    render(<CameraPreview onClose={media.onClose} answer={answer} />)
    await loadFrame(media.stream)
    await media.user.click(screen.getByRole('button', { name: '撮影する' }))
    await media.user.click(screen.getByRole('button', { name: '右に90度回転' }))
    const send = screen.getByRole('button', { name: '写真と位置をデモ送信' })
    expect(send).toBeDisabled()
    fireEvent.click(send)
    expect(submitAnswer).not.toHaveBeenCalled()
    await act(async () => resolveBitmap(media.bitmap))
    await waitFor(() => expect(send).toBeEnabled())
    await media.user.click(send)
    expect(await screen.findByText('デモ受付済みです。写真判定と記録保存は未接続です。')).toBeVisible()
    expect(submitAnswer).toHaveBeenCalledOnce()
  })

  it('keeps retake and close available while a submission is pending', async () => {
    const media = setup()
    const submitAnswer = vi.fn(() => new Promise<never>(() => {}))
    const answer = { api: { submitAnswer, getAttempt: vi.fn() }, challengeId: 'challenge-1', onReloadQuest: vi.fn() } as unknown as DemoAnswerContext
    render(<CameraPreview onClose={media.onClose} answer={answer} />)
    await loadFrame(media.stream)
    await media.user.click(screen.getByRole('button', { name: '撮影する' }))
    await media.user.click(screen.getByRole('button', { name: '写真と位置をデモ送信' }))
    expect(await screen.findByRole('button', { name: '受付を確認しています…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '撮り直す' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '撮影を終了' })).toBeEnabled()
    await media.user.click(screen.getByRole('button', { name: '撮影を終了' }))
    expect(media.onClose).toHaveBeenCalledOnce()
  })

  it('shows the map button only when explicitly enabled in development', async () => {
    vi.stubEnv('VITE_CAPTURE_LOCATION_MAP_DEBUG', 'true')
    const media = setup()
    render(<CameraPreview onClose={media.onClose} />)
    await loadFrame(media.stream)
    await media.user.click(screen.getByRole('button', { name: '撮影する' }))
    expect(await screen.findByRole('button', { name: '撮影地を見る' })).toBeInTheDocument()
  })

  it.each([
    [false, 'true', false],
    [true, undefined, false],
    [true, 'false', false],
    [true, 'true', true],
  ])('applies the debug setting safely (dev=%s, setting=%s)', (isDevelopment, setting, expected) => {
    expect(isCaptureLocationMapDebugEnabled(isDevelopment, setting)).toBe(expected)
  })

  it('keeps the photo and GPS when closing the map, then discards them on retake', async () => {
    vi.stubEnv('VITE_CAPTURE_LOCATION_MAP_DEBUG', 'true')
    const media = setup()
    const stopSecond = vi.fn()
    const second = { getTracks: () => [{ stop: stopSecond }] } as unknown as MediaStream
    media.getUserMedia.mockResolvedValueOnce(media.stream).mockResolvedValueOnce(second)
    const view = render(<CameraPreview onClose={media.onClose} />)
    await loadFrame(media.stream)
    await media.user.click(screen.getByRole('button', { name: '撮影する' }))
    await media.user.click(await screen.findByRole('button', { name: '撮影地を見る' }))
    expect(screen.getByLabelText('撮影地の地図')).toBeVisible()
    await media.user.click(screen.getByRole('button', { name: '地図を閉じる' }))
    expect(screen.queryByLabelText('撮影地の地図')).not.toBeInTheDocument()
    expect(screen.getByRole('img', { name: '撮影した写真のプレビュー' })).toHaveAttribute('src', 'blob:synthetic-photo-0')
    expect(screen.getByText(/撮影地を写真に紐づけました/)).toBeVisible()
    expect(media.revokeObjectURL).not.toHaveBeenCalled()
    await media.user.click(screen.getByRole('button', { name: '撮影地を見る' }))
    await media.user.click(screen.getByRole('button', { name: '撮り直す' }))
    await loadFrame(second)
    expect(media.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:synthetic-photo-0')
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('撮影地の地図')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '撮影地を見る' })).not.toBeInTheDocument()
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
    expect(screen.queryByRole('button', { name: '撮影地を見る' })).not.toBeInTheDocument()
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
