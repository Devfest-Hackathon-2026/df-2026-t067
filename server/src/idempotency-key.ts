import type { IncomingMessage } from 'node:http'
import { invalidInput } from './errors'

export function readIdempotencyKey(request: IncomingMessage): string {
  const count = request.rawHeaders.filter((_, index) => index % 2 === 0)
    .filter((name) => name.toLowerCase() === 'idempotency-key').length
  const key = request.headers['idempotency-key']
  if (count !== 1 || typeof key !== 'string' || !/^[\x21-\x7e]{1,128}$/.test(key)) invalidInput()
  return key
}
