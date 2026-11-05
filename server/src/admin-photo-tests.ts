import type { PhotoTestResult } from '../../src/shared/api/admin'
import { parsePhotoTestResult } from '../../src/shared/api/admin'
import { HttpError } from './errors'
import { photoSystemError } from './photo-match'
import type { PhotoMatcher } from './photo-match'

// Result-only memory cache. Candidate photos and visitor records are never
// stored here. Authentication and current draft checks belong to each request.
export class DemoPhotoTestStore {
  private readonly jobs = new Map<string, { digest: string; result: Promise<PhotoTestResult> }>()
  private active = false
  constructor(private readonly capacity = 128) {
    if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 128) throw new Error('Invalid photo test capacity.')
  }
  async execute(key: string, digest: string,
    work: (track: (matcher: PhotoMatcher) => PhotoMatcher) => Promise<PhotoTestResult>): Promise<PhotoTestResult> {
    const previous = this.jobs.get(key)
    if (previous) {
      if (previous.digest !== digest) throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', '同じ試験キーで異なる内容は送信できません。')
      return { ...await previous.result }
    }
    if (this.active || this.jobs.size >= this.capacity) throw new HttpError(429, 'RATE_LIMITED', '時間をおいて再試行してください。', true, 1)
    this.active = true
    let finished = false, sending = false
    const release = () => { if (finished && !sending) this.active = false }
    const track = (matcher: PhotoMatcher): PhotoMatcher => ((input, call) => {
      sending = true
      const pending = Promise.resolve().then(() => matcher(input, call))
      const settle = () => { sending = false; release() }
      void pending.then(settle, settle)
      return pending
    })
    const result = Promise.resolve().then(() => work(track)).then(parsePhotoTestResult)
      .catch((error: unknown) => { throw error instanceof HttpError ? error : photoSystemError() })
    this.jobs.set(key, { digest, result })
    const complete = () => { finished = true; release() }
    void result.then(complete, complete)
    return { ...await result }
  }
}
