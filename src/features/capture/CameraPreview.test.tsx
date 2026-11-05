import { StrictMode } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { CameraPreview } from './CameraPreview'

function setup() {
  const stop = vi.fn()
  const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream
  const getUserMedia = vi.fn(async () => stream)
  vi.stubGlobal('navigator', Object.assign(Object.create(navigator), { mediaDevices: { getUserMedia } }))
  const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
  const drawImage = vi.fn()
  const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D)
  const toBlob = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => callback(new Blob(['synthetic-photo'], { type: 'image/jpeg' })))
  const createObjectURL = vi.fn((_blob: Blob | MediaSource) => 'blob:synthetic-photo')
  const revokeObjectURL = vi.fn((_url: string) => {})
  vi.stubGlobal('URL', class extends URL { static createObjectURL = createObjectURL; static revokeObjectURL = revokeObjectURL })
  const onClose = vi.fn()
  return { stop, stream, getUserMedia, play, getContext, toBlob, createObjectURL, revokeObjectURL, onClose, user: userEvent.setup() }
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
    expect(media.toBlob.mock.calls[0].slice(1)).toEqual(['image/jpeg', .9])
    view.unmount()
    expect(media.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:synthetic-photo')
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
})
