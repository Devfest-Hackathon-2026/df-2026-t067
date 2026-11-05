import { randomUUID } from 'node:crypto'
import type { AttemptResult } from '../../src/shared/api/types'
import { parseAttemptResult } from '../../src/shared/api/validation'
import { HttpError } from './errors'
import type { LocationDecision } from './location'

interface AnswerOptions { capacity?: number; requestsPerMinute?: number; concurrentUploads?: number; now?: () => number }
interface Receipt { ownerUid: string; digest: string; result: AttemptResult }

// Only digests and ownership are retained. No image or location can be fetched
// from this development-only store. There is deliberately no judging worker.
export class DemoAnswerStore {
  private readonly records = new Map<string, Receipt>()
  private readonly index = new Map<string, string>()
  private readonly capacity: number
  private readonly requestsPerMinute: number
  private readonly concurrentUploads: number
  private readonly now: () => number
  private readonly windows = new Map<string, { start: number; count: number }>()
  private active = 0

  constructor(options: AnswerOptions = {}) {
    this.capacity = options.capacity ?? 256
    this.requestsPerMinute = options.requestsPerMinute ?? 10
    this.concurrentUploads = options.concurrentUploads ?? 4
    this.now = options.now ?? Date.now
    if (![this.capacity, this.requestsPerMinute, this.concurrentUploads].every((value) => Number.isSafeInteger(value) && value > 0 && value <= 10_000)) {
      throw new Error('Demo answer limits must be positive integers up to 10000.')
    }
  }

  acquire(ownerUid: string): () => void {
    const now = this.now()
    if (!Number.isFinite(now)) throw this.full()
    for (const [uid, window] of this.windows) {
      if (now >= window.start + 60_000 || now < window.start) this.windows.delete(uid)
    }
    if (this.active >= this.concurrentUploads) throw new HttpError(429, 'RATE_LIMITED', '時間をおいて再試行してください。', true, 1)
    let window = this.windows.get(ownerUid)
    if (!window) {
      if (this.windows.size >= 256) throw this.full()
      window = { start: now, count: 0 }
      this.windows.set(ownerUid, window)
    }
    if (window.count >= this.requestsPerMinute) throw new HttpError(429, 'RATE_LIMITED', '時間をおいて再試行してください。', true,
      Math.max(1, Math.ceil((window.start + 60_000 - now) / 1000)))
    window.count++
    this.active++
    let released = false
    return () => { if (!released) { released = true; this.active-- } }
  }

  receive(ownerUid: string, challengeId: string, key: string, digest: string, decideLocation?: () => LocationDecision): AttemptResult {
    const index = JSON.stringify([ownerUid, challengeId, key])
    const previousId = this.index.get(index)
    if (previousId) {
      const previous = this.records.get(previousId)!
      if (previous.digest !== digest) throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', '同じ回答キーで異なる内容は送信できません。')
      return { ...previous.result }
    }
    if (this.records.size >= this.capacity) throw this.full()
    // A replay is returned above before reading the clock or policy again.
    const decision = decideLocation?.()
    const locationFailure = decision === 'OUTSIDE_AREA' || decision === 'LOCATION_UNCERTAIN'
    if (decision !== undefined && decision !== 'WITHIN_AREA' && !locationFailure) throw this.full()
    const result = parseAttemptResult({ attemptId: randomUUID(), source: 'mock',
      ...(locationFailure ? { state: 'COMPLETED', outcome: decision, nextAction: decision === 'OUTSIDE_AREA' ? 'MOVE_TO_AREA' : 'RETAKE' }
        : { state: 'RECEIVED', outcome: null, nextAction: 'WAIT' }),
    })
    if (this.records.has(result.attemptId)) throw this.full()
    this.records.set(result.attemptId, { ownerUid, digest, result })
    this.index.set(index, result.attemptId)
    return { ...result }
  }

  getOwned(attemptId: string, ownerUid: string): AttemptResult | null {
    const receipt = this.records.get(attemptId)
    return receipt?.ownerUid === ownerUid ? { ...receipt.result } : null
  }

  private full(): HttpError { return new HttpError(503, 'SYSTEM_ERROR', '処理を完了できませんでした。') }
}
