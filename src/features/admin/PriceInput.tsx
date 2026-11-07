const kinds = ['無料', '有料', '未確認'] as const
function split(value: string) {
  for (const kind of kinds) {
    if (value === kind) return { kind, detail: '' }
    if (value.startsWith(kind + '：')) return { kind, detail: value.slice(kind.length + 1) }
  }
  return { kind: '', detail: value }
}
export function PriceInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const parsed = split(value)
  return <div>
    <label>料金の区分<select value={parsed.kind} onChange={event => {
      const kind = event.target.value
      onChange(kind ? kind + (parsed.detail ? '：' + parsed.detail : '') : parsed.detail)
    }}><option value="">未設定・自由文</option>{kinds.map(kind => <option key={kind}>{kind}</option>)}</select></label>
    <label>料金<input value={value} onChange={event => onChange(event.target.value)} placeholder="有料の場合は金額・大人／子供などの補足" /></label>
    <p className="helper">区分を選んでも既存の補足は保持します。空欄は無料を意味しません。</p>
  </div>
}
