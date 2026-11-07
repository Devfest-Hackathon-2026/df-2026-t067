import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { ApiClient, ManagedQuest, OrgMembership } from '../../shared/api'
import { useLocalDraftSave } from './useLocalDraftSave'

export function HintAssetEditor({ api, initial, member, onBack }: { api: ApiClient; initial: ManagedQuest; member: OrgMembership; onBack: () => void }) {
  const { record, state, save } = useLocalDraftSave({ api, initial, member, onBack })
  const [slot, setSlot] = useState(1)
  const [file, setFile] = useState<File | null>(null)
  const [rights, setRights] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const current = record ?? initial
  const assets = current.draft.hintAssetIds ?? [null, null, null]
  const activeSlots = current.draft.content.hints.flatMap((hint, index) => hint.trim() ? [index + 1] : [])
  const valid = file !== null && file.size > 0 && file.size <= 4 * 1024 * 1024 &&
    ['image/jpeg', 'image/png', 'image/webp'].includes(file.type) && activeSlots.includes(slot)
  const blocked = state.status === 'saving' || (state.status === 'error' && state.reload === true)

  function clearSelection() {
    setFile(null)
    setRights('')
    if (input.current) input.current.value = ''
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!valid || !rights.trim() || blocked) return
    void save(current.draft, { file, purpose: 'public_hint', photoRights: rights, hintIndex: slot }, clearSelection)
  }

  function remove(index: number) {
    const next = [...assets]
    next[index - 1] = null
    const legacyHintAssetId = current.draft.hintAssetId
    if (index === 1 && current.draft.hintAssetIds === undefined) {
      void save({ ...current.draft, hintAssetId: null, hintAssetIds: next }, undefined, clearSelection)
    } else {
      if (index !== 1 && legacyHintAssetId && current.draft.hintAssetIds === undefined) next[0] = legacyHintAssetId
      void save({ ...current.draft, hintAssetId: null, hintAssetIds: next }, undefined, clearSelection)
    }
  }

  return <section className="form-section" aria-labelledby="hint-asset-title">
    <h2 id="hint-asset-title">ヒントごとの画像</h2>
    <p>{current.draft.content.title || '無題の下書き'}・下書き版 {current.draftRevision}</p>
    <p>各ヒントに公開用画像を1枚設定できます。権利を確認した画像を選んでください。</p>
    <button type="button" disabled={state.status === 'saving'} onClick={onBack}>問題一覧へ戻る</button>
    {current.draft.content.hints.map((hint, index) => {
      const number = index + 1
      const assetId = assets[index] ?? (number === 1 ? current.draft.hintAssetId : null)
      return <section className="form-section" key={number} aria-label={`ヒント ${number}`}>
        <h3>ヒント {number}</h3><p>{hint.trim() || 'ヒント文は未入力です。'}</p>
        <p>{assetId ? '画像が設定されています。' : '画像は未設定です。'}</p>
        {assetId && <button type="button" disabled={blocked} onClick={() => remove(number)}>ヒント {number}の画像を外す</button>}
      </section>
    })}
    <form onSubmit={submit}>
      <fieldset disabled={blocked}>
        <legend>ヒント画像を追加・変更</legend>
        <label>設定するヒント<select value={slot} onChange={(event) => setSlot(Number(event.target.value))}>
          {activeSlots.map((number) => <option value={number} key={number}>ヒント {number}</option>)}
        </select></label>
        <label>公開ヒント画像<input ref={input} type="file" accept="image/jpeg,image/png,image/webp"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label>
        <label>画像の出典と利用権<textarea rows={2} maxLength={2000} value={rights}
          onChange={(event) => setRights(event.target.value)} /></label>
        {file && !valid && <p>4 MiB以内のJPEG・PNG・WebPを選んでください。</p>}
        {activeSlots.length === 0 && <p role="note">画像を設定できるヒント文がありません。</p>}
        <button type="submit" disabled={!valid || !rights.trim() || activeSlots.length === 0}>ヒント画像を保存</button>
      </fieldset>
    </form>
    {state.status === 'saving' && <p role="status">保存しています…</p>}
    {state.status === 'saved' && <p role="status">ヒント画像の設定を保存しました。</p>}
    {state.status === 'error' && <p role="alert">{state.message}</p>}
  </section>
}
