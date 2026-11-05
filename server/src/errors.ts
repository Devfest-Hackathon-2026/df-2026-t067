import type { ApiErrorCode } from '../../src/shared/api/client'

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
    readonly retryable = false,
  ) {
    super(message)
  }
}

export function invalidInput(): never {
  throw new HttpError(400, 'INVALID_INPUT', '入力を確認してください。')
}

export function authUnavailable(): HttpError {
  return new HttpError(503, 'AUTH_UNAVAILABLE', '認証サービスを利用できません。', true)
}

export function unauthenticated(): HttpError {
  return new HttpError(401, 'UNAUTHENTICATED', '有効なログインが必要です。')
}
