import type { IncomingMessage } from 'node:http'
import { HttpError } from './errors'

export function tooLarge(): HttpError {
  return new HttpError(413, 'MEDIA_TOO_LARGE', '送信内容が大きすぎます。')
}

export function readBody(request: IncomingMessage, maximumBytes: number): Promise<Buffer> {
  if (request.destroyed || request.readableEnded) return Promise.reject(new HttpError(400, 'INVALID_INPUT', '入力を確認してください。'))
  const length = request.headers['content-length']
  if (length !== undefined && Number(length) > maximumBytes) return Promise.reject(tooLarge())
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
