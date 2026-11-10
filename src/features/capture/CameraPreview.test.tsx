import { useState } from 'react'
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
  it('places the mobile fullscreen camera outside the transformed sheet', () => {
    const media = setup()
    const { container } = render(<CameraPreview onClose={media.onClose} />)
    const camera = screen.getByRole('dialog', { name: '写真撮影と確認' })
    expect(camera).toHaveClass('camera-overlay')
    expect(camera.parentElement).toBe(document.body)
    expect(container).not.toContainElement(camera)
  })

  it('PCの撮影状態への直接表示ではQRを出し、カメラ・写真入力・位置取得を使わない', async () => {
    const media = setup()
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
    const { container } = render(<CameraPreview onClose={media.onClose} handoffUrl="https://example.test/?quest=test" />)
    expect(screen.getByRole('img', { name: /QRコード/ })).toBeVisible()
    await act(async () => {})
    expect(media.getUserMedia).not.toHaveBeenCalled()
    expect(media.getCurrentPosition).not.toHaveBeenCalled()
    expect(container.querySelector('input[type="file"], video, .camera-shutter')).toBeNull()
    expect(screen.queryByRole('button', { name: '送る' })).not.toBeInTheDocument()
  })

  it('スマホ撮影中にPC幅へ変わるとカメラを停止してQRへ切り替える', async () => {
    const media = setup()
    let wide = false
    const listeners = new Set<() => void>()
    vi.stubGlobal('matchMedia', () => ({ matches: wide,
      addEventListener: (_: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
    }))
    render(<CameraPreview onClose={media.onClose} />)
    await loadFrame(media.stream)
    act(() => { wide = true; listeners.forEach(listener => listener()) })
    expect(media.stop).toHaveBeenCalled()
    expect(screen.getByRole('img', { name: /QRコード/ })).toBeVisible()
    expect(screen.queryByLabelText('カメラ映像')).not.toBeInTheDocument()
  })

  it('shows a disabled preparation submit action in the normal photo flow', async () => {
    const media = setup()
    render(<CameraPreview onClose={media.onClose} />)
    await loadFrame(media.stream)
    await media.user.click(screen.getByRole('button', { name: '撮影' }))
    expect(await screen.findByRole('button', { name: '送る' })).toBeDisabled()
  })

  it('スマホは幅いっぱいのシャッター、確認後は送るだけを主操作にして撮り直しで戻る', async () => {
    const media = setup()
    const view = render(<CameraPreview onClose={media.onClose} />)
    await loadFrame(media.stream)
    const shutter = screen.getByRole('button', { name: '撮影' })
    expect(shutter).toHaveClass('camera-shutter')
    expect(shutter.parentElement).toHaveClass('camera-shutter-controls')
    // FR-05: 回答は現地でのアプリ内撮影のみ。
    expect(document.querySelector('input[type="file"]')).toBeNull()
    await media.user.click(shutter)
    const send = screen.getByRole('button', { name: '送る' })
    expect(send).toHaveClass('primary-button')
    expect(document.querySelectorAll('.camera-overlay .primary-button')).toHaveLength(1)
    expect(screen.getByRole('button', { name: '撮り直す' })).toHaveClass('secondary-button')
    await media.user.click(screen.getByRole('button', { name: '撮り直す' }))
    await loadFrame(media.stream)
    expect(screen.getByRole('button', { name: '撮影' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: '送る' })).not.toBeInTheDocument()
    expect(media.revokeObjectURL).toHaveBeenCalledWith('blob:synthetic-photo-0')
    view.unmount()
  })

  it('requests video only and waits for a decoded frame before enabling capture', async () => {
    const media = setup()
    render(<CameraPreview onClose={media.onClose} />)
    expect(screen.getByRole('button', { name: '撮影' })).toBeDisabled()
    await loadFrame(media.stream)
    expect(screen.getByRole('button', { name: '撮影' })).toBeEnabled()
    expect(media.getUserMedia).toHaveBeenCalledExactlyOnceWith({ video: { facingMode: 'environment' }, audio: false })
    expect(media.getCurrentPosition).not.toHaveBeenCalled()
  })

  it.each([[640, 480], [480, 640]])('keeps the browser video orientation in the captured image (%i x %i)', async (width, height) => {
    const media = setup()
    render(<CameraPreview onClose={media.onClose} />)
    await loadFrame(media.stream, width, height)
    await media.user.click(screen.getByRole('button', { name: '撮影' }))
    expect(media.canvasSize).toHaveBeenCalledWith(width, height)
  })

  it('explains permission denial and supports retry and closing', async () => {
    const media = setup()
    media.getUserMedia.mockRejectedValueOnce(new DOMException('private-device-details', 'NotAllowedError'))
    render(<CameraPreview onClose={media.onClose} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('未許可')
    expect(document.body).not.toHaveTextContent('private-device-details')
    await media.user.click(screen.getByRole('button', { name: 'カメラを再試行' }))
    await loadFrame(media.stream)
    expect(media.getUserMedia).toHaveBeenCalledTimes(2)
    await media.user.click(screen.getByRole('button', { name: '撮影を終了' }))
    expect(media.onClose).toHaveBeenCalledTimes(1)
  })

  it('explains how to change a persistent camera permission denial in the address bar site info', async () => {
    const media = setup()
    media.getUserMedia.mockRejectedValue(new DOMException('private-device-details', 'NotAllowedError'))
    render(<CameraPreview onClose={media.onClose} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('サイト設定で許可')
    await media.user.click(screen.getByRole('button', { name: 'カメラを再試行' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('サイト設定で許可')
    expect(media.getUserMedia).toHaveBeenCalledTimes(2)
    expect(document.body).not.toHaveTextContent('private-device-details')
  })

  it('allows closing when camera APIs are unavailable', async () => {
    const media = setup()
    vi.stubGlobal('navigator', Object.assign(Object.create(navigator), { mediaDevices: undefined }))
    render(<CameraPreview onClose={media.onClose} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('カメラ起動失敗')
    await media.user.click(screen.getByRole('button', { name: '撮影を終了' }))
    expect(media.onClose).toHaveBeenCalledTimes(1)
    expect(media.getUserMedia).not.toHaveBeenCalled()
  })

  it('stops an acquired stream when playback fails', async () => {
    const media = setup()
    media.play.mockRejectedValueOnce(new Error('private-playback-details'))
    render(<CameraPreview onClose={media.onClose} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('カメラ起動失敗')
    expect(media.stop).toHaveBeenCalledTimes(1)
    expect(document.body).not.toHaveTextContent('private-playback-details')
  })

  it('shows a local photo, stops capture, and releases the URL on unmount', async () => {
    vi.stubEnv('VITE_CAPTURE_LOCATION_MAP_DEBUG', 'true')
    const media = setup()
    const view = render(<CameraPreview onClose={media.onClose} />)
    await loadFrame(media.stream)
    await media.user.click(screen.getByRole('button', { name: '撮影' }))
    expect(await screen.findByRole('img', { name: '撮影した写真のプレビュー' })).toHaveAttribute('src', 'blob:synthetic-photo-0')
    expect(media.stop).toHaveBeenCalledTimes(1)
    // 精度の一行は出さない。位置取得は行われ、デバッグ地図導線は出る。
    expect(screen.queryByText(/撮影地を紐づけました/)).not.toBeInTheDocument()
    expect(screen.queryByText(/精度 約/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '撮影地' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText(/座標がGoogle Mapsに送信されます/)).not.toBeInTheDocument()
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
    await media.user.click(screen.getByRole('button', { name: '撮影' }))
    expect(await screen.findByRole('img', { name: '撮影した写真のプレビュー' })).toBeVisible()
    expect(media.toBlob).toHaveBeenCalledTimes(1)
    expect(media.drawImage.mock.invocationCallOrder[0]).toBeLessThan(media.getCurrentPosition.mock.invocationCallOrder[0])
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '撮影地' })).not.toBeInTheDocument()
    act(() => media.getCurrentPosition.mock.calls[0][0](position()))
    expect(screen.queryByText(/撮影地を紐づけました/)).not.toBeInTheDocument()
    expect(screen.queryByText(/精度 約/)).not.toBeInTheDocument()
    expect(screen.queryByText('撮影地取得中')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '撮影地' })).not.toBeInTheDocument()
  })

  it('rotates the encoded photo in quarter turns and keeps GPS and capture time', async () => {
    const media = setup()
    const gps = position()
    media.getCurrentPosition.mockImplementationOnce((success) => success(gps))
    const submitAnswer = vi.fn(async (_input: Parameters<DemoAnswerContext['api']['submitAnswer']>[0]) => ({ source: 'mock' as const, state: 'RECEIVED' as const, attemptId: 'attempt-1' }))
    const answer = { api: { submitAnswer, getAttempt: vi.fn() }, challengeId: 'challenge-1', onReloadQuest: vi.fn() } as unknown as DemoAnswerContext
    const view = render(<CameraPreview onClose={media.onClose} answer={answer} />)
    await loadFrame(media.stream)
    const captureStartedAt = Date.now()
    await media.user.click(screen.getByRole('button', { name: '撮影' }))
    const captureFinishedAt = Date.now()
    expect(screen.queryByText(/撮影地を紐づけました/)).not.toBeInTheDocument()
    expect(screen.queryByText(/精度 約/)).not.toBeInTheDocument()
    await media.user.click(screen.getByRole('button', { name: '右に回す' }))
    await waitFor(() => expect(media.createObjectURL).toHaveBeenCalledTimes(2))
    expect(media.canvasSize).toHaveBeenLastCalledWith(480, 640)
    expect(media.translate).toHaveBeenCalledWith(240, 320)
    expect(media.rotate).toHaveBeenCalledWith(Math.PI / 2)
    expect(media.bitmap.close).toHaveBeenCalledOnce()
    expect(media.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:synthetic-photo-0')
    expect(screen.getByRole('img', { name: '撮影した写真のプレビュー' })).toHaveAttribute('src', 'blob:synthetic-photo-1')
    expect(screen.queryByText(/撮影地を紐づけました/)).not.toBeInTheDocument()
    expect(screen.queryByText(/精度 約/)).not.toBeInTheDocument()
    expect(screen.queryByText(/「写真と位置を|で判定します|送信するで写真/)).not.toBeInTheDocument()
    expect(document.querySelector('.camera-overlay > p.sample-note')).toBeNull()
    expect(screen.getByRole('button', { name: '左に回す' })).toBeEnabled()
    await media.user.click(screen.getByRole('button', { name: '送る' }))
    await waitFor(() => expect(submitAnswer).toHaveBeenCalledOnce())
    const { photo, metadata } = submitAnswer.mock.calls[0][0]
    expect(photo).toBe(media.createObjectURL.mock.calls[1][0])
    expect(metadata.position).toEqual({ latitude: 35, longitude: 135, accuracyMeters: 12.4, measuredAt: new Date(gps.timestamp).toISOString() })
    expect(Date.parse(metadata.capturedAt)).toBeGreaterThanOrEqual(captureStartedAt)
    expect(Date.parse(metadata.capturedAt)).toBeLessThanOrEqual(captureFinishedAt)
    view.unmount()
    expect(media.revokeObjectURL).toHaveBeenCalledTimes(2)
    expect(media.revokeObjectURL).toHaveBeenLastCalledWith('blob:synthetic-photo-1')
  })

  it('preserves a durable submission after rotation through pending, receipt and completion', async () => {
    const media = setup()
    const gps = position()
    media.getCurrentPosition.mockImplementationOnce(success => success(gps))
    let finish!: (value: Awaited<ReturnType<DemoAnswerContext['api']['submitAnswer']>>) => void
    const submitAnswer = vi.fn<DemoAnswerContext['api']['submitAnswer']>(() => new Promise(resolve => { finish = resolve }))
    const receipt = { source: 'real' as const, state: 'RECEIVED' as const, attemptId: 'durable-rotated', outcome: null, nextAction: 'WAIT' as const }
    const getAttempt = vi.fn<DemoAnswerContext['api']['getAttempt']>().mockResolvedValue({ ...receipt,
      state: 'COMPLETED', outcome: 'CORRECT', nextAction: 'OPEN_DISCOVERY', optionalDiscoveryId: 'saved-record' })
    const answer: DemoAnswerContext = { api: { submitAnswer, getAttempt }, challengeId: 'durable-challenge',
      dataMode: 'durable-local', onReloadQuest: vi.fn() }
    render(<CameraPreview onClose={media.onClose} answer={answer} />)
    await loadFrame(media.stream)
    const captureStartedAt = Date.now()
    await media.user.click(screen.getByRole('button', { name: '撮影' }))
    const captureFinishedAt = Date.now()
    await media.user.click(screen.getByRole('button', { name: '右に回す' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '送る' })).toBeEnabled())
    await media.user.click(screen.getByRole('button', { name: '送る' }))
    // 判定待ち中は待ち面だけ。撮り直し・回転・結果確認は出さない。
    expect(await screen.findByRole('status', { name: '写真の判定待ち' })).toBeVisible()
    expect(screen.getAllByRole('button').filter(button => button.classList.contains('primary-button'))).toHaveLength(0)
    expect(screen.queryByRole('button', { name: '撮り直す' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '右に回す' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '判定を確認' })).not.toBeInTheDocument()
    const [input, call] = submitAnswer.mock.calls[0]
    expect(input.photo).toBe(media.createObjectURL.mock.calls[1][0])
    expect(input.metadata.position).toEqual({ latitude: 35, longitude: 135, accuracyMeters: 12.4,
      measuredAt: new Date(gps.timestamp).toISOString() })
    expect(Date.parse(input.metadata.capturedAt)).toBeGreaterThanOrEqual(captureStartedAt)
    expect(Date.parse(input.metadata.capturedAt)).toBeLessThanOrEqual(captureFinishedAt)
    expect(call?.signal?.aborted).toBe(false)
    const waiting = screen.getByRole('status', { name: '写真の判定待ち' })
    await act(async () => finish(receipt))
    // 受付後も自動判定待ちが続くため、同じ待ち面のまま（チラつかない）。
    expect(screen.getByRole('status', { name: '写真の判定待ち' })).toBe(waiting)
    expect(screen.queryByText('回答受付済み')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '判定を確認' })).not.toBeInTheDocument()
    expect(media.getUserMedia).toHaveBeenCalledOnce()
    expect(screen.getByRole('img', { name: '撮影した写真のプレビュー' })).toBeVisible()
    expect(media.createImageBitmap).toHaveBeenCalledOnce()
    // 自動ポーリングで完了→クリア画面へ。
    expect(await screen.findByRole('heading', { name: 'クリア！' }, { timeout: 4000 })).toBeVisible()
    expect(getAttempt).toHaveBeenCalledExactlyOnceWith(receipt.attemptId, { signal: expect.any(AbortSignal) })
    expect(submitAnswer).toHaveBeenCalledOnce()
    expect(call?.signal?.aborted).toBe(false)
  })

  it.each(['network', 'cancel'] as const)('keeps retake locked after an uncertain %s and recovers with the same answer', async (failure) => {
    const media = setup()
    const receipt = { source: 'real' as const, state: 'RECEIVED' as const, attemptId: 'kept-receipt', outcome: null, nextAction: 'WAIT' as const }
    const submitAnswer = vi.fn<DemoAnswerContext['api']['submitAnswer']>()
    if (failure === 'network') submitAnswer.mockRejectedValueOnce(new Error('network'))
    else submitAnswer.mockImplementationOnce(() => new Promise(() => {}))
    submitAnswer.mockResolvedValue(receipt)
    const getAttempt = vi.fn<DemoAnswerContext['api']['getAttempt']>().mockResolvedValue({ ...receipt,
      state: 'COMPLETED', outcome: 'WRONG_TARGET', nextAction: 'RETAKE' })
    render(<CameraPreview onClose={media.onClose} answer={{ api: { submitAnswer, getAttempt },
      challengeId: 'challenge', dataMode: 'durable-local', onReloadQuest: vi.fn() }} />)
    await loadFrame(media.stream)
    await media.user.click(screen.getByRole('button', { name: '撮影' }))
    await media.user.click(screen.getByRole('button', { name: '送る' }))
    if (failure === 'cancel') {
      expect(await screen.findByRole('status', { name: '写真の判定待ち' })).toBeVisible()
    expect(screen.getAllByRole('button').filter(button => button.classList.contains('primary-button'))).toHaveLength(0)
      await media.user.click(screen.getByRole('button', { name: 'キャンセル' }))
    }
    expect(await screen.findByRole('alert')).toBeVisible()
    const retake = screen.getByRole('button', { name: '撮り直す' })
    expect(retake).toBeDisabled()
    await media.user.click(retake)
    await media.user.click(screen.getByRole('button', { name: '再送する' }))
    // 再送成功後はまた判定待ち。結果確認ボタンは出さない。
    expect(await screen.findByRole('status', { name: '写真の判定待ち' })).toBeVisible()
    expect(screen.getAllByRole('button').filter(button => button.classList.contains('primary-button'))).toHaveLength(0)
    expect(screen.queryByRole('button', { name: '判定を確認' })).not.toBeInTheDocument()
    expect(submitAnswer.mock.calls[1][0]).toEqual(submitAnswer.mock.calls[0][0])
    expect(screen.queryByRole('button', { name: '撮り直す' })).not.toBeInTheDocument()
    expect(await screen.findByText('合成画像の対象不一致', undefined, { timeout: 4000 })).toBeVisible()
    expect(screen.getByRole('button', { name: '撮り直す' })).toBeEnabled()
    expect(getAttempt).toHaveBeenCalledExactlyOnceWith(receipt.attemptId, { signal: expect.any(AbortSignal) })
    expect(submitAnswer).toHaveBeenCalledTimes(2)
    expect(media.getUserMedia).toHaveBeenCalledOnce()
  })

  it('rotates counterclockwise when that button is selected', async () => {
    const media = setup()
    render(<CameraPreview onClose={media.onClose} />)
    await loadFrame(media.stream)
    await media.user.click(screen.getByRole('button', { name: '撮影' }))
    await media.user.click(screen.getByRole('button', { name: '左に回す' }))
    await waitFor(() => expect(media.createObjectURL).toHaveBeenCalledTimes(2))
    expect(media.canvasSize).toHaveBeenLastCalledWith(480, 640)
    expect(media.rotate).toHaveBeenCalledWith(3 * Math.PI / 2)
  })

  it('locks rotation as soon as a developer submission starts and preserves its receipt', async () => {
    const media = setup()
    const receipt = { source: 'mock' as const, state: 'RECEIVED' as const, attemptId: 'attempt-locked' }
    const submitAnswer = vi.fn(async () => receipt)
    const getAttempt = vi.fn(async () => receipt)
    const answer = { api: { submitAnswer, getAttempt }, challengeId: 'challenge-1', onReloadQuest: vi.fn() } as unknown as DemoAnswerContext
    render(<CameraPreview onClose={media.onClose} answer={answer} />)
    await loadFrame(media.stream)
    await media.user.click(screen.getByRole('button', { name: '撮影' }))
    await media.user.click(screen.getByRole('button', { name: '送る' }))
    // 送信後は回転操作を出さない（判定・受付フローに一本化）。
    expect(screen.queryByRole('button', { name: '左に回す' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '右に回す' })).not.toBeInTheDocument()
    expect(await screen.findByText('送信済み')).toBeVisible()
    await media.user.click(screen.getByRole('button', { name: '判定を確認' }))
    expect(getAttempt).toHaveBeenCalledExactlyOnceWith('attempt-locked', { signal: expect.any(AbortSignal) })
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
    await media.user.click(screen.getByRole('button', { name: '撮影' }))
    await media.user.click(screen.getByRole('button', { name: '右に回す' }))
    const send = screen.getByRole('button', { name: '送る' })
    expect(send).toBeDisabled()
    fireEvent.click(send)
    expect(submitAnswer).not.toHaveBeenCalled()
    await act(async () => resolveBitmap(media.bitmap))
    await waitFor(() => expect(send).toBeEnabled())
    await media.user.click(send)
    expect(await screen.findByText('送信済み')).toBeVisible()
    expect(submitAnswer).toHaveBeenCalledOnce()
  })

  it('locks retake and keeps close available while a submission is pending', async () => {
    const media = setup()
    const submitAnswer = vi.fn(() => new Promise<never>(() => {}))
    const answer = { api: { submitAnswer, getAttempt: vi.fn() }, challengeId: 'challenge-1', onReloadQuest: vi.fn() } as unknown as DemoAnswerContext
    render(<CameraPreview onClose={media.onClose} answer={answer} />)
    await loadFrame(media.stream)
    await media.user.click(screen.getByRole('button', { name: '撮影' }))
    await media.user.click(screen.getByRole('button', { name: '送る' }))
    // 判定・受付待ち中は待ち面だけ。撮り直しや終了、結果確認ボタンは出さない。
    expect(await screen.findByRole('status', { name: '写真の判定待ち' })).toBeVisible()
    expect(screen.getAllByRole('button').filter(button => button.classList.contains('primary-button'))).toHaveLength(0)
    expect(screen.queryByRole('button', { name: '判定を確認' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '撮り直す' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '撮影を終了' })).not.toBeInTheDocument()
    await media.user.click(screen.getByRole('button', { name: 'キャンセル' }))
    expect(screen.getByRole('button', { name: '撮り直す' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '撮影を終了' })).toBeEnabled()
  })

  it('shows the map button only when explicitly enabled in development', async () => {
    vi.stubEnv('VITE_CAPTURE_LOCATION_MAP_DEBUG', 'true')
    const media = setup()
    render(<CameraPreview onClose={media.onClose} />)
    await loadFrame(media.stream)
    await media.user.click(screen.getByRole('button', { name: '撮影' }))
    expect(await screen.findByRole('button', { name: '撮影地' })).toBeInTheDocument()
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
    await media.user.click(screen.getByRole('button', { name: '撮影' }))
    await media.user.click(await screen.findByRole('button', { name: '撮影地' }))
    expect(screen.getByLabelText('撮影地の地図')).toBeVisible()
    await media.user.click(screen.getByRole('button', { name: '撮影地' }))
    expect(screen.queryByLabelText('撮影地の地図')).not.toBeInTheDocument()
    expect(screen.getByRole('img', { name: '撮影した写真のプレビュー' })).toHaveAttribute('src', 'blob:synthetic-photo-0')
    expect(screen.queryByText(/撮影地を紐づけました/)).not.toBeInTheDocument()
    expect(screen.queryByText(/精度 約/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '撮影地' })).toBeEnabled()
    expect(media.revokeObjectURL).not.toHaveBeenCalled()
    await media.user.click(screen.getByRole('button', { name: '撮影地' }))
    await media.user.click(screen.getByRole('button', { name: '撮り直す' }))
    await loadFrame(second)
    expect(media.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:synthetic-photo-0')
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('撮影地の地図')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '撮影地' })).not.toBeInTheDocument()
    view.unmount()
    expect(stopSecond).toHaveBeenCalledTimes(1)
  })

  it('does not let a late playback failure overwrite a completed photo', async () => {
    const media = setup()
    let reject!: (cause: Error) => void
    media.play.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail }))
    render(<CameraPreview onClose={media.onClose} />)
    await loadFrame(media.stream)
    await media.user.click(screen.getByRole('button', { name: '撮影' }))
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
    await media.user.click(screen.getByRole('button', { name: '撮影' }))
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
    await media.user.click(screen.getByRole('button', { name: '撮影' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('写真作成失敗')
    expect(media.createObjectURL).not.toHaveBeenCalled()
    expect(media.stop).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'カメラを再試行' })).toBeEnabled()
  })

  it('does not present a blank photo when canvas drawing is unavailable', async () => {
    const media = setup()
    media.getContext.mockReturnValueOnce(null)
    render(<CameraPreview onClose={media.onClose} />)
    await loadFrame(media.stream)
    await media.user.click(screen.getByRole('button', { name: '撮影' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('写真作成失敗')
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
    await media.user.dblClick(screen.getByRole('button', { name: '撮影' }))
    expect(media.toBlob).toHaveBeenCalledTimes(1)
    act(() => callback(new Blob(['synthetic-photo'])))
    expect(media.createObjectURL).toHaveBeenCalledTimes(1)
  })

  it.each([1, 2, 3])('keeps the photo after location error %s and allows a location retry', async (code) => {
    const media = setup()
    media.getCurrentPosition.mockImplementationOnce((_success, failure) => failure?.(positionError(code)))
    render(<CameraPreview onClose={media.onClose} />)
    await loadFrame(media.stream)
    await media.user.click(screen.getByRole('button', { name: '撮影' }))
    expect(screen.getByRole('alert')).toHaveTextContent(code === 1 ? '未許可' : '取得失敗')
    if (code === 1) expect(screen.getByRole('alert')).toHaveTextContent('位置情報未許可。サイト設定で許可')
    expect(document.body).not.toHaveTextContent('private-location-details')
    expect(await screen.findByRole('img', { name: '撮影した写真のプレビュー' })).toBeVisible()
    expect(screen.queryByRole('button', { name: '撮影地' })).not.toBeInTheDocument()
    expect(media.toBlob).toHaveBeenCalledTimes(1)
    expect(media.getCurrentPosition).toHaveBeenCalledTimes(1)
    await media.user.click(screen.getByRole('button', { name: '位置を再取得' }))
    expect(screen.getByRole('img', { name: '撮影した写真のプレビュー' })).toBeVisible()
    expect(screen.queryByText(/撮影地を紐づけました/)).not.toBeInTheDocument()
    expect(screen.queryByText(/精度 約/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '位置を再取得' })).not.toBeInTheDocument()
    expect(media.getCurrentPosition).toHaveBeenCalledTimes(2)
  })

  it('keeps a photo when the location API is unavailable', async () => {
    const media = setup()
    vi.stubGlobal('navigator', Object.assign(Object.create(navigator), { geolocation: undefined }))
    render(<CameraPreview onClose={media.onClose} />)
    await loadFrame(media.stream)
    await media.user.click(screen.getByRole('button', { name: '撮影' }))
    expect(screen.getByRole('alert')).toHaveTextContent('位置情報非対応')
    expect(screen.getByRole('button', { name: '位置を再取得' })).toBeEnabled()
    expect(media.toBlob).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('img', { name: '撮影した写真のプレビュー' })).toBeVisible()
  })

  it('recovers from a synchronous location API exception without exposing device details', async () => {
    const media = setup()
    media.getCurrentPosition.mockImplementationOnce(() => { throw new DOMException('private-location-details', 'SecurityError') })
    render(<CameraPreview onClose={media.onClose} />)
    await loadFrame(media.stream)
    await media.user.click(screen.getByRole('button', { name: '撮影' }))
    expect(screen.getByRole('alert')).toHaveTextContent('撮影地取得失敗')
    expect(document.body).not.toHaveTextContent('private-location-details')
    expect(screen.getByRole('button', { name: '位置を再取得' })).toBeEnabled()
    expect(screen.getByRole('img')).toBeVisible()
    await media.user.click(screen.getByRole('button', { name: '位置を再取得' }))
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
    await media.user.click(screen.getByRole('button', { name: '撮影' }))
    const success = media.getCurrentPosition.mock.calls[0][0]
    expect(() => act(() => success(location))).not.toThrow()
    expect(screen.getByRole('alert')).toHaveTextContent('撮影地取得失敗')
    expect(screen.getByRole('button', { name: '位置を再取得' })).toBeEnabled()
    expect(media.toBlob).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('img', { name: '撮影した写真のプレビュー' })).toBeVisible()
    await media.user.click(screen.getByRole('button', { name: '位置を再取得' }))
    expect(screen.getByRole('img')).toBeVisible()
  })

  it.each(['close', 'unmount', 'pagehide'] as const)('ignores a pending location after %s', async (leave) => {
    const media = setup()
    media.getCurrentPosition.mockImplementationOnce(() => {})
    const view = render(<CameraPreview onClose={media.onClose} />)
    await loadFrame(media.stream)
    await media.user.click(screen.getByRole('button', { name: '撮影' }))
    const success = media.getCurrentPosition.mock.calls[0][0]
    if (leave === 'close') vi.spyOn(window, 'confirm').mockReturnValue(true)
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
    const capture = screen.getByRole('button', { name: '撮影' })
    fireEvent.click(capture)
    fireEvent.click(capture)
    expect(media.getCurrentPosition).toHaveBeenCalledTimes(1)
    expect(media.toBlob).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: '位置を再取得' })).toBeDisabled()
    act(() => media.getCurrentPosition.mock.calls[0][0](position()))
    await media.user.click(screen.getByRole('button', { name: '撮り直す' }))
    await loadFrame(media.stream)
    expect(screen.queryByText(/撮影地を紐づけました/)).not.toBeInTheDocument()
    media.getCurrentPosition.mockImplementationOnce(success => success(position({ accuracy: 32 })))
    await media.user.click(screen.getByRole('button', { name: '撮影' }))
    expect(screen.queryByText(/撮影地を紐づけました/)).not.toBeInTheDocument()
    expect(screen.queryByText(/精度 約/)).not.toBeInTheDocument()
    expect(screen.queryByText('撮影地取得中')).not.toBeInTheDocument()
    expect(media.getCurrentPosition).toHaveBeenCalledTimes(2)
  })

  it.each(['success', 'error'] as const)('ignores the previous photo location %s while a retake is locating', async (result) => {
    const media = setup()
    media.getCurrentPosition.mockImplementation(() => {})
    media.createObjectURL.mockReturnValueOnce('blob:first-photo').mockReturnValueOnce('blob:second-photo')
    render(<CameraPreview onClose={media.onClose} />)
    await loadFrame(media.stream)
    await media.user.click(screen.getByRole('button', { name: '撮影' }))
    const [oldSuccess, oldFailure] = media.getCurrentPosition.mock.calls[0]
    await media.user.click(screen.getByRole('button', { name: '撮り直す' }))
    await loadFrame(media.stream)
    await media.user.click(screen.getByRole('button', { name: '撮影' }))
    act(() => result === 'success' ? oldSuccess(position({ accuracy: 99 })) : oldFailure?.(positionError(2)))
    expect(screen.getByRole('img')).toHaveAttribute('src', 'blob:second-photo')
    expect(screen.getByRole('status')).toHaveTextContent('撮影地取得中')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByText(/撮影地を紐づけました/)).not.toBeInTheDocument()
    expect(media.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:first-photo')
    act(() => media.getCurrentPosition.mock.calls[1][0](position({ accuracy: 32 })))
    expect(screen.queryByText(/撮影地を紐づけました/)).not.toBeInTheDocument()
    expect(screen.queryByText(/精度 約/)).not.toBeInTheDocument()
    expect(screen.queryByText('撮影地取得中')).not.toBeInTheDocument()
    expect(media.toBlob).toHaveBeenCalledTimes(2)
  })

  it.each(['success', 'error'] as const)('ignores a location %s after photo encoding fails', async (result) => {
    const media = setup()
    media.getCurrentPosition.mockImplementationOnce(() => {})
    let encode!: BlobCallback
    media.toBlob.mockImplementationOnce(done => { encode = done })
    render(<CameraPreview onClose={media.onClose} />)
    await loadFrame(media.stream)
    await media.user.click(screen.getByRole('button', { name: '撮影' }))
    const [success, failure] = media.getCurrentPosition.mock.calls[0]
    act(() => encode(null))
    act(() => result === 'success' ? success(position()) : failure?.(positionError(2)))
    expect(screen.getByRole('alert')).toHaveTextContent('写真作成失敗')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'カメラを再試行' })).toBeEnabled()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(media.createObjectURL).not.toHaveBeenCalled()
  })
})

