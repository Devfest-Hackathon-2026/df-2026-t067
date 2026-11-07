import { useState, type Ref } from 'react'

const grounds = {
  self: '自分で撮影', municipal: '自治体所有', permission: '許諾あり', other: 'その他の権利根拠',
} as const
const purposes = {
  reference: '非公開の参考写真・照合', public_hint: '公開ヒント画像', test: '非公開の写真試験',
} as const

/** Only builds editable text. Asset ownership and purpose remain server-validated. */
export function PhotoRightsInput({ label, purpose, value, onChange, textareaRef, invalid, describedBy }: {
  textareaRef?: Ref<HTMLTextAreaElement>; invalid?: boolean; describedBy?: string
  label: string; purpose: keyof typeof purposes; value: string; onChange: (value: string) => void
}) {
  const [ground, setGround] = useState<keyof typeof grounds | ''>('')
  const [detail, setDetail] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const generated = ground && detail.trim() ? `${grounds[ground]}。${detail.trim()}。用途：${purposes[purpose]}。` : ''
  const next = [value, generated].filter(Boolean).join('\n')
  const ready = !!generated && confirmed && next.length <= 2000

  return <div>
    <label>{label}<textarea ref={textareaRef} aria-invalid={invalid} aria-describedby={describedBy} rows={2} maxLength={2000} value={value} onChange={(event) => onChange(event.target.value)} /></label>
    <details>
      <summary>選択して権利文を作る</summary>
      <p>この写真の権利と用途を確認してください。文の作成は権利の証明になりません。</p>
      <label>権利の根拠<select value={ground} onChange={(event) => {
        setGround(event.target.value as keyof typeof grounds | ''); setConfirmed(false)
      }}>
        <option value="">選択してください</option>
        {Object.entries(grounds).map(([key, text]) => <option key={key} value={key}>{text}</option>)}
      </select></label>
      <label>撮影者・所有者・許諾元と利用条件<input value={detail} maxLength={1800} onChange={(event) => {
        setDetail(event.target.value); setConfirmed(false)
      }} /></label>
      <label className="check-option"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
        この写真を{purposes[purpose]}に使えることを確認した</label>
      {generated && <p>{generated}</p>}
      {next.length > 2000 && <p role="alert">利用権は追記後2000文字以内にしてください。</p>}
      <button type="button" disabled={!ready} onClick={() => {
        if (ready) { onChange(next); setConfirmed(false) }
      }}>権利文に追記</button>
    </details>
  </div>
}
