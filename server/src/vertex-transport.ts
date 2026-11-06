import { GoogleAuth } from 'google-auth-library'
import { photoSystemError } from './photo-match'
import { withTrialSlot } from './vertex-trial-ledger'
import { HttpError } from './errors'

export interface VertexGenerateRequest {
  systemInstruction: { parts: Array<{ text: string }> }
  contents: Array<{ role: 'user'; parts: Array<{ text: string } | { inlineData: { mimeType: 'image/jpeg'; data: string } }> }>
  generationConfig: {
    responseMimeType: 'application/json'
    responseSchema: Record<string, unknown>
    temperature: number
    maxOutputTokens: number
    candidateCount: number
  }
}

export type VertexTransport = (request: VertexGenerateRequest, call: { signal: AbortSignal }) => Promise<unknown>

export const trialEndpoint = 'https://aiplatform.googleapis.com/v1/projects/tour-513804/locations/global/publishers/google/models/gemini-3.8-flash:generateContent'
export interface TransportOptions { getAccessToken?: () => Promise<string | null | undefined>; http?: typeof fetch; timeoutMs?: number }

function abortable<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new DOMException('写真の確認を中止しました。', 'AbortError'))
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
    pending.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}

async function readResponse(response: Response, signal: AbortSignal): Promise<unknown> {
  if (response.status !== 200 || !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '') || !response.body) {
    void response.body?.cancel().catch(() => {})
    throw photoSystemError()
  }
  const reader = response.body.getReader()
  const parts: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { value, done } = await abortable(reader.read(), signal)
      if (done) break
      size += value.byteLength
      if (size > 65_536) throw photoSystemError()
      parts.push(value)
    }
    return JSON.parse(Buffer.concat(parts).toString('utf8')) as unknown
  } finally { void reader.cancel().catch(() => {}) }
}

export function createVertexTrialTransport(file: string, options: TransportOptions = {}): VertexTransport {
  const auth = new GoogleAuth({ projectId: 'tour-513804', clientOptions: { quotaProjectId: 'tour-513804' }, scopes: ['https://www.googleapis.com/auth/cloud-platform'] })
  const getAccessToken = options.getAccessToken ?? (() => auth.getAccessToken())
  const http = options.http ?? fetch
  const timeoutMs = options.timeoutMs ?? 30_000
  return async (request, call) => {
    call.signal.throwIfAborted()
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) throw photoSystemError(false)
    const controller = new AbortController()
    const deadline = setTimeout(() => controller.abort(), timeoutMs)
    const signal = AbortSignal.any([call.signal, controller.signal])
    try {
      const token = await abortable(getAccessToken(), signal)
      if (typeof token !== 'string' || !/^[\x21-\x7e]{1,8192}$/.test(token)) throw photoSystemError(false)
      signal.throwIfAborted()
      const body = JSON.stringify({ systemInstruction: request.systemInstruction, contents: request.contents,
        generationConfig: { ...request.generationConfig, candidateCount: 1, maxOutputTokens: 1024, thinkingConfig: { thinkingLevel: 'LOW' } },
      })
      if (Buffer.byteLength(body) > 6 * 1024 * 1024) throw photoSystemError(false)
      return await withTrialSlot(file, signal, async () => {
        const response = await http(trialEndpoint, { method: 'POST', redirect: 'error', signal,
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'x-goog-user-project': 'tour-513804' }, body,
        })
        signal.throwIfAborted()
        return await readResponse(response, signal)
      })
    } catch (error) {
      if (call.signal.aborted) throw new DOMException('写真の確認を中止しました。', 'AbortError')
      throw photoSystemError(error instanceof HttpError ? error.retryable : true)
    } finally { clearTimeout(deadline) }
  }
}