describe('confirm photo layout CSS', () => {
  it('keeps overlay photo in normal flow between chrome cards (not full-bleed absolute)', async () => {
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const css = readFileSync(resolve(process.cwd(), 'src/App.css'), 'utf8')
    expect(css).toMatch(/\.camera-overlay \.camera-video, \.camera-overlay \.photo-preview \{[^}]*position: relative/)
    expect(css).toMatch(/\.camera-overlay \.camera-shutter-controls \{[^}]*display: flex; justify-content: center; width: 100%/ )
    expect(css).toMatch(/\.camera-overlay \.camera-shutter \{[^}]*width: 64px; height: 64px;[^}]*border-radius: 50%/ )
    expect(css).not.toMatch(/\.camera-overlay \.camera-video, \.camera-overlay \.photo-preview \{[^}]*position: absolute; inset: 0/)
    expect(css).toMatch(/\.camera-overlay \.camera-video, \.camera-overlay \.photo-preview \{[^}]*flex: 1 1 auto/)
  })
})

it('撮影中も問題名・手がかりを開閉できる', async () => {
  const media = setup()
  render(<CameraPreview onClose={media.onClose} clue="塔の窓を探す" hints={['丸い窓が目印']} answer={{ api: { submitAnswer: vi.fn(), getAttempt: vi.fn() }, challengeId: 'c', questTitle: '窓の謎', onReloadQuest: vi.fn() }} />)
  expect(screen.getByRole('heading', { name: '窓の謎' })).toBeVisible()
  const summary = screen.getByText('手がかり')
  expect(summary.parentElement).not.toHaveAttribute('open')
  await media.user.click(summary)
  expect(summary.parentElement).toHaveAttribute('open')
  expect(screen.getByText('塔の窓を探す')).toBeVisible()
  expect(screen.getByText('丸い窓が目印')).toBeVisible()
})

