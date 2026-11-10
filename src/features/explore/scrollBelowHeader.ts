export function mobileHeaderClearance() {
  const header = document.querySelector('.site-header')
  return header ? Math.ceil(header.getBoundingClientRect().bottom) + 12 : 0
}

export function scrollBelowHeader(target: HTMLElement | null) {
  if (!target) return
  target.style.scrollMarginTop = `${mobileHeaderClearance()}px`
  target.scrollIntoView?.({ block: 'start' })
}
