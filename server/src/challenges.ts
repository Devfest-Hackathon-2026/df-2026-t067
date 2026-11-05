import { randomUUID } from 'node:crypto'
import type { Challenge, PublicQuest } from '../../src/shared/api/types'
import { parseChallenge } from '../../src/shared/api/validation'
import { HttpError } from './errors'

interface ChallengeOptions { capacity?: number; requestsPerMinute?: number; now?: () => number }
interface OwnedChallenge { ownerUid: string; challenge: Challenge }

// Development-only, bounded process memory. The executable never uses this as
// durable storage. The HTTP handler passes a verified owner; IDs and timestamps
// are generated here rather than taken from request data.
export class DemoChallengeStore {
  private readonly records = new Map<string, OwnedChallenge>()
  private readonly index = new Map<string, string>()
  private readonly windows = new Map<string, { start: number; count: number }>()
  private readonly capacity: number
  private readonly requestsPerMinute: number
  private readonly now: () => number

  constructor(options: ChallengeOptions = {}) {
    this.capacity = options.capacity ?? 256
    this.requestsPerMinute = options.requestsPerMinute ?? 10
    this.now = options.now ?? Date.now
    if (![this.capacity, this.requestsPerMinute].every((value) => Number.isSafeInteger(value) && value > 0 && value <= 10_000)) {
      throw new Error('Demo challenge limits must be positive integers up to 10000.')
    }
  }

  start(ownerUid: string, quest: PublicQuest): { challenge: Challenge; created: boolean } {
    const now = this.now()
    if (!Number.isFinite(now)) throw new Error('Server clock is unavailable.')
    for (const [uid, window] of this.windows) {
      if (now >= window.start + 60_000 || now < window.start) this.windows.delete(uid)
    }
    const key = JSON.stringify([ownerUid, quest.questId, quest.version])
    const previousId = this.index.get(key)
    // Rejected allocations must not occupy the bounded per-user rate table.
    if (!previousId && this.records.size >= this.capacity) throw this.full()
    let window = this.windows.get(ownerUid)
    if (!window) {
      if (this.windows.size >= this.capacity) throw this.full()
      window = { start: now, count: 0 }
      this.windows.set(ownerUid, window)
    }
    if (window.count >= this.requestsPerMinute) {
      throw new HttpError(429, 'RATE_LIMITED', '時間をおいて再試行してください。', true,
        Math.max(1, Math.ceil((window.start + 60_000 - now) / 1000)))
    }
    window.count++

    if (previousId) return { challenge: { ...this.records.get(previousId)!.challenge }, created: false }
    const challenge = parseChallenge({
      challengeId: randomUUID(), questId: quest.questId, version: quest.version, createdAt: new Date(now).toISOString(),
    })
    if (this.records.has(challenge.challengeId)) throw this.full()
    this.records.set(challenge.challengeId, { ownerUid, challenge })
    this.index.set(key, challenge.challengeId)
    return { challenge: { ...challenge }, created: true }
  }

  getOwned(challengeId: string, ownerUid: string): Challenge | null {
    const record = this.records.get(challengeId)
    return record?.ownerUid === ownerUid ? { ...record.challenge } : null
  }

  private full(): HttpError {
    return new HttpError(503, 'SYSTEM_ERROR', '処理を完了できませんでした。')
  }
}
