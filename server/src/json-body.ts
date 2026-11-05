import type { IncomingMessage } from 'node:http'
import { HttpError, invalidInput } from './errors'
import { parseId } from './query'
import { readBody } from './request-body'

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
  const bytes = await readBody(request, maximumBytes)
  let data: unknown
  try { data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) } catch { invalidInput() }
  if (!data || typeof data !== 'object' || Array.isArray(data)) invalidInput()
  const input = data as Record<string, unknown>
  if (Object.keys(input).sort().join(',') !== 'expectedVersion,questId' || typeof input.questId !== 'string' ||
    typeof input.expectedVersion !== 'number' || !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1) invalidInput()
  return { questId: parseId(input.questId), expectedVersion: input.expectedVersion }
}
