const locks = new WeakMap<HTMLElement, { count: number; original: boolean }>()

// 重なった画面がどちらの順で閉じても、最後の画面が元の状態に戻す。
export function inertBackground(foreground: HTMLElement | null) {
  const elements = Array.from(document.body.children).filter(
    (element): element is HTMLElement => element instanceof HTMLElement && element !== foreground,
  )
  for (const element of elements) {
    const lock = locks.get(element) ?? { count: 0, original: element.hasAttribute('inert') }
    lock.count++
    locks.set(element, lock)
    element.setAttribute('inert', '')
  }
  return () => {
    for (const element of elements) {
      const lock = locks.get(element)
      if (!lock || --lock.count > 0) continue
      element.toggleAttribute('inert', lock.original)
      locks.delete(element)
    }
  }
}