it('カメラは背景をinertにし、Tabを閉じ込め、未送信写真のEsc終了を確認する', async () => {
  const media = setup()
  const { container, unmount } = render(<CameraPreview onClose={media.onClose} />)
  const dialog = screen.getByRole('dialog', { name: '写真撮影と確認' })
  expect(dialog).toHaveAttribute('aria-modal', 'true')
  expect(container).toHaveAttribute('inert')
  await loadFrame(media.stream)
  const close = screen.getByRole('button', { name: '撮影を終了' })
  close.focus()
  await media.user.tab()
  expect(screen.getByRole('button', { name: '撮影' })).toHaveFocus()
  await media.user.tab({ shift: true })
  expect(close).toHaveFocus()
  await media.user.click(screen.getByRole('button', { name: '撮影' }))
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  fireEvent.keyDown(window, { key: 'Escape' })
  expect(confirm).toHaveBeenCalledOnce()
  expect(media.onClose).not.toHaveBeenCalled()
  fireEvent.popState(window, { state: null })
  expect(confirm).toHaveBeenCalledTimes(2)
  expect(window.history.state.camera).toBe(true)
  expect(media.onClose).not.toHaveBeenCalled()
  confirm.mockReturnValue(true)
  fireEvent.keyDown(window, { key: 'Escape' })
  expect(media.onClose).toHaveBeenCalledOnce()
  unmount()
  expect(container).not.toHaveAttribute('inert')
})

