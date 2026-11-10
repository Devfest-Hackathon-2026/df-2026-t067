import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import appSource from '../App.tsx?raw'
import { Icon } from './Icon'

describe('共通の地図ピンアイコン', () => {
  it('雫の輪郭と白い中心を描き、共通の線の属性を維持する', () => {
    const { container } = render(<Icon name="pin" />)
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('stroke')).toBe('currentColor')
    expect(svg.getAttribute('fill')).toBe('none')
    expect(svg.getAttribute('stroke-width')).toBe('1.8')
    expect(svg.getAttribute('stroke-linecap')).toBe('round')
    expect(svg.getAttribute('stroke-linejoin')).toBe('round')
    expect(svg.querySelectorAll('path')).toHaveLength(1)
    const circle = svg.querySelector('circle')!
    expect(circle.getAttribute('fill')).toBe('#ffffff')
    expect(circle.getAttribute('stroke')).toBe('none')
    expect(circle.getAttribute('cx')).toBe('12')
    expect(circle.getAttribute('cy')).toBe('10.2')
    expect(Number(circle.getAttribute('r'))).toBeCloseTo(6.5 * 7 / 16, 1)
  })

  it('PCとスマホの謎を探すボタンは同じpinを使う', () => {
    const buttons = appSource.match(/<button\b[^>]*aria-label="謎を探す"[^>]*>[\s\S]*?<\/button>/g) ?? []
    expect(buttons).toHaveLength(2)
    for (const button of buttons) {
      expect(button).toContain('<Icon name="pin" />')
      expect(button).not.toContain('<Icon name="search" />')
    }
  })

  it('searchやbookには白い中心を追加しない', () => {
    const { container } = render(<><Icon name="search" /><Icon name="book" /></>)
    expect(container.querySelectorAll('circle')).toHaveLength(0)
    expect(container.querySelectorAll('path')).toHaveLength(4)
  })
})
