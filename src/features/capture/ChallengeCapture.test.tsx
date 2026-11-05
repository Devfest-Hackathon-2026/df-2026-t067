import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ApiError, createApiClient } from '../../shared/api'
import { challenge, quest } from '../../shared/api/testFixtures'
import { ChallengeCapture } from './ChallengeCapture'

function fixture() {
  const stop = vi.fn()
  const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream
  const getUserMedia = vi.fn(async () => stream)
  vi.stubGlobal('navigator', Object.assign(Object.create(navigator), { mediaDevices: { getUserMedia } }))
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
  const createChallenge = vi.fn().mockResolvedValue(challenge)
  const submitAnswer = vi.fn()
  const getAttempt = vi.fn()
  const api = { ...createApiClient(), createChallenge, submitAnswer, getAttempt }
  const reload = vi.fn()
  const view = render(<ChallengeCapture api={api} quest={quest} onReloadQuest={reload} />)
  return { ...view, createChallenge, submitAnswer, getAttempt, getUserMedia, stop, reload, user: userEvent.setup() }
}

function takePhoto() {
  const photo = new Blob(['synthetic-photo'], { type: 'image/jpeg' })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D)
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => callback(photo))
  vi.stubGlobal('URL', class extends URL { static createObjectURL = () => 'blob:synthetic'; static revokeObjectURL = () => {} })
  const measuredAt = Date.now()
  vi.stubGlobal('navigator', Object.assign(Object.create(navigator), { geolocation: {
    getCurrentPosition: (success: PositionCallback) => success({
      coords: { latitude: 0, longitude: 0, accuracy: 10 }, timestamp: measuredAt,
    } as GeolocationPosition),
  } }))
  const video = screen.getByLabelText('カメラ映像') as HTMLVideoElement
  Object.defineProperties(video, { videoWidth: { value: 640 }, videoHeight: { value: 480 }, readyState: { value: 2 } })
  fireEvent.loadedData(video)
  fireEvent.click(screen.getByRole('button', { name: '撮影する' }))
  return { photo, measuredAt }
}

