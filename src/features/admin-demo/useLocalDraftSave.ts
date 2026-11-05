import { useRef, useState } from 'react'
import { ApiError } from '../../shared/api'
import type { ApiClient, ManagedQuest, ManagedQuestDraft, OrgMembership } from '../../shared/api'
import { useRequestAction } from '../../shared/useRequestAction'

export interface LocalDraftConnection {
  api: Pick<ApiClient, 'uploadOrgAsset' | 'createManagedQuest' | 'updateManagedQuest'>
  initial: ManagedQuest | null
  member: OrgMembership
  onBack: () => void
}

type SaveState = { status: 'idle' | 'saving' | 'saved' } | { status: 'error'; message: string; reload?: true }

function saveFailure(cause: unknown, attemptedCreate: boolean): SaveState {
  const code = cause instanceof ApiError ? cause.code : undefined
  if (code === 'DRAFT_CONFLICT') return { status: 'error', reload: true,
    message: '下書きの版が変わりました。入力を控えてから一覧で最新版を確認してください。' }
  if (code === 'INVALID_INPUT' || code === 'MEDIA_TOO_LARGE') return { status: 'error',
    message: '入力内容と参考写真の形式・容量を確認してください。' }
  if (attemptedCreate) return { status: 'error', reload: true,
    message: '新しい下書きの保存結果を確認できませんでした。再作成する前に一覧を確認してください。' }
  return { status: 'error', message: '下書きを保存できませんでした。設定や通信状況を確認して再試行してください。' }
}

export function useLocalDraftSave(connection?: LocalDraftConnection) {
  const [record, setRecord] = useState(connection?.initial ?? null)
  const [state, setState] = useState<SaveState>({ status: 'idle' })
  const upload = useRef<{ file: File; rights: string; key: string } | null>(null)
  const begin = useRequestAction()

  async function save(draft: ManagedQuestDraft, photo: File | undefined, onSaved: (record: ManagedQuest) => void) {
    if (!connection || (state.status === 'error' && state.reload)) return
    if (photo && !draft.materials.photoRights.trim()) {
      setState({ status: 'error', message: '参考写真の出典と利用権を入力してください。' })
      return
    }
    let attemptedCreate = false
    const operation = begin(() => setState(saveFailure(undefined, attemptedCreate)))
    if (!operation) return
    setState({ status: 'saving' })
    const { api, member: { orgId } } = connection
    const call = { signal: operation.signal }
    try {
      let payload = draft
      if (photo) {
        const rights = draft.materials.photoRights.trim()
        if (upload.current?.file !== photo || upload.current.rights !== rights) {
          upload.current = { file: photo, rights, key: crypto.randomUUID() }
        }
        const reference = await api.uploadOrgAsset(orgId, { purpose: 'reference', photo, photoRights: rights,
          idempotencyKey: upload.current.key }, call)
        if (!operation.isCurrent()) return
        payload = { ...draft, referenceAssetId: reference.assetId }
      }
      attemptedCreate = record === null
      const saved = record === null ? await api.createManagedQuest(orgId, payload, call)
        : await api.updateManagedQuest(orgId, record.questId, { expectedDraftRevision: record.draftRevision, draft: payload }, call)
      if (!operation.isCurrent()) return
      setRecord(saved)
      setState({ status: 'saved' })
      upload.current = null
      onSaved(saved)
    } catch (cause) {
      if (operation.isCurrent()) setState(saveFailure(cause, attemptedCreate))
    } finally { operation.finish() }
  }

  return { record, state, save }
}