it('カメラ拒否時は撮影ボタンを隠して黄色の再試行を出す', async () => {
  const media = setup()
  media.getUserMedia.mockRejectedValue(new DOMException('denied', 'NotAllowedError'))
  render(<CameraPreview onClose={media.onClose} />)
  expect(await screen.findByRole('button', { name: 'カメラを再試行' })).toHaveClass('primary-button')
  expect(screen.queryByRole('button', { name: '撮影' })).not.toBeInTheDocument()
})

it.each(['WRONG_TARGET', 'OUTSIDE_AREA', 'LOCATION_UNCERTAIN', 'IMAGE_UNCERTAIN', 'SYSTEM_ERROR'])('%sの後は撮り直すが主ボタンになる', async outcome => {
  const media = setup()
  render(<CameraPreview onClose={media.onClose} answer={{ api: { submitAnswer: vi.fn().mockResolvedValue({ attemptId: 'a', state: 'COMPLETED', outcome, source: 'real', nextAction: 'RETAKE' }), getAttempt: vi.fn() }, challengeId: 'c', dataMode: 'team-preview', questTitle: '窓の謎', onReloadQuest: vi.fn() }} />)
  await loadFrame(media.stream)
  await media.user.click(screen.getByRole('button', { name: '撮影' }))
  await media.user.click(await screen.findByRole('button', { name: '送る' }))
  expect(screen.getByRole('button', { name: '撮り直す' })).toHaveClass('primary-button')
  expect(screen.getAllByRole('button').filter(button => button.classList.contains('primary-button'))).toEqual([screen.getByRole('button', { name: '撮り直す' })])
  if (outcome === 'OUTSIDE_AREA') expect(screen.getByText('窓の謎：範囲内で撮り直す')).toBeVisible()
  if (outcome === 'SYSTEM_ERROR') expect(screen.getByRole('button', { name: '同じ写真で再送' })).toBeEnabled()
})


