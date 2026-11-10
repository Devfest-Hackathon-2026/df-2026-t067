import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ApiError, createApiClient } from '../../shared/api'
import type { LocalApiDataMode } from '../../shared/api'
import { challenge, quest } from '../../shared/api/testFixtures'
import { ChallengeCapture } from './ChallengeCapture'

function fixture(dataMode: LocalApiDataMode = 'demo') {
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
  const view = render(<ChallengeCapture api={api} quest={quest} dataMode={dataMode} onReloadQuest={reload} />)
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
  fireEvent.click(screen.getByRole('button', { name: '撮影' }))
  return { photo, measuredAt }
}

describe('challenge before camera', () => {
  it('PC幅では開始状態を直接表示してもQRだけを出し、開始APIもカメラも呼ばない', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
    const f = fixture('durable-local')
    f.rerender(<ChallengeCapture api={{ ...createApiClient(), createChallenge: f.createChallenge }} quest={quest}
      onReloadQuest={f.reload} autoStart canAutoStart={() => true} />)
    expect(screen.getByRole('img', { name: /QRコード/ })).toBeVisible()
    await act(async () => {})
    expect(f.createChallenge).not.toHaveBeenCalled()
    expect(f.getUserMedia).not.toHaveBeenCalled()
    expect(f.container.querySelector('input[type="file"], video')).toBeNull()
    expect(screen.queryByRole('button', { name: '挑戦する' })).not.toBeInTheDocument()
  })

  it('shows a durable receipt and its completed result without submitting twice', async () => {
    const f = fixture('durable-local')
    const receipt = { attemptId: 'durable-receipt', state: 'RECEIVED', outcome: null, nextAction: 'WAIT', source: 'real' }
    f.submitAnswer.mockResolvedValue(receipt)
    f.getAttempt.mockResolvedValue({ ...receipt, state: 'COMPLETED', outcome: 'CORRECT',
      nextAction: 'OPEN_DISCOVERY', optionalDiscoveryId: 'durable-discovery' })
    await f.user.click(screen.getByRole('button', { name: '挑戦する' }))
    await waitFor(() => expect(f.getUserMedia).toHaveBeenCalledTimes(1))
    takePhoto()
    await f.user.click(screen.getByRole('button', { name: '送る' }))
    expect(await screen.findByRole('status', { name: '写真の判定待ち' })).toHaveTextContent('写真確認中')
    expect(screen.queryByRole('button', { name: '判定を確認' })).not.toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'クリア！' }, { timeout: 4000 })).toBeVisible()
    expect(f.getAttempt).toHaveBeenCalledExactlyOnceWith(receipt.attemptId, { signal: expect.any(AbortSignal) })
    expect(f.submitAnswer).toHaveBeenCalledTimes(1)
  })
  it('only sends after explicit confirmation, reuses the retry key, and checks a known receipt by GET', async () => {
    const f = fixture()
    const receipt = { attemptId: 'demo-receipt', state: 'RECEIVED', outcome: null, nextAction: 'WAIT', source: 'mock' }
    f.submitAnswer.mockRejectedValueOnce(new ApiError('NETWORK_ERROR')).mockResolvedValueOnce(receipt)
    f.getAttempt.mockRejectedValueOnce(new ApiError('QUEST_UNAVAILABLE'))
    await f.user.click(screen.getByRole('button', { name: '挑戦する' }))
    await waitFor(() => expect(f.getUserMedia).toHaveBeenCalledTimes(1))
    const { photo, measuredAt } = takePhoto()
    expect(f.submitAnswer).not.toHaveBeenCalled()
    await f.user.click(screen.getByRole('button', { name: '送る' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('通信失敗')
    await f.user.click(screen.getByRole('button', { name: '再送する' }))
    expect(await screen.findByText(/送信済み/)).toBeVisible()
    expect(f.submitAnswer).toHaveBeenCalledTimes(2)
    expect(f.submitAnswer.mock.calls[0][0]).toEqual({ photo, challengeId: challenge.challengeId,
      metadata: { capturedAt: expect.any(String), position: { latitude: 0, longitude: 0,
        accuracyMeters: 10, measuredAt: new Date(measuredAt).toISOString() } }, idempotencyKey: expect.any(String) })
    expect(f.submitAnswer.mock.calls[1][0]).toEqual(f.submitAnswer.mock.calls[0][0])
    await f.user.click(screen.getByRole('button', { name: '判定を確認' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('受付終了')
    expect(f.getAttempt).toHaveBeenCalledExactlyOnceWith(receipt.attemptId, { signal: expect.any(AbortSignal) })
    expect(f.submitAnswer).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['OUTSIDE_AREA', 'MOVE_TO_AREA', '撮影範囲外'],
    ['LOCATION_UNCERTAIN', 'RETAKE', '位置未確認'],
  ])('shows %s separately from a receipt', async (outcome, nextAction, message) => {
    const f = fixture()
    f.submitAnswer.mockResolvedValue({ attemptId: 'demo-receipt', state: 'COMPLETED', outcome, nextAction, source: 'mock' })
    await f.user.click(screen.getByRole('button', { name: '挑戦する' }))
    await waitFor(() => expect(f.getUserMedia).toHaveBeenCalledTimes(1))
    takePhoto()
    await f.user.click(screen.getByRole('button', { name: '送る' }))
    expect(await screen.findByText(new RegExp(message))).toBeVisible()
    expect(screen.queryByText(/送信済み/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '撮り直す' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: '判定を確認' })).not.toBeInTheDocument()
  })

  it('blocks a duplicate upload and ignores a reply after leaving the camera', async () => {
    const f = fixture()
    const receipt = { attemptId: 'demo-receipt', state: 'RECEIVED', outcome: null, nextAction: 'WAIT', source: 'mock' }
    let resolve!: (value: typeof receipt) => void
    f.submitAnswer.mockImplementationOnce(() => new Promise((done) => { resolve = done }))
    await f.user.click(screen.getByRole('button', { name: '挑戦する' }))
    await waitFor(() => expect(f.getUserMedia).toHaveBeenCalledTimes(1))
    takePhoto()
    const send = screen.getByRole('button', { name: '送る' })
    fireEvent.click(send)
    fireEvent.click(send)
    expect(f.submitAnswer).toHaveBeenCalledTimes(1)
    const signal = f.submitAnswer.mock.calls[0][1].signal as AbortSignal
    // 判定待ち中は「撮影を終了」を出さず、キャンセルで中断してから閉じる。
    await f.user.click(screen.getByRole('button', { name: 'キャンセル' }))
    expect(signal.aborted).toBe(true)
    await f.user.click(screen.getByRole('button', { name: '撮影を終了' }))
    await act(async () => resolve(receipt))
    expect(screen.queryByText(/送信済み/)).not.toBeInTheDocument()
  })
  it('waits for an explicit start and matching response, and locks duplicate starts', async () => {
    const f = fixture()
    let resolve!: (value: typeof challenge) => void
    f.createChallenge.mockImplementationOnce(() => new Promise((done) => { resolve = done }))
    expect(f.createChallenge).not.toHaveBeenCalled()
    expect(f.getUserMedia).not.toHaveBeenCalled()
    const start = screen.getByRole('button', { name: '挑戦する' })
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
    expect(screen.queryByText(/挑戦を開始しました/)).not.toBeInTheDocument()
    await f.user.click(screen.getByRole('button', { name: '撮影を再開' }))
    await waitFor(() => expect(f.getUserMedia).toHaveBeenCalledTimes(2))
    expect(f.createChallenge).toHaveBeenCalledTimes(2)
  })

  it.each(['cancel', 'unmount', 'pagehide'] as const)('aborts on %s and discards a late success', async (leave) => {
    const f = fixture()
    let resolve!: (value: typeof challenge) => void
    f.createChallenge.mockImplementationOnce(() => new Promise((done) => { resolve = done }))
    fireEvent.click(screen.getByRole('button', { name: '挑戦する' }))
    const signal = f.createChallenge.mock.calls[0][1].signal as AbortSignal
    if (leave === 'cancel') await f.user.click(screen.getByRole('button', { name: 'キャンセル' }))
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
      fireEvent.click(screen.getByRole('button', { name: '挑戦する' }))
      await act(async () => vi.advanceTimersByTimeAsync(10_000))
      expect(screen.getByRole('alert')).toHaveTextContent('時間切れ')
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
    await f.user.click(screen.getByRole('button', { name: '挑戦する' }))
    await f.user.click(screen.getByRole('button', { name: 'キャンセル' }))
    await f.user.click(screen.getByRole('button', { name: '挑戦する' }))
    await act(async () => oldResolve(challenge))
    expect(screen.getByRole('button', { name: '開始中' })).toBeDisabled()
    expect(f.getUserMedia).not.toHaveBeenCalled()
    await act(async () => newResolve(challenge))
    await waitFor(() => expect(f.getUserMedia).toHaveBeenCalledTimes(1))
    expect(f.createChallenge).toHaveBeenCalledTimes(2)
  })

  it.each([{ questId: 'other-question' }, { version: 2 }])('refuses a response for another question or version: %o', async (change) => {
    const f = fixture()
    f.createChallenge.mockResolvedValueOnce({ ...challenge, ...change })
    await f.user.click(screen.getByRole('button', { name: '挑戦する' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('開始確認失敗')
    expect(f.getUserMedia).not.toHaveBeenCalled()
  })

  it('requires a question reload on version conflict and never starts automatically', async () => {
    const f = fixture()
    f.createChallenge.mockRejectedValueOnce(new ApiError('QUEST_CHANGED', { status: 409 }))
    await f.user.click(screen.getByRole('button', { name: '挑戦する' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('問題更新')
    expect(screen.getByRole('button', { name: '挑戦する' })).toBeDisabled()
    await f.user.click(screen.getByRole('button', { name: '問題を再読込' }))
    expect(f.reload).toHaveBeenCalledTimes(1)
    expect(f.createChallenge).toHaveBeenCalledTimes(1)
    expect(f.getUserMedia).not.toHaveBeenCalled()
  })

  it('honors Retry-After without automatically retrying the POST', async () => {
    vi.useFakeTimers()
    try {
      const f = fixture()
      f.createChallenge.mockRejectedValueOnce(new ApiError('RATE_LIMITED', { status: 429, retryAfterSeconds: 3 }))
      fireEvent.click(screen.getByRole('button', { name: '挑戦する' }))
      await act(async () => {})
      expect(screen.getByRole('alert')).toHaveTextContent('3秒後')
      expect(screen.getByRole('button', { name: '挑戦する' })).toBeDisabled()
      await act(async () => vi.advanceTimersByTimeAsync(2_000))
      expect(screen.getByRole('button', { name: '挑戦する' })).toBeDisabled()
      await act(async () => vi.advanceTimersByTimeAsync(1_000))
      expect(screen.getByRole('button', { name: '挑戦する' })).toBeEnabled()
      expect(f.createChallenge).toHaveBeenCalledTimes(1)
      fireEvent.click(screen.getByRole('button', { name: '挑戦する' }))
      await act(async () => {})
      expect(f.createChallenge).toHaveBeenCalledTimes(2)
      f.unmount()
    } finally { vi.useRealTimers() }
  })

  it.each([
    [new ApiError('UNAUTHENTICATED', { status: 401 }), 'ログイン確認失敗'],
    [new ApiError('AUTH_UNAVAILABLE', { status: 503 }), 'ログイン確認停止'],
    [new ApiError('NETWORK_ERROR'), '通信失敗'],
    [new Error('private-sdk-details'), '開始確認失敗'],
  ])('shows a safe failure and leaves the camera closed', async (error, message) => {
    const f = fixture()
    f.createChallenge.mockRejectedValueOnce(error)
    await f.user.click(screen.getByRole('button', { name: '挑戦する' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(message as string)
    expect(document.body).not.toHaveTextContent('private-sdk-details')
    expect(f.getUserMedia).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '挑戦する' })).toBeEnabled()
  })
  it('team-preview shows trial wording and displays the real result through completion', async () => {
    const f = fixture('team-preview')
    const receipt = { attemptId: 'trial-receipt', state: 'RECEIVED', outcome: null, nextAction: 'WAIT', source: 'real' }
    f.submitAnswer.mockResolvedValue(receipt)
    f.getAttempt.mockResolvedValue({ ...receipt, state: 'COMPLETED', outcome: 'CORRECT',
      nextAction: 'OPEN_DISCOVERY', optionalDiscoveryId: 'trial-discovery' })
    expect(screen.queryByText('撮影して回答を試せます。')).not.toBeInTheDocument()
    await f.user.click(screen.getByRole('button', { name: '挑戦する' }))
    await waitFor(() => expect(f.getUserMedia).toHaveBeenCalledTimes(1))
    expect(screen.queryByText(/挑戦を開始しました/)).not.toBeInTheDocument()
    takePhoto()
    // 細かい説明カードは出さない（写真確認は見出しと操作だけ）
    expect(screen.queryByText(/「送信する」で判定します/)).not.toBeInTheDocument()
    expect(document.querySelector('.camera-overlay > p.sample-note')).toBeNull()
    await f.user.click(screen.getByRole('button', { name: '送る' }))
    const waiting = await screen.findByRole('status', { name: '写真の判定待ち' })
    expect(waiting).toHaveTextContent('写真確認中')
    // 判定待ちにも細かい説明カード（sample-note）は出さない
    expect(waiting.querySelector('.sample-note')).toBeNull()
    expect(screen.queryByText(/「送信する」で判定します/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '判定を確認' })).not.toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'クリア！' }, { timeout: 4000 })).toBeVisible()
    expect(f.getAttempt).toHaveBeenCalledExactlyOnceWith(receipt.attemptId, { signal: expect.any(AbortSignal) })
    expect(f.submitAnswer).toHaveBeenCalledTimes(1)
  })
})

it('再読込後も本人・問題に対応する受付から再開し、POSTを増やさない', async () => {
  const { receiptKey } = await import('./captureContinuity')
  const key = receiptKey('owner', quest.questId)
  const { DemoAnswerSubmission } = await import('./DemoAnswerSubmission')
  const initial = render(<DemoAnswerSubmission context={{ api: { submitAnswer: vi.fn().mockResolvedValue({ attemptId: 'saved-attempt', state: 'PROCESSING', outcome: null, source: 'real', nextAction: 'WAIT' }), getAttempt: vi.fn() }, challengeId: 'c', storageKey: key, questId: quest.questId, dataMode: 'durable-local', onReloadQuest: vi.fn() }} photo={new Blob(['synthetic'])} metadata={{ capturedAt: new Date().toISOString(), position: { latitude: 0, longitude: 0, accuracyMeters: 10, measuredAt: new Date().toISOString() } }} disabled={false} onSubmissionStarted={vi.fn()} />)
  await userEvent.setup().click(screen.getByRole('button', { name: 'テスト送信' }))
  expect(sessionStorage.getItem(key)).toBe('saved-attempt')
  initial.unmount()
  const getAttempt = vi.fn().mockResolvedValue({ attemptId: 'saved-attempt', state: 'COMPLETED', outcome: 'LOCATION_UNCERTAIN', source: 'real', nextAction: 'RETAKE' })
  const submitAnswer = vi.fn()
  const api = { ...createApiClient(), getAttempt, submitAnswer }
  render(<ChallengeCapture api={api} quest={quest} ownerKey="owner" dataMode="durable-local" onReloadQuest={vi.fn()} />)
  expect(screen.getByText('判定中')).toBeVisible()
  expect(screen.queryByRole('button', { name: '挑戦する' })).not.toBeInTheDocument()
  await userEvent.setup().click(screen.getByRole('button', { name: '判定を確認' }))
  await waitFor(() => expect(getAttempt).toHaveBeenCalledWith('saved-attempt', { signal: expect.any(AbortSignal) }), { timeout: 3000 })
  expect(await screen.findByText(`${quest.title}：範囲内で撮り直す`)).toBeVisible()
  expect(submitAnswer).not.toHaveBeenCalled()
  expect(sessionStorage.getItem(key)).toBeNull()
})


it('選択問題の手がかりと取得済みヒントを撮影画面へ渡す', async () => {
  const { openedHints } = await import('./captureContinuity')
  const key = `${quest.questId}:${quest.version}`
  openedHints.set(key, { 1: '開いたヒントの本文' })
  const f = fixture('durable-local')
  await f.user.click(screen.getByRole('button', { name: '挑戦する' }))
  expect(await screen.findByRole('heading', { name: quest.title })).toBeVisible()
  await f.user.click(screen.getByText('手がかり'))
  expect(screen.getByText(quest.clue)).toBeVisible()
  expect(screen.getByText('開いたヒントの本文')).toBeVisible()
  openedHints.delete(key)
})
