import type { IncomingMessage } from 'node:http'
import { HttpError, invalidInput } from './errors'
import { parseId } from './query'

const maximumBytes = 4096

export async function readChallengeInput(request: IncomingMessage): Promise<{ questId: string; expectedVersion: number }> {
  const contentTypes = request.rawHeaders.filter((_, index) => index % 2 === 0)
    .filter((name) => name.toLowerCase() === 'content-type').length
  if (contentTypes > 1) invalidInput()
  const contentType = request.headers['content-type'] ?? ''
  const encoding = request.headers['content-encoding']
  if (!/^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?\s*$/i.test(contentType) ||
    (encoding !== undefined && encoding.toLowerCase() !== 'identity')) {
    throw new HttpError(415, 'HTTP_ERROR', 'JSON形式で送信してください。')
  }
  const length = request.headers['content-length']
  if (length !== undefined && Number(length) > maximumBytes) throw tooLarge()
  const bytes = await readBody(request)
  let data: unknown
  try { data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) } catch { invalidInput() }
  if (!data || typeof data !== 'object' || Array.isArray(data)) invalidInput()
  const input = data as Record<string, unknown>
  if (Object.keys(input).sort().join(',') !== 'expectedVersion,questId' || typeof input.questId !== 'string' ||
    typeof input.expectedVersion !== 'number' || !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1) invalidInput()
  return { questId: parseId(input.questId), expectedVersion: input.expectedVersion }
}

function tooLarge(): HttpError {
  return new HttpError(413, 'MEDIA_TOO_LARGE', '送信内容が大きすぎます。')
}

function readBody(request: IncomingMessage): Promise<Buffer> {
  if (request.destroyed || request.readableEnded) return Promise.reject(new HttpError(400, 'INVALID_INPUT', '入力を確認してください。'))
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    let settled = false
    const deadline = setTimeout(() => finish(new HttpError(408, 'HTTP_ERROR', '要求の受信を完了できませんでした。', true)), 5_000)
    deadline.unref()
    function finish(error?: HttpError) {
      if (settled) return
      settled = true
      clearTimeout(deadline)
      request.off('data', receive)
      request.off('end', end)
      request.off('aborted', aborted)
      request.off('error', aborted)
      if (error) reject(error)
      else resolve(Buffer.concat(chunks, size))
    }
    function receive(chunk: Buffer) {
      size += chunk.length
      if (size > maximumBytes) finish(tooLarge())
      else chunks.push(chunk)
    }
    function end() { finish() }
    function aborted() { finish(new HttpError(400, 'INVALID_INPUT', '入力を確認してください。')) }
    request.on('data', receive)
    request.once('end', end)
    request.once('aborted', aborted)
    request.once('error', aborted)
  })
}
