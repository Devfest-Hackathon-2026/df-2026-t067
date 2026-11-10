import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ClearCelebration } from './ClearCelebration'

// 装飾のみの演出（D-42）。結果の文言は呼び出し側の status 表示が担うため、
// ここではバッジときらめきの有無だけを見る。
describe('ClearCelebration', () => {
  it('renders the badge and the sparks as hidden decoration', () => {
    const { container } = render(<ClearCelebration />)
    const root = container.querySelector('.clear-celebration')
    expect(root).toHaveAttribute('aria-hidden', 'true')
    expect(container.querySelector('.clear-celebration-badge')).toBeInTheDocument()
    expect(container.querySelectorAll('.clear-celebration-spark')).toHaveLength(6)
  })
})
