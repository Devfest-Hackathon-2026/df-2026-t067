import { expect, it, vi } from 'vitest'
import { createApiClient } from './client'
import { ContractError, parseQuestHint } from './validation'

const hint = { questId: 'demo-quest', version: 1, index: 1, text: '公開する手がかり' }

it('rejects leaked private fields and invalid hint values at the public boundary', () => {
  expect(parseQuestHint(hint)).toEqual(hint)
  for (const extra of ['answerCoordinates', 'referenceImage', 'placeName', 'reveal']) {
    expect(() => parseQuestHint({ ...hint, [extra]: 'private' })).toThrow(ContractError)
  }
  for (const patch of [{ index: 0 }, { version: 0 }, { text: '' }, { text: ' ' }]) {
    expect(() => parseQuestHint({ ...hint, ...patch })).toThrow(ContractError)
  }
})

it('rejects a response for a different quest, version or index', async () => {
  for (const patch of [{ questId: 'other' }, { version: 2 }, { index: 2 }]) {
    const api = createApiClient({ fetch: async () => new Response(JSON.stringify({ ...hint, ...patch })) })
    await expect(api.getHint({ questId: 'demo-quest', expectedVersion: 1, index: 1 })).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  }
})

it('validates hint inputs before requesting and preserves cancellation', async () => {
  const fetcher = vi.fn<typeof fetch>()
  const api = createApiClient({ fetch: fetcher })
  for (const patch of [{ index: 0 }, { index: 1.5 }, { expectedVersion: 0 }, { questId: '..' }]) {
    await expect(api.getHint({ questId: 'demo-quest', expectedVersion: 1, index: 1, ...patch })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  }
  const controller = new AbortController()
  controller.abort()
  await expect(api.getHint({ questId: 'demo-quest', expectedVersion: 1, index: 1 }, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
  expect(fetcher).not.toHaveBeenCalled()
})
