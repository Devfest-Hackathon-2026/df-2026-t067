import { useEffect, useRef, useState } from 'react'

function split(value: string, phrases: readonly string[]) {
  const parts = value.split(/([。\n、・])/)
  const selected = phrases.filter(phrase => parts.includes(phrase))
  const other = selected.length ? parts.map(part => selected.includes(part) ? '' : part).join('').replace(/^[。\n、・]+|[。\n、・]+$/g, '') : value
  return { selected, other }
}

export function ChoiceWithOther({ label, phrases, value, onChange }: {
  label: string; phrases: readonly string[]; value: string; onChange: (value: string) => void
}) {
  const [parsed, setParsed] = useState(() => split(value, phrases))
  const lastValue = useRef(value)
  const [otherOpen, setOtherOpen] = useState(Boolean(parsed.other))
  useEffect(() => {
    if (lastValue.current !== value) {
      const next = split(value, phrases)
      setParsed(next); setOtherOpen(Boolean(next.other)); lastValue.current = value
    }
  }, [value, phrases])
  function write(selected: readonly string[], other: string) {
    const nextValue = [...selected, other].filter(Boolean).join('\n')
    setParsed({ selected: [...selected], other }); lastValue.current = nextValue
    onChange(nextValue)
  }
  return <fieldset className="choice-with-other"><legend>{label}</legend>
    <div className="choice-options">
    {phrases.map(phrase => <label key={phrase} className="choice-option"><input type="checkbox" checked={parsed.selected.includes(phrase)} onChange={event => write(event.target.checked ? [...parsed.selected, phrase] : parsed.selected.filter(item => item !== phrase), parsed.other)} />{phrase}</label>)}
    <label className="choice-option"><input type="checkbox" aria-label={`${label}のその他を選択`} checked={otherOpen || Boolean(parsed.other)} onChange={event => { setOtherOpen(event.target.checked); if (!event.target.checked) write(parsed.selected, '') }} />その他</label>
    </div>
    {(otherOpen || Boolean(parsed.other)) && <label>{label}のその他<textarea value={parsed.other} onChange={event => write(parsed.selected, event.target.value)} /></label>}
  </fieldset>
}
