import { expect, it, vi } from 'vitest'
import { mobileHeaderClearance, scrollBelowHeader } from './scrollBelowHeader'

it('scrolls a target below the measured header and updates the gap after resize', () => {
  const header = document.createElement('header')
  header.className = 'site-header'
  const target = document.createElement('section')
  const scroll = vi.fn()
  target.scrollIntoView = scroll
  document.body.append(header, target)
  try {
    const bounds = vi.spyOn(header, 'getBoundingClientRect')
    bounds.mockReturnValue(new DOMRect(0, 0, 390, 56.5))
    scrollBelowHeader(target)
    expect(target.style.scrollMarginTop).toBe('69px')
    expect(scroll).toHaveBeenCalledWith({ block: 'start' })

    bounds.mockReturnValue(new DOMRect(0, 0, 390, 80))
    scrollBelowHeader(target)
    expect(target.style.scrollMarginTop).toBe('92px')
    expect(mobileHeaderClearance()).toBe(92)
  } finally {
    header.remove()
    target.remove()
  }
})