describe('challenge before camera', () => {
  it('only sends after explicit confirmation, reuses the retry key, and checks a known receipt by GET', async () => {
    const f = fixture()
    const receipt = { attemptId: 'demo-receipt', state: 'RECEIVED', outcome: null, nextAction: 'WAIT', source: 'mock' }
    f.submitAnswer.mockRejectedValueOnce(new ApiError('NETWORK_ERROR')).mockResolvedValueOnce(receipt)
    f.getAttempt.mockRejectedValueOnce(new ApiError('QUEST_UNAVAILABLE'))
    await f.user.click(screen.getByRole('button', { name: '挑戦を始める' }))
    await waitFor(() => expect(f.getUserMedia).toHaveBeenCalledTimes(1))
    const { photo, measuredAt } = takePhoto()
    expect(f.submitAnswer).not.toHaveBeenCalled()
    await f.user.click(screen.getByRole('button', { name: '写真と位置をデモ送信' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('通信状況')
    await f.user.click(screen.getByRole('button', { name: '同じ回答を再送' }))
    expect(await screen.findByText(/デモ受付済み/)).toBeVisible()
    expect(f.submitAnswer).toHaveBeenCalledTimes(2)
    expect(f.submitAnswer.mock.calls[0][0]).toEqual({ photo, challengeId: challenge.challengeId,
      metadata: { capturedAt: expect.any(String), position: { latitude: 0, longitude: 0,
        accuracyMeters: 10, measuredAt: new Date(measuredAt).toISOString() } }, idempotencyKey: expect.any(String) })
    expect(f.submitAnswer.mock.calls[1][0]).toEqual(f.submitAnswer.mock.calls[0][0])
    await f.user.click(screen.getByRole('button', { name: '受付状態を確認' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('この問題の受付は終了')
    expect(f.getAttempt).toHaveBeenCalledExactlyOnceWith(receipt.attemptId, { signal: expect.any(AbortSignal) })
    expect(f.submitAnswer).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['OUTSIDE_AREA', 'MOVE_TO_AREA', '指定の撮影範囲外'],
    ['LOCATION_UNCERTAIN', 'RETAKE', '位置を確認できませんでした'],
  ])('shows %s separately from a receipt', async (outcome, nextAction, message) => {
    const f = fixture()
    f.submitAnswer.mockResolvedValue({ attemptId: 'demo-receipt', state: 'COMPLETED', outcome, nextAction, source: 'mock' })
    await f.user.click(screen.getByRole('button', { name: '挑戦を始める' }))
    await waitFor(() => expect(f.getUserMedia).toHaveBeenCalledTimes(1))
    takePhoto()
    await f.user.click(screen.getByRole('button', { name: '写真と位置をデモ送信' }))
    expect(await screen.findByText(new RegExp(message))).toBeVisible()
    expect(screen.queryByText(/デモ受付済み/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '撮り直す' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: '受付状態を確認' })).not.toBeInTheDocument()
  })

  it('blocks a duplicate upload and ignores a reply after leaving the camera', async () => {
    const f = fixture()
    const receipt = { attemptId: 'demo-receipt', state: 'RECEIVED', outcome: null, nextAction: 'WAIT', source: 'mock' }
    let resolve!: (value: typeof receipt) => void
    f.submitAnswer.mockImplementationOnce(() => new Promise((done) => { resolve = done }))
    await f.user.click(screen.getByRole('button', { name: '挑戦を始める' }))
    await waitFor(() => expect(f.getUserMedia).toHaveBeenCalledTimes(1))
    takePhoto()
    const send = screen.getByRole('button', { name: '写真と位置をデモ送信' })
    fireEvent.click(send)
    fireEvent.click(send)
    expect(f.submitAnswer).toHaveBeenCalledTimes(1)
    const signal = f.submitAnswer.mock.calls[0][1].signal as AbortSignal
    await f.user.click(screen.getByRole('button', { name: '撮影を終了' }))
    expect(signal.aborted).toBe(true)
    await act(async () => resolve(receipt))
    expect(screen.queryByText(/デモ受付済み/)).not.toBeInTheDocument()
  })
  it('waits for an explicit start and matching response, and locks duplicate starts', async () => {
    const f = fixture()
    let resolve!: (value: typeof challenge) => void
    f.createChallenge.mockImplementationOnce(() => new Promise((done) => { resolve = done }))
    expect(f.createChallenge).not.toHaveBeenCalled()
    expect(f.getUserMedia).not.toHaveBeenCalled()
    const start = screen.getByRole('button', { name: '挑戦を始める' })
    fireEvent.click(start)
    fireEvent.click(start)
    expect(f.createChallenge).toHaveBeenCalledTimes(1)
    expect(f.createChallenge).toHaveBeenCalledWith({ questId: quest.questId, expectedVersion: quest.version }, { signal: expect.any(AbortSignal) })
    expect(f.getUserMedia).not.toHaveBeenCalled()
    await act(async () => resolve(challenge))
    await waitFor(() => expect(f.getUserMedia).toHaveBeenCalledTimes(1))
    expect(document.body).not.toHaveTextContent(challenge.challengeId)
    await f.user.click(screen.getByRole('button', { name: '撮影を終了' }))
    expect(f.stop).toHaveBeenCalledTimes(1)
    expect(screen.getByText('挑戦を開始しました。写真と位置を確認してからデモ送信できます。')).toBeVisible()
    await f.user.click(screen.getByRole('button', { name: '撮影を再開' }))
    await waitFor(() => expect(f.getUserMedia).toHaveBeenCalledTimes(2))
    expect(f.createChallenge).toHaveBeenCalledTimes(2)
  })

  it.each(['cancel', 'unmount', 'pagehide'] as const)('aborts on %s and discards a late success', async (leave) => {
    const f = fixture()
    let resolve!: (value: typeof challenge) => void
    f.createChallenge.mockImplementationOnce(() => new Promise((done) => { resolve = done }))
    fireEvent.click(screen.getByRole('button', { name: '挑戦を始める' }))
    const signal = f.createChallenge.mock.calls[0][1].signal as AbortSignal
    if (leave === 'cancel') await f.user.click(screen.getByRole('button', { name: '開始をキャンセル' }))
    else if (leave === 'unmount') f.unmount()
    else act(() => window.dispatchEvent(new Event('pagehide')))
    expect(signal.aborted).toBe(true)
    await act(async () => resolve(challenge))
    expect(f.getUserMedia).not.toHaveBeenCalled()
  })

  it('times out after ten seconds without accepting a late response', async () => {
    vi.useFakeTimers()
    try {
      const f = fixture()
      let resolve!: (value: typeof challenge) => void
      f.createChallenge.mockImplementationOnce(() => new Promise((done) => { resolve = done }))
      fireEvent.click(screen.getByRole('button', { name: '挑戦を始める' }))
      await act(async () => vi.advanceTimersByTimeAsync(10_000))
      expect(screen.getByRole('alert')).toHaveTextContent('時間がかかっています')
      expect(f.createChallenge.mock.calls[0][1].signal.aborted).toBe(true)
      await act(async () => resolve(challenge))
      expect(f.getUserMedia).not.toHaveBeenCalled()
      f.unmount()
    } finally { vi.useRealTimers() }
  })

  it('keeps a new start pending when a cancelled operation finishes late', async () => {
    const f = fixture()
    let oldResolve!: (value: typeof challenge) => void
    let newResolve!: (value: typeof challenge) => void
    f.createChallenge.mockImplementationOnce(() => new Promise((done) => { oldResolve = done }))
      .mockImplementationOnce(() => new Promise((done) => { newResolve = done }))
    await f.user.click(screen.getByRole('button', { name: '挑戦を始める' }))
    await f.user.click(screen.getByRole('button', { name: '開始をキャンセル' }))
    await f.user.click(screen.getByRole('button', { name: '挑戦を始める' }))
    await act(async () => oldResolve(challenge))
    expect(screen.getByRole('button', { name: '挑戦を開始しています…' })).toBeDisabled()
    expect(f.getUserMedia).not.toHaveBeenCalled()
    await act(async () => newResolve(challenge))
    await waitFor(() => expect(f.getUserMedia).toHaveBeenCalledTimes(1))
    expect(f.createChallenge).toHaveBeenCalledTimes(2)
  })

  it.each([{ questId: 'other-question' }, { version: 2 }])('refuses a response for another question or version: %o', async (change) => {
    const f = fixture()
    f.createChallenge.mockResolvedValueOnce({ ...challenge, ...change })
    await f.user.click(screen.getByRole('button', { name: '挑戦を始める' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('開始を確認できませんでした')
    expect(f.getUserMedia).not.toHaveBeenCalled()
  })

  it('requires a question reload on version conflict and never starts automatically', async () => {
    const f = fixture()
    f.createChallenge.mockRejectedValueOnce(new ApiError('QUEST_CHANGED', { status: 409 }))
    await f.user.click(screen.getByRole('button', { name: '挑戦を始める' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('問題が更新されました')
    expect(screen.getByRole('button', { name: '挑戦を始める' })).toBeDisabled()
    await f.user.click(screen.getByRole('button', { name: '問題を読み直す' }))
    expect(f.reload).toHaveBeenCalledTimes(1)
    expect(f.createChallenge).toHaveBeenCalledTimes(1)
    expect(f.getUserMedia).not.toHaveBeenCalled()
  })

  it('honors Retry-After without automatically retrying the POST', async () => {
    vi.useFakeTimers()
    try {
      const f = fixture()
      f.createChallenge.mockRejectedValueOnce(new ApiError('RATE_LIMITED', { status: 429, retryAfterSeconds: 3 }))
      fireEvent.click(screen.getByRole('button', { name: '挑戦を始める' }))
      await act(async () => {})
      expect(screen.getByRole('alert')).toHaveTextContent('3秒後')
      expect(screen.getByRole('button', { name: '挑戦を始める' })).toBeDisabled()
      await act(async () => vi.advanceTimersByTimeAsync(2_000))
      expect(screen.getByRole('button', { name: '挑戦を始める' })).toBeDisabled()
      await act(async () => vi.advanceTimersByTimeAsync(1_000))
      expect(screen.getByRole('button', { name: '挑戦を始める' })).toBeEnabled()
      expect(f.createChallenge).toHaveBeenCalledTimes(1)
      fireEvent.click(screen.getByRole('button', { name: '挑戦を始める' }))
      await act(async () => {})
      expect(f.createChallenge).toHaveBeenCalledTimes(2)
      f.unmount()
    } finally { vi.useRealTimers() }
  })

  it.each([
    [new ApiError('UNAUTHENTICATED', { status: 401 }), 'ログインを確認できませんでした'],
    [new ApiError('AUTH_UNAVAILABLE', { status: 503 }), 'ログイン確認を利用できません'],
    [new ApiError('NETWORK_ERROR'), '通信状況を確認'],
    [new Error('private-sdk-details'), '開始を確認できませんでした'],
  ])('shows a safe failure and leaves the camera closed', async (error, message) => {
    const f = fixture()
    f.createChallenge.mockRejectedValueOnce(error)
    await f.user.click(screen.getByRole('button', { name: '挑戦を始める' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(message as string)
    expect(document.body).not.toHaveTextContent('private-sdk-details')
    expect(f.getUserMedia).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '挑戦を始める' })).toBeEnabled()
  })
})
