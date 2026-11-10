import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ClearCelebration } from './ClearCelebration'

// Motion の reduced-motion 判定はモジュール単位で初回に固定されるため、
// 減らした動きのケースは専用ファイルで matchMedia を先に差して検証する。
describe('ClearCelebration with prefers-reduced-motion', () => {
  it('keeps only a gentle badge fade and drops the sparks', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('prefers-reduced-motion'),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
    const { container } = render(<ClearCelebration />)
    expect(container.querySelector('.clear-celebration-badge')).toBeInTheDocument()
    expect(container.querySelectorAll('.clear-celebration-spark')).toHaveLength(0)
  })
})
