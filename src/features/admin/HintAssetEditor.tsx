import { PHOTO_UPLOAD_MAX_BYTES, PHOTO_UPLOAD_MIME_TYPES, PHOTO_UPLOAD_ACCEPT } from '../../shared/mediaLimits'
import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { ApiClient, ManagedQuest, OrgMembership } from '../../shared/api'
import { PhotoRightsInput } from './PhotoRightsInput'
import { normalizeHintAssets } from './hintAssets'
import { useLocalDraftSave } from './useLocalDraftSave'

export function HintAssetEditor({ api, initial, member, onBack, initialSlot = 1, rightsAssist = false, backLabel = '謎一覧へ', onContinue, onDirty, onSaving, onSaved, embedded = false }:  { embedded?: boolean; api: ApiClient; initial: ManagedQuest; member: OrgMembership; onBack: () => void; initialSlot?: number; rightsAssist?: boolean; backLabel?: string; onContinue?: (record: ManagedQuest) => void; onDirty?: (dirty: boolean) => void; onSaving?: (busy: boolean) => void; onSaved?: (record: ManagedQuest) => void }) {
  const { record, state, save } = useLocalDraftSave({ api, initial, member, onBack, ...(onContinue ? { workflowPart: 3, onDirty, onSaving } : {}) })
  const [slot, setSlot] = useState(initialSlot)
  const [file, setFile] = useState<File | null>(null)
  const [rights, setRights] = useState('')
  const [reuseNeeded, setReuseNeeded] = useState(false)
  const previousPhoto = useRef<File | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const current = record ?? initial
  const assets = current.draft.hintAssetIds ?? [null, null, null]
  const activeSlots = current.draft.content.hints.flatMap((hint, index) => hint.trim() ? [index + 1] : [])
  const valid = file !== null && file.size > 0 && file.size <= PHOTO_UPLOAD_MAX_BYTES &&
    PHOTO_UPLOAD_MIME_TYPES.includes(file.type) && activeSlots.includes(slot)
  const blocked = state.status === 'saving' || (state.status === 'error' && state.reload === true)

  const statusRef = useRef<HTMLParagraphElement>(null)
  useEffect(() => { if (state.status === 'saved') statusRef.current?.focus() }, [state.status])
  useEffect(() => {
    if (embedded && !file) return
    const listener = () => input.current?.form?.requestSubmit()
    document.addEventListener('admin-save-draft', listener)
    return () => document.removeEventListener('admin-save-draft', listener)
  }, [embedded, file])
  function clearSelection() {
    setFile(null)
    onDirty?.(false)
    setRights('')
    setReuseNeeded(false); previousPhoto.current = null
    if (input.current) input.current.value = ''
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!valid || (!onContinue && (!rights.trim() || reuseNeeded)) || blocked) return
    const advance = (event.nativeEvent as SubmitEvent).submitter?.getAttribute('value') === 'next'
    void save(current.draft, { file, purpose: 'public_hint', photoRights: rights, hintIndex: slot }, (saved) => {
      clearSelection()
      onSaved?.(saved)
      if (advance) onContinue?.(saved)
    })
  }

  function remove(index: number) {
    const { hintAssetIds, hintAssetId } = normalizeHintAssets(current.draft)
    hintAssetIds[index - 1] = null
    void save({ ...current.draft, hintAssetId, hintAssetIds }, undefined, (saved) => { clearSelection(); onSaved?.(saved) })
  }

  return <section className="form-section" aria-labelledby="hint-asset-title">
    <h2 id="hint-asset-title">ヒント画像</h2>
    {!embedded && <button type="button" disabled={state.status === 'saving'} onClick={onBack}>{backLabel}</button>}
    {current.draft.content.hints.map((hint, index) => {
      const number = index + 1
      const assetId = assets[index] ?? (number === 1 ? current.draft.hintAssetId : null)
      return <section className="form-section" key={number} aria-label={`ヒント ${number}の画像`}>
        <h3>ヒント {number}</h3><p>{hint.trim() || '未入力'}</p>
        {assetId && <button type="button" disabled={blocked} onClick={() => remove(number)}>ヒント {number}の画像を外す</button>}
      </section>
    })}
    <form onSubmit={submit}>
      <fieldset disabled={blocked}>
        <legend>画像を選ぶ</legend>
        <label>設定するヒント<select value={slot} onChange={(event) => setSlot(Number(event.target.value))}>
          {activeSlots.map((number) => <option value={number} key={number}>ヒント {number}</option>)}
        </select></label>
        <label className="photo-picker">ヒント画像<span className="photo-picker-button" aria-hidden="true">写真を選ぶ</span><input aria-label="ヒント画像" id="workflow-hint-image" ref={input} aria-invalid={Boolean(file && !valid)} aria-describedby={file && !valid ? "hint-photo-error" : undefined} type="file" accept={PHOTO_UPLOAD_ACCEPT}
          onChange={(event) => {
            const next = event.target.files?.[0] ?? null
            if (rightsAssist && next && previousPhoto.current && rights.trim()) setReuseNeeded(true)
            if (next) previousPhoto.current = next
            setFile(next)
            onDirty?.(next !== null)
          }} /></label>
        {file && <p>{file.name}</p>}
        {!onContinue && (rightsAssist ? <PhotoRightsInput key={file ? `${slot}:${file.name}:${file.lastModified}` : `empty:${slot}`} purpose="public_hint" label="画像の権利" value={rights} onChange={value => { setRights(value); setReuseNeeded(false) }} /> : <label>画像の権利<textarea value={rights} onChange={event => setRights(event.target.value)} /></label>)}
        {!onContinue && reuseNeeded && <label><input type="checkbox" checked={false} onChange={() => setReuseNeeded(false)} />差し替え写真の公開権を確認</label>}
        {file && !valid && <p id="hint-photo-error" role="alert" className="field-error">JPEG・PNG・WebP／4MB以下</p>}
        {activeSlots.length === 0 && <p role="note">ヒント未入力</p>}
        <div className={onContinue && file && !embedded ? "admin-list-actions admin-save-bar" : undefined}>
        <button type="submit" disabled={!valid || (!onContinue && (!rights.trim() || reuseNeeded)) || activeSlots.length === 0}>画像を保存</button>
        {!embedded && onContinue && file && <button type="submit" value="next" className="workflow-primary" disabled={!valid}>保存して次へ</button>}
        </div>
      </fieldset>
    </form>
    {!embedded && onContinue && !file && <div className="admin-list-actions admin-save-bar"><button type="button" className="workflow-primary" disabled={blocked} onClick={() => onContinue(current)}>試験・公開へ</button></div>}
    {onContinue && file && <button type="button" disabled={blocked} onClick={clearSelection}>選択を取り消す</button>}
    {state.status === 'saving' && <p role="status">保存中</p>}
    {state.status === 'saved' && <p role="status" tabIndex={-1} ref={statusRef}><span className="save-success">保存済み</span></p>}
    {state.status === 'error' && <p role="alert">{state.message}</p>}
  </section>
}
