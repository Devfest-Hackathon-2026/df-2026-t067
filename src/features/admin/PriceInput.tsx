import { normalizePrice } from '../../shared/api/admin'
import { useEffect, useId, useState } from 'react'

const targets = ['一律', '大人', '子供'] as const
function read(value: string) {
  const normalized = normalizePrice(value)
  if (normalized === '無料') return { kind: '無料', amounts: {} as Record<string, string> }
  const detail = normalized.replace(/^有料：/, '')
  const parts = detail.split(/[・／]/)
  const amounts: Record<string, string> = {}
  for (const part of parts) {
    const match = /^(一律|大人|子供|子ども)?\s*(\d+)円$/.exec(part)
    if (!match) return { kind: '', amounts: {} as Record<string, string> }
    amounts[match[1] === '子ども' ? '子供' : match[1] || '一律'] = match[2]
  }
  return { kind: '有料', amounts }
}

export function PriceInput({ value, onChange, onError }: { value: string; onChange: (value: string) => void; onError?: (error: string) => void }) {
  const [initial] = useState(() => read(value))
  const [kind, setKind] = useState(initial.kind)
  const [amounts, setAmounts] = useState(initial.amounts)
  const errorId = useId()
  const error = kind === '有料' && (!Object.keys(amounts).length || Object.values(amounts).some(amount => !/^\d+$/.test(amount) || !Number.isSafeInteger(Number(amount)))) ? '金額は0以上の整数' : ''
  useEffect(() => { onError?.(error) }, [error, onError])
  function write(nextKind: string, nextAmounts: Record<string, string>) {
    onChange(nextKind === '有料' ? '有料：' + targets.filter(target => target in nextAmounts).map(target => `${target} ${nextAmounts[target]}円`).join('・') : nextKind)
  }
  return <div>
    <label>料金の区分<select value={kind} onChange={event => { const nextKind = event.target.value; setKind(nextKind); write(nextKind, amounts) }}>
      <option value="">未選択</option><option>無料</option><option>有料</option>
    </select></label>
    {kind === '' && value && <p>{value}</p>}
    {kind === '有料' && <fieldset className="price-targets" aria-describedby={error && !Object.keys(amounts).length ? errorId : undefined}><legend>対象</legend>
      {targets.map(target => <div key={target} className="price-target">
        <label><input type="checkbox" checked={target in amounts} onChange={event => {
          const nextAmounts = { ...amounts }
          if (event.target.checked) {
            if (target === '一律') { delete nextAmounts['大人']; delete nextAmounts['子供'] }
            else delete nextAmounts['一律']
            nextAmounts[target] = ''
          } else delete nextAmounts[target]
          setAmounts(nextAmounts); write(kind, nextAmounts)
        }} />{target}</label>
        {target in amounts && <>
          <span className="price-amount"><input aria-label={`${target}の金額`} type="number" min="0" step="1" inputMode="numeric" value={amounts[target]} aria-invalid={Boolean(error)} aria-describedby={error ? errorId + target : undefined} onChange={event => {
            const nextAmounts = { ...amounts, [target]: event.target.value }; setAmounts(nextAmounts); write(kind, nextAmounts)
          }} />円</span>
          {error && <p id={errorId + target} role="alert" className="field-error">{error}</p>}
        </>}
      </div>)}
      {error && !Object.keys(amounts).length && <p id={errorId} role="alert" className="field-error">対象と金額を選択</p>}
    </fieldset>}
  </div>
}
