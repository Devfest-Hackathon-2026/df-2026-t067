import { useEffect, useId, useState } from 'react'
import { ChoiceWithOther } from './ChoiceWithOther'

type Mode = 'unset' | 'all-day' | 'specified' | 'supplement'
const exceptionPhrases = ['月曜休業', '火曜休業', '水曜休業', '木曜休業', '金曜休業', '土曜休業', '日曜休業', '祝日は休業', '年末年始休業', '臨時休業あり'] as const
const range = /^((?:[01]\d|2[0-3]):[0-5]\d)〜(翌日 )?((?:[01]\d|2[0-3]):[0-5]\d|24:00)(?:\n([\s\S]*))?$/
function read(value: string) {
  const match = range.exec(value)
  return { mode: (!value ? 'unset' : value === '終日' || value.startsWith('終日\n') ? 'all-day' : match ? 'specified' : 'unset') as Mode,
    start: match?.[1] ?? '', end: match?.[3] === '24:00' ? '00:00' : match?.[3] ?? '',
    next: Boolean(match?.[2]) || match?.[3] === '24:00', exceptions: match ? (match[4] ?? '') : (value.startsWith('終日\n') ? value.slice(3) : value === '終日' ? '' : value) }
}

/** UI helpers only: the persisted contract remains an optional, bounded string. */
export function HoursInput({ value, onChange, onError }: { value: string; onChange: (value: string) => void; onError?: (error: string) => void }) {
  const [initial] = useState(() => read(value))
  const [mode, setMode] = useState(initial.mode)
  const [start, setStart] = useState(initial.start)
  const [end, setEnd] = useState(initial.end)
  const [next, setNext] = useState(initial.next)
  const [exceptions, setExceptions] = useState(initial.exceptions)
  const [free, setFree] = useState(initial.mode === 'supplement' ? value : '')
  function update(m: Mode, s = start, e = end, n = next, x = exceptions) {
    const base = m === 'all-day' ? '終日' : m === 'specified' && (s || e)
      ? `${s || '（開始未設定）'}〜${n ? '翌日 ' : ''}${e || '（終了未設定）'}` : ''
    onChange(m === 'supplement' ? free : [base, x].filter(Boolean).join('\n'))
  }
  const errorId = useId()
  const error = mode === 'specified' && start && end && end <= start && !next ? '終了時刻は開始時刻より後にするか、翌日終了を選択。' : ''
  useEffect(() => { onError?.(error) }, [error, onError])
  return <fieldset><legend>利用時間</legend>

    <div role="radiogroup" aria-label="利用時間の設定">
      {([['unset', '未設定'], ['all-day', '終日'], ['specified', '時刻指定'], ['supplement', '補足']] as const).map(([m, label]) => <label key={m}><input type="radio" name="hours-mode" checked={mode === m} onChange={() => {
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
      <label>開始時刻<input aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined} type="time" step="60" value={start} onChange={event => { setStart(event.target.value); update(mode, event.target.value) }} /></label>
      <label>終了時刻<input aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined} type="time" step="60" value={end} onChange={event => { setEnd(event.target.value); update(mode, start, event.target.value) }} /></label>
      <label><input type="checkbox" checked={next} onChange={event => { setNext(event.target.checked); update(mode, start, end, event.target.checked) }} />翌日終了</label>
      {error && <p id={errorId} role="alert" className="field-error">{error}</p>}
    </div>}
    {mode !== 'supplement' && <ChoiceWithOther label="休業例外" phrases={exceptionPhrases} value={exceptions} onChange={value => { setExceptions(value); update(mode, start, end, next, value) }} />}
    {mode === 'supplement' && <label>時間補足<textarea value={free} onChange={event => { setFree(event.target.value); onChange(event.target.value) }} /></label>}

  </fieldset>
}
