import { expect, it } from 'vitest'
import { parseManagedQuestDraft } from './admin'
import { ContractError, parsePublicQuest } from './validation'
import { quest } from './testFixtures'

const draft = {
  materials: { name: '架空の対象', evidence: '架空の根拠', requiresBoat: true, requiresPaidFacility: false,
    price: '挑戦前の料金', photoNote: '挑戦前の注意', photoRights: '権利説明' },
  content: { title: '', question: '', hints: ['', '', ''], verifiedFeatures: '', draftingNotes: '' },
  afterClear: { access: 'クリア後のアクセス', hours: 'クリア後の時間', promoComment: 'クリア後の紹介', explanation: 'クリア後の解説' },
  referenceAssetId: null, hintAssetId: null,
}

it('preserves both shooting conditions and a separate copy of all four after-clear fields', () => {
  const result = parseManagedQuestDraft(draft)
  expect(result).toEqual(draft)
  result.materials.requiresBoat = false
  result.afterClear.explanation = 'changed'
  expect(draft.materials.requiresBoat).toBe(true)
  expect(draft.afterClear.explanation).toBe('クリア後の解説')
})

it('rejects legacy material fields and missing or coerced conditions instead of dropping them', () => {
  for (const patch of [{ requiresBoat: 'true' }, { requiresPaidFacility: 1 }, { requiresBoat: undefined },
    { availableModes: ['船'] }, { requiredModes: [] }, { access: '旧公開扱いの値' }, { hours: '旧公開扱いの値' }]) {
    expect(() => parseManagedQuestDraft({ ...draft, materials: { ...draft.materials, ...patch } })).toThrow(ContractError)
  }
  expect(() => parseManagedQuestDraft({ ...draft, afterClear: undefined })).toThrow(ContractError)
  expect(() => parseManagedQuestDraft({ ...draft, afterClear: { ...draft.afterClear, role: 'publisher' } })).toThrow(ContractError)
  expect(() => parseManagedQuestDraft({ ...draft, afterClear: { ...draft.afterClear, explanation: 'x'.repeat(4001) } })).toThrow(ContractError)
})

it('never accepts the after-clear object or its private text as additional public response fields', () => {
  for (const patch of [{ afterClear: draft.afterClear }, { access: draft.afterClear.access }, { promoComment: draft.afterClear.promoComment }]) {
    expect(() => parsePublicQuest({ ...quest, ...patch })).toThrow(ContractError)
  }
})