it('確定したシステムエラーは同じ写真で新しい回答として再送できる', async () => {
  const media = setup()
  const submitAnswer = vi.fn().mockResolvedValueOnce({ attemptId: 'failed', state: 'COMPLETED', outcome: 'SYSTEM_ERROR', source: 'real', nextAction: 'RETRY' }).mockResolvedValue({ attemptId: 'retried', state: 'COMPLETED', outcome: 'WRONG_TARGET', source: 'real', nextAction: 'RETAKE' })
  render(<CameraPreview onClose={media.onClose} answer={{ api: { submitAnswer, getAttempt: vi.fn() }, challengeId: 'c', dataMode: 'team-preview', onReloadQuest: vi.fn() }} />)
  await loadFrame(media.stream)
  await media.user.click(screen.getByRole('button', { name: '撮影' }))
  await media.user.click(await screen.findByRole('button', { name: '送る' }))
  await media.user.click(await screen.findByRole('button', { name: '同じ写真で再送' }))
  expect(submitAnswer).toHaveBeenCalledTimes(2)
  const first = submitAnswer.mock.calls[0][0], second = submitAnswer.mock.calls[1][0]
  expect(second.photo).toBe(first.photo)
  expect(second.metadata).toEqual(first.metadata)
  expect(second.idempotencyKey).not.toBe(first.idempotencyKey)
  expect(media.getUserMedia).toHaveBeenCalledTimes(1)
})


it('クリア画面から撮影を終了すると重なったdialogの背景inertを解除する', async () => {
  const media = setup()
  function Host() {
    const [open, setOpen] = useState(true)
    return open && <CameraPreview onClose={() => {}} answer={{ api: { submitAnswer: vi.fn().mockResolvedValue({ attemptId: 'a', state: 'COMPLETED', outcome: 'CORRECT', optionalDiscoveryId: 'd', source: 'real', nextAction: 'OPEN_DISCOVERY' }), getAttempt: vi.fn() }, challengeId: 'c', dataMode: 'team-preview', onReloadQuest: vi.fn(), onReturnToMap: () => setOpen(false) }} />
  }
  const { container } = render(<Host />)
  await loadFrame(media.stream)
  await media.user.click(screen.getByRole('button', { name: '撮影' }))
  await media.user.click(await screen.findByRole('button', { name: '送る' }))
  await media.user.click(await screen.findByRole('button', { name: '地図に戻る' }))
  expect(container).not.toHaveAttribute('inert')
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})
