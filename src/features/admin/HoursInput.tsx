import { useState } from 'react'

type Mode = 'unset' | 'all-day' | 'specified' | 'supplement'
const range = /^((?:[01]\d|2[0-3]):[0-5]\d)〜(翌日 )?((?:[01]\d|2[0-3]):[0-5]\d|24:00)(?:\n([\s\S]*))?$/
function read(value: string) {
  const match = range.exec(value)
  return { mode: (!value ? 'unset' : value === '終日' || value.startsWith('終日\n') ? 'all-day' : match ? 'specified' : 'supplement') as Mode,
    start: match?.[1] ?? '', end: match?.[3] === '24:00' ? '00:00' : match?.[3] ?? '',
    next: Boolean(match?.[2]) || match?.[3] === '24:00', exceptions: match?.[4] ?? (value.startsWith('終日\n') ? value.slice(3) : '') }
}

/** UI helpers only: the persisted contract remains an optional, bounded string. */
export function HoursInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [initial] = useState(() => read(value))
  const [mode, setMode] = useState(initial.mode)
  const [start, setStart] = useState(initial.start)
  const [end, setEnd] = useState(initial.end)
  const [next, setNext] = useState(initial.next)
  const [exceptions, setExceptions] = useState(initial.exceptions)
  const [free, setFree] = useState(initial.mode === 'supplement' ? value : '')
  function update(m: Mode, s = start, e = end, n = next, x = exceptions) {
    const reversed = Boolean(s && e && e <= s && !n)
    const base = m === 'all-day' ? '終日' : m === 'specified' && (s || e)
      ? `${s || '（開始未設定）'}〜${n ? '翌日 ' : ''}${e || '（終了未設定）'}${reversed ? '（前後関係を要確認）' : ''}` : ''
    onChange(m === 'supplement' ? free : [base, x].filter(Boolean).join('\n'))
  }
  const incomplete = mode === 'specified' && (!start || !end || (end <= start && !next))
  return <fieldset><legend>利用できる時間</legend>
    <p className="helper">施設の営業時間などのクリア後案内です。撮影可能時間の制約は「撮影時の注意」に記載してください。</p>
    <div role="radiogroup" aria-label="利用できる時間の設定">
      {([['unset', '未設定'], ['all-day', '終日'], ['specified', '時間を指定'], ['supplement', '補足を入力']] as const).map(([m, label]) => <label key={m}><input type="radio" name="hours-mode" checked={mode === m} onChange={() => {
        if (m === 'supplement') { setFree(value); onChange(value) }
        else if (mode === 'supplement' && value) {
          const parsed = read(value)
          if (parsed.mode === 'specified' || parsed.mode === 'all-day') {
            setStart(parsed.start); setEnd(parsed.end); setNext(parsed.next); setExceptions(parsed.exceptions)
            update(m, parsed.start, parsed.end, parsed.next, parsed.exceptions)
          } else { setExceptions(value); update(m, start, end, next, value) }
        }
        else update(m)
        setMode(m)
      }} />{label}</label>)}
    </div>
    {mode === 'specified' && <div>
      <label>開始時刻<input type="time" step="60" value={start} onChange={event => { setStart(event.target.value); update(mode, event.target.value) }} /></label>
      <label>終了時刻<input type="time" step="60" value={end} onChange={event => { setEnd(event.target.value); update(mode, start, event.target.value) }} /></label>
      <label><input type="checkbox" checked={next} onChange={event => { setNext(event.target.checked); update(mode, start, end, event.target.checked) }} />終了は翌日</label>
      {incomplete && <p role="status">時間は入力途中です。未設定・要確認の部分も案内文に明記して保存します。公開前に確認してください。</p>}
    </div>}
    {mode !== 'supplement' && <label>曜日・休業・例外<textarea value={exceptions} onChange={event => { setExceptions(event.target.value); update(mode, start, end, next, event.target.value) }} placeholder="例：月曜休業、祝日は10時から、臨時休業あり" /></label>}
    {mode === 'supplement' && <label>時間の補足<textarea value={free} onChange={event => { setFree(event.target.value); onChange(event.target.value) }} /></label>}
    <p className="helper">空欄は終日を意味しません。翌日0時は終了時刻00:00と「終了は翌日」で指定できます。</p>
    <details><summary>保存する時間案内</summary><p style={{ whiteSpace: 'pre-wrap' }}>{value || '未設定'}</p></details>
  </fieldset>
}
