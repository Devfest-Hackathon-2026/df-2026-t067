import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { ApiClient, ManagedQuest, OrgMembership } from '../../shared/api'
import { useLocalDraftSave } from './useLocalDraftSave'

export function HintAssetEditor({ api, initial, member, onBack }: { api: ApiClient; initial: ManagedQuest; member: OrgMembership; onBack: () => void }) {
  const { record, state, save } = useLocalDraftSave({ api, initial, member, onBack })
  const [file, setFile] = useState<File | null>(null)
  const [rights, setRights] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const current = record ?? initial
  const hasHint = current.draft.hintAssetId !== null
  const valid = file !== null && file.size > 0 && file.size <= 4 * 1024 * 1024 &&
    ['image/jpeg', 'image/png', 'image/webp'].includes(file.type)
  const blocked = state.status === 'saving' || (state.status === 'error' && state.reload === true)

  function clearSelection() {
    setFile(null)
    setRights('')
    if (input.current) input.current.value = ''
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!valid || !rights.trim() || blocked) return
    void save(current.draft, { file, purpose: 'public_hint', photoRights: rights }, clearSelection)
  }

  return <section className="form-section" aria-labelledby="hint-asset-title">
    <h2 id="hint-asset-title">公開ヒント画像の設定</h2>
    <p>{current.draft.content.title || '無題の下書き'}・下書き版 {current.draftRevision}</p>
    <p>参考写真とは別の、権利を確認した合成画像を選びます。保存した画像は、次の公開版で旅行者が開けます。</p>
    <button type="button" disabled={state.status === 'saving'} onClick={onBack}>問題一覧へ戻る</button>
    <p>{hasHint ? '下書きに公開ヒント画像が設定されています。' : '公開ヒント画像は未設定です。'}</p>
    <form onSubmit={submit}>
      <fieldset disabled={blocked}>
        <legend>新しい公開ヒント画像</legend>
        <label>公開ヒント画像<input ref={input} type="file" accept="image/jpeg,image/png,image/webp"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label>
        <label>公開ヒント画像の利用権<textarea rows={2} maxLength={2000} value={rights}
          onChange={(event) => setRights(event.target.value)} /></label>
        {file && !valid && <p>4 MiB以内のJPEG・PNG・WebPを選んでください。</p>}
        <button type="submit" disabled={!valid || !rights.trim()}>ヒント画像を下書きへ保存</button>
      </fieldset>
    </form>
    {hasHint && <button type="button" disabled={blocked}
      onClick={() => void save({ ...current.draft, hintAssetId: null }, undefined, clearSelection)}>参照を外して保存</button>}
    {state.status === 'saving' && <p role="status">保存しています…</p>}
    {state.status === 'saved' && <p role="status">公開ヒント画像の設定を保存しました。</p>}
    {state.status === 'error' && <p role="alert">{state.message}</p>}
  </section>
}
