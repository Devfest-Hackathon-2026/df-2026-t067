import { expect, it } from 'vitest'
import { createApiClient } from './client'
import { parseManagedQuest, parseManagedQuestDraft, parseOrgMembership } from './admin'
import { ContractError } from './validation'

const draft = {
  materials: { name: '', evidence: '', availableModes: [], requiredModes: [], access: '', hours: '', price: '', photoNote: '', photoRights: '' },
  content: { title: '', question: '', hints: ['', '', ''], verifiedFeatures: '', draftingNotes: '' },
  referenceAssetId: null, hintAssetId: null,
}
const quest = { questId: 'draft-a', orgId: 'demo-org', areaId: 'demo-area', draftRevision: 1,
  publishedVersion: null, status: 'draft', shootingAreaStatus: 'unconfigured', source: 'mock', draft }
const json = (body: unknown, withDemo = true) => new Response(JSON.stringify(body), {
  headers: withDemo ? { 'X-Quest-Data-Mode': 'demo' } : {},
})

it('requires explicit demo mode for a mock draft and binds its response to the requested org and quest', async () => {
  const plain = createApiClient({ fetch: async () => json(quest), getIdToken: async () => 'token' })
  await expect(plain.getManagedQuest('demo-org', 'draft-a')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  const api = createApiClient({ fetch: async () => json(quest), getIdToken: async () => 'token', expectedDataMode: 'demo' })
  expect(await api.getManagedQuest('demo-org', 'draft-a')).toEqual(quest)
  await expect(api.getManagedQuest('other-org', 'draft-a')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  await expect(api.getManagedQuest('demo-org', 'draft-b')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  const missingHeader = createApiClient({ fetch: async () => json(quest, false), getIdToken: async () => 'token', expectedDataMode: 'demo' })
  await expect(missingHeader.getManagedQuest('demo-org', 'draft-a')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
})

it('rejects unsupported status, private identity claims and unbounded or malformed draft fields', () => {
  expect(parseManagedQuest(quest)).toEqual(quest)
  for (const patch of [{ status: 'published' }, { publishedVersion: 1 }, { draftRevision: 0 }, { shootingAreaStatus: 'configured' }, { source: 'pretend' }]) {
    expect(() => parseManagedQuest({ ...quest, ...patch })).toThrow(ContractError)
  }
  expect(() => parseOrgMembership({ orgId: 'demo-org', label: 'demo', role: 'owner', areaId: 'demo-area' })).toThrow(ContractError)
  expect(() => parseOrgMembership({ orgId: 'demo-org', label: 'demo', role: 'editor', areaId: 'demo-area', uid: 'other' })).toThrow(ContractError)
  for (const patch of [
    { materials: { ...draft.materials, name: 'a'.repeat(201) } },
    { materials: { ...draft.materials, availableModes: ['飛行機'] } },
    { materials: { ...draft.materials, availableModes: ['徒歩', '徒歩'] } },
    { materials: { ...draft.materials, requiredModes: ['車'] } },
    { referenceAssetId: 'blob:private' }, { hintAssetId: 'https://example.invalid/photo' },
    { content: { ...draft.content, hints: ['', ''] } }, { role: 'publisher' },
  ]) {
    expect(() => parseManagedQuestDraft({ ...draft, ...patch })).toThrow(ContractError)
  }
})

it('returns detached draft data so editing parsed arrays cannot mutate a saved response', () => {
  const result = parseManagedQuestDraft(draft)
  result.content.hints[0] = 'edited'
  result.materials.availableModes.push('徒歩')
  expect(draft.content.hints[0]).toBe('')
  expect(draft.materials.availableModes).toEqual([])
})

it('requires authentication and validates revisions before attempting admin writes', async () => {
  let requested = false
  const api = createApiClient({ fetch: async () => { requested = true; return json(quest) } })
  await expect(api.createManagedQuest('demo-org', parseManagedQuestDraft(draft))).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
  await expect(api.updateManagedQuest('demo-org', 'draft-a', { expectedDraftRevision: 0, draft: parseManagedQuestDraft(draft) })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  expect(requested).toBe(false)
})
