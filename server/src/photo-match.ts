import { preparePhoto } from './photo-input'
import type { PhotoInput, PreparedPhoto } from './photo-input'
import { HttpError } from './errors'
import type { PhotoDecision } from '../../src/shared/api/admin'
export type { PhotoDecision } from '../../src/shared/api/admin'

export interface MatchInput { reference: PreparedPhoto; candidate: PreparedPhoto; features: readonly string[] }
export type PhotoMatcher = (input: MatchInput, call: { signal: AbortSignal }) => Promise<unknown>
export interface CompareInput { reference?: PhotoInput; candidate: PhotoInput; features: readonly string[] }
export interface CompareOptions { matcher?: PhotoMatcher; signal?: AbortSignal; timeoutMs?: number }

export function photoSystemError(retryable = true): HttpError {
  return new HttpError(503, 'SYSTEM_ERROR', '写真の確認を完了できませんでした。', retryable)
}

function cancelled(): DOMException { return new DOMException('写真の確認を中止しました。', 'AbortError') }

export function validPhotoFeatures(features: unknown): features is readonly string[] {
  return Array.isArray(features) && features.length >= 1 && features.length <= 20 &&
    Array.from(features).every((value) => typeof value === 'string' && value.trim().length > 0 && value.length <= 300)
}

export function draftPhotoFeatures(value: string): string[] | null {
  const features = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  return validPhotoFeatures(features) ? features : null
}

export async function comparePhotos(input: CompareInput, options: CompareOptions = {}): Promise<PhotoDecision> {
  if (options.signal?.aborted) throw cancelled()
  const timeoutMs = options.timeoutMs ?? 10_000
  if (!options.matcher || !input?.reference || !validPhotoFeatures(input.features) ||
    !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) throw photoSystemError(false)
  let reference: PreparedPhoto
  try { reference = await preparePhoto(input.reference) } catch { throw photoSystemError(false) }
  const candidate = await preparePhoto(input.candidate)
  if (options.signal?.aborted) throw cancelled()
  const controller = new AbortController()
  const cancel = () => controller.abort()
  options.signal?.addEventListener('abort', cancel, { once: true })
  let timedOut = false
  let rejectAbort!: () => void
  const aborted = new Promise<never>((_, reject) => {
    rejectAbort = () => reject(timedOut ? photoSystemError() : cancelled())
    controller.signal.addEventListener('abort', rejectAbort, { once: true })
  })
  const deadline = setTimeout(() => { timedOut = true; controller.abort() }, timeoutMs)
  try {
    const match = options.matcher
    const result = await Promise.race([
      Promise.resolve().then(() => match({ reference, candidate, features: input.features.map((value) => value.trim()) }, { signal: controller.signal })), aborted,
    ])
    if (options.signal?.aborted) throw cancelled()
    if (controller.signal.aborted) throw photoSystemError()
    if (result !== 'MATCH' && result !== 'WRONG_TARGET' && result !== 'IMAGE_UNCERTAIN') throw photoSystemError()
    return result
  } catch (error) {
    if (options.signal?.aborted) throw cancelled()
    throw photoSystemError(error instanceof HttpError ? error.retryable : true)
  } finally {
    clearTimeout(deadline)
    controller.signal.removeEventListener('abort', rejectAbort)
    options.signal?.removeEventListener('abort', cancel)
  }
}
