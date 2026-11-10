import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Icon } from './Icon'

describe('rounded icons (t162u)', () => {
  it('uses round stroke caps/joins and a consistent stroke width', () => {
    const { container } = render(<><Icon name="panel" /><Icon name="locate" /><Icon name="search" /><Icon name="book" /></>)
    const svgs = container.querySelectorAll('svg.icon')
    expect(svgs.length).toBe(4)
    for (const svg of svgs) {
      expect(svg.getAttribute('stroke-linecap') ?? svg.getAttribute('strokeLinecap')).toBeTruthy()
      expect(svg.getAttribute('stroke-linejoin') ?? svg.getAttribute('strokeLinejoin')).toBeTruthy()
      // React DOM uses camelCase attributes reflected lowercase in HTML
      expect((svg as SVGElement).getAttribute('stroke-linecap')).toBe('round')
      expect((svg as SVGElement).getAttribute('stroke-linejoin')).toBe('round')
      expect((svg as SVGElement).getAttribute('stroke-width')).toBe('1.8')
    }
  })

  it('draws the sidebar panel control with a rounded rectangle instead of sharp corners', () => {
    const { container } = render(<Icon name="panel" />)
    const d = container.querySelector('path')?.getAttribute('d') ?? ''
    expect(d).toContain('1.6') // corner radius in path
    expect(d).not.toMatch(/M4 5h16v14H4z/)
  })
})
