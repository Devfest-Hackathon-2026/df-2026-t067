import { useRef, useState } from 'react'
import { ApiError } from '../../shared/api'
import type { ApiClient, AssetPurpose, ManagedQuest, ManagedQuestDraft, OrgMembership } from '../../shared/api'
import { normalizeHintAssets } from './hintAssets'
import { useRequestAction } from '../../shared/useRequestAction'

export interface LocalDraftConnection {
  saveBlocked?: boolean
  taskFocused?: boolean
  workflowPart?: 1 | 2 | 3 | 'all'
  onDirty?: (dirty: boolean) => void
  onSaving?: (busy: boolean) => void
  onWorkflowSave?: (record: ManagedQuest, advance: boolean) => void
  api: Pick<ApiClient, 'uploadOrgAsset' | 'createManagedQuest' | 'updateManagedQuest' | 'generateManagedQuestDraft' | 'canLookupSpotAddress' | 'lookupSpotAddress'>
  initial: ManagedQuest | null
  member: OrgMembership
  onContinue?: (record: ManagedQuest, destination: 'areas' | 'publication' | 1 | 2 | 3) => void
  onBack: () => void
}

type SaveState = { status: 'idle' | 'saving' | 'saved' } | { status: 'error'; message: string; reload?: true }
type DraftAsset = { file: File; purpose: AssetPurpose; photoRights: string; hintIndex?: number }

function saveFailure(cause: unknown, attemptedCreate: boolean): SaveState {
  const code = cause instanceof ApiError ? cause.code : undefined
  if (code === 'SPOT_OUTSIDE_AREA') return { status: 'error', message: 'エリアの外です' }
  if (code === 'DRAFT_CONFLICT') return { status: 'error', reload: true,
    message: '下書きの版が変わりました。入力を控えてから一覧で最新版を確認してください。' }
  if (code === 'INVALID_INPUT' || code === 'MEDIA_TOO_LARGE') return { status: 'error',
    message: '入力内容と写真の形式・容量を確認してください。' }
  if (attemptedCreate) return { status: 'error', reload: true,
    message: '新しい下書きの保存結果を確認できませんでした。再作成する前に一覧を確認してください。' }
  return { status: 'error', message: '下書きを保存できませんでした。設定や通信状況を確認して再試行してください。' }
}

export function useLocalDraftSave(connection?: LocalDraftConnection) {
  const [localRecord, setRecord] = useState(connection?.initial ?? null)
  const record = connection?.workflowPart === 'all' ? connection.initial : localRecord
  const [state, setState] = useState<SaveState>({ status: 'idle' })
  const upload = useRef<(DraftAsset & { key: string }) | null>(null)
  const begin = useRequestAction()

  async function save(draft: ManagedQuestDraft, asset: DraftAsset | undefined, onSaved: (record: ManagedQuest) => void) {
    if (!connection || (state.status === 'error' && state.reload)) return
    if (asset && !connection.workflowPart && !asset.photoRights.trim()) {
      setState({ status: 'error', message: '写真の権利を入力' })
      return
    }
    let attemptedCreate = false
    const operation = begin(() => { setState(saveFailure(undefined, attemptedCreate)); connection.onSaving?.(false) })
    if (!operation) return
    setState({ status: 'saving' })
    connection.onSaving?.(true)
    const { api, member: { orgId } } = connection
    const call = { signal: operation.signal }
    try {
      let payload = draft
      if (asset) {
        const { file, purpose, hintIndex } = asset
        const photoRights = asset.photoRights.trim()
        if (upload.current?.file !== file || upload.current.purpose !== purpose || upload.current.photoRights !== photoRights) {
          upload.current = { file, purpose, photoRights, key: crypto.randomUUID() }
        }
        const savedAsset = await api.uploadOrgAsset(orgId, { purpose, photo: file, ...(connection.workflowPart ? {} : { photoRights }),
          idempotencyKey: upload.current.key }, call)
        if (!operation.isCurrent()) return
        if (purpose === 'reference') payload = { ...draft, referenceAssetId: savedAsset.assetId }
        else if (hintIndex !== undefined) {
          const { hintAssetIds, hintAssetId } = normalizeHintAssets(draft)
          hintAssetIds[hintIndex - 1] = savedAsset.assetId
          payload = { ...draft, hintAssetIds, hintAssetId }
        } else payload = { ...draft, hintAssetId: savedAsset.assetId }
      }
      attemptedCreate = record === null
      const saved = record === null ? await api.createManagedQuest(orgId, payload, { ...call, ...(connection.workflowPart ? { deriveShootingArea: true } : {}) })
        : await api.updateManagedQuest(orgId, record.questId, { expectedDraftRevision: record.draftRevision, draft: payload, ...(connection.workflowPart ? { deriveShootingArea: true } : {}) }, call)
      if (!operation.isCurrent()) return
      setRecord(saved)
      setState({ status: 'saved' })
      upload.current = null
      onSaved(saved)
      connection.onDirty?.(false)
    } catch (cause) {
      if (operation.isCurrent()) setState(saveFailure(cause, attemptedCreate))
    } finally {
      if (operation.isCurrent()) connection.onSaving?.(false)
      operation.finish()
    }
  }

  return { record, state, save, reset: () => setState({ status: 'idle' }) }
}
