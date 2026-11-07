import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { DemoAnswerSubmission } from './DemoAnswerSubmission'
import type { AttemptResult, CaptureMetadata } from '../../shared/api'
const receipt: AttemptResult = { attemptId: 'accepted', state: 'PROCESSING', outcome: null, source: 'real', nextAction: 'wait' }
const metadata: CaptureMetadata = { capturedAt: '2026-11-08T00:00:00Z', position: { latitude: 0, longitude: 0, accuracyMeters: 10, measuredAt: '2026-11-08T00:00:00Z' } }
afterEach(() => { cleanup(); vi.useRealTimers() })
it('polls only the accepted ID and stops at completion without posting again', async () => {
  vi.useFakeTimers()
  const submitAnswer = vi.fn().mockResolvedValue(receipt)
  const getAttempt = vi.fn().mockResolvedValue({ ...receipt, state: 'COMPLETED', outcome: 'CORRECT', optionalDiscoveryId: 'record' })
  render(<DemoAnswerSubmission context={{ api: { submitAnswer, getAttempt }, challengeId: 'challenge', onReloadQuest: vi.fn(), dataMode: 'durable-local' }} photo={new Blob(['synthetic'])} metadata={metadata} disabled={false} onSubmissionStarted={vi.fn()} />)
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '写真と位置をテスト送信' })))
  await act(async () => vi.advanceTimersByTimeAsync(1500))
  expect(getAttempt).toHaveBeenCalledExactlyOnceWith('accepted', { signal: expect.any(AbortSignal) })
  await act(async () => vi.advanceTimersByTimeAsync(60000))
  expect(submitAnswer).toHaveBeenCalledTimes(1)
  expect(getAttempt).toHaveBeenCalledTimes(1)
})
it('bounds automatic reads and aborts an in-flight read when leaving', async () => {
  vi.useFakeTimers()
  const getAttempt = vi.fn().mockResolvedValue(receipt)
  const view = render(<DemoAnswerSubmission context={{ api: { submitAnswer: vi.fn().mockResolvedValue(receipt), getAttempt }, challengeId: 'challenge', onReloadQuest: vi.fn(), dataMode: 'durable-local' }} photo={new Blob(['synthetic'])} metadata={metadata} disabled={false} onSubmissionStarted={vi.fn()} />)
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '写真と位置をテスト送信' })))
  for (let i = 0; i < 10; i++) await act(async () => vi.advanceTimersByTimeAsync(16000))
  expect(getAttempt).toHaveBeenCalledTimes(6)
  expect(screen.getByText(/自動確認をいったん終了/)).toBeVisible()
  getAttempt.mockImplementation(() => new Promise(() => {}))
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '判定結果を確認' })))
  const signal = getAttempt.mock.calls.at(-1)?.[1].signal as AbortSignal
  view.unmount()
  expect(signal.aborted).toBe(true)
})

it('honors 429 retry-after then resumes the same ID and opens only a saved discovery', async () => {
  vi.useFakeTimers()
  const { ApiError } = await import('../../shared/api')
  const getAttempt = vi.fn().mockRejectedValueOnce(new ApiError('RATE_LIMITED', { retryAfterSeconds: 12 })).mockResolvedValue({ ...receipt, state: 'COMPLETED', outcome: 'ALREADY_CLEARED', optionalDiscoveryId: 'first-record' })
  const onOpenDiscovery = vi.fn()
  const submitAnswer = vi.fn().mockResolvedValue(receipt)
  render(<DemoAnswerSubmission context={{ api: { submitAnswer, getAttempt }, challengeId: 'challenge', onReloadQuest: vi.fn(), onOpenDiscovery, dataMode: 'durable-local' }} photo={new Blob(['synthetic'])} metadata={metadata} disabled={false} onSubmissionStarted={vi.fn()} />)
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '写真と位置をテスト送信' })))
  expect(onOpenDiscovery).not.toHaveBeenCalled()
  await act(async () => vi.advanceTimersByTimeAsync(1000))
  expect(getAttempt).toHaveBeenCalledTimes(1)
  await act(async () => vi.advanceTimersByTimeAsync(11999))
  expect(getAttempt).toHaveBeenCalledTimes(1)
  await act(async () => vi.advanceTimersByTimeAsync(1))
  await act(async () => vi.advanceTimersByTimeAsync(2000))
  expect(getAttempt).toHaveBeenCalledTimes(2)
  expect(onOpenDiscovery).toHaveBeenCalledExactlyOnceWith('first-record')
  expect(submitAnswer).toHaveBeenCalledTimes(1)
})
