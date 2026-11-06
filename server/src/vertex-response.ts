import { photoSystemError } from './photo-match'

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function blocked(ratings: unknown): boolean {
  if (ratings === undefined) return false
  if (!Array.isArray(ratings)) throw photoSystemError()
  for (const rating of ratings) {
    if (!record(rating) || (rating.blocked !== undefined && typeof rating.blocked !== 'boolean')) throw photoSystemError()
    if (rating.blocked === true) return true
  }
  return false
}

export function readVertexText(response: unknown, maximumBytes: number): string {
  if (!record(response) || !Array.isArray(response.candidates) || response.candidates.length !== 1) throw photoSystemError()
  if (response.promptFeedback !== undefined) {
    if (!record(response.promptFeedback) || response.promptFeedback.blockReason !== undefined ||
      response.promptFeedback.blockReasonMessage !== undefined || blocked(response.promptFeedback.safetyRatings)) throw photoSystemError()
  }
  const candidate: unknown = response.candidates[0]
  if (!record(candidate) || candidate.finishReason !== 'STOP' || blocked(candidate.safetyRatings) ||
    !record(candidate.content) || !Array.isArray(candidate.content.parts) || candidate.content.parts.length !== 1) throw photoSystemError()
  const part: unknown = candidate.content.parts[0]
  if (!record(part) || Object.keys(part).some((key) => !['text', 'thought', 'thoughtSignature'].includes(key)) ||
    (part.thought !== undefined && part.thought !== false) ||
    (part.thoughtSignature !== undefined && (typeof part.thoughtSignature !== 'string' || part.thoughtSignature.length > 8192)) ||
    typeof part.text !== 'string' || Buffer.byteLength(part.text) > maximumBytes) throw photoSystemError()
  return part.text
}
