/**
 * Toggle buttons that insert or remove stock phrases in a free-text field.
 * The persisted value stays a plain string; a phrase counts as selected when
 * the text contains it, so existing text is never rewritten silently.
 */
export function PhraseChips({ label, phrases, value, onChange }: {
  label: string
  phrases: readonly string[]
  value: string
  onChange: (value: string) => void
}) {
  function toggle(phrase: string) {
    if (value.includes(phrase)) {
      onChange(value.replace(phrase, '').replace(/。。/g, '。').replace(/^。/, ''))
      return
    }
    const base = value.trimEnd()
    onChange(base ? `${base}${base.endsWith('。') || base.endsWith('\n') ? '' : '。'}${phrase}` : phrase)
  }
  return <div className="phrase-chips">

    <div role="group" aria-label={label}>
      {phrases.map((phrase) => <button key={phrase} type="button" className="phrase-chip"
        aria-pressed={value.includes(phrase)} onClick={() => toggle(phrase)}>{phrase}</button>)}
    </div>
  </div>
}
