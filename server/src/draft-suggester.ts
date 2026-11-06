import type { DraftSuggestion, ManagedQuestDraft } from '../../src/shared/api/admin'

export interface DraftSuggester {
  source: DraftSuggestion['source']
  suggest(reference: Buffer, materials: ManagedQuestDraft['materials'], signal: AbortSignal):
    ManagedQuestDraft['content'] | null | Promise<ManagedQuestDraft['content'] | null>
}
