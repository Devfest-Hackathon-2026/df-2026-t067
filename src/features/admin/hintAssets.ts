import type { ManagedQuestDraft } from '../../shared/api'

// Match public projection: fill hint 1 from legacy, retaining an independent image.
export function normalizeHintAssets(draft: ManagedQuestDraft) {
  const hintAssetIds = [...(draft.hintAssetIds ?? [null, null, null])]
  hintAssetIds[0] ??= draft.hintAssetId
  return { hintAssetIds, hintAssetId: hintAssetIds[0] === draft.hintAssetId ? null : draft.hintAssetId }
}
