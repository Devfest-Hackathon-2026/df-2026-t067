/** Only a complete week with the same single interval can represent HoursInput safely. */
export function placeHoursCandidate(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined
  const periods = (value as { periods?: unknown }).periods
  if (!Array.isArray(periods) || periods.length !== 7) return undefined
  const days = new Set<number>()
  let result: string | undefined
  for (const period of periods) {
    const { open, close } = period ?? {}
    if (!open || !close || !Number.isInteger(open.day) || open.day < 0 || open.day > 6 || days.has(open.day)) return undefined
    for (const time of [open, close]) {
      if (!Number.isInteger(time.hour) || time.hour < 0 || time.hour > 23 || !Number.isInteger(time.minute) || time.minute < 0 || time.minute > 59) return undefined
    }
    const next = close.day === (open.day + 1) % 7
    if (close.day !== open.day && !next) return undefined
    const start = open.hour * 60 + open.minute, end = close.hour * 60 + close.minute
    if ((!next && end <= start) || (next && end > start)) return undefined
    const format = (time: { hour: number; minute: number }) => `${String(time.hour).padStart(2, '0')}:${String(time.minute).padStart(2, '0')}`
    const candidate = `${format(open)}〜${next ? '翌日 ' : ''}${format(close)}`
    if (result && candidate !== result) return undefined
    days.add(open.day)
    result = candidate
  }
  return result
}
