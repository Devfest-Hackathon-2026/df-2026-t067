import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { QuestQrCode } from './QuestQrCode'

describe('QuestQrCode', () => {
  it('外部へ送らず、その場でSVGのQRを描く', () => {
    render(<QuestQrCode value="https://example.test/?area=area-a&quest=quest-a" label="問題をスマートフォンで開くQRコード" />)
    const svg = screen.getByRole('img', { name: '問題をスマートフォンで開くQRコード' })
    expect(svg.tagName.toLowerCase()).toBe('svg')
    const path = svg.querySelector('path')
    expect(path?.getAttribute('d')).toMatch(/^M/)
    expect(svg.querySelector('rect')).toBeInTheDocument()
  })

  it('値が変われば模様も変わる', () => {
    const { rerender } = render(<QuestQrCode value="https://example.test/?quest=quest-a" label="QR" />)
    const first = screen.getByRole('img', { name: 'QR' }).querySelector('path')?.getAttribute('d')
    rerender(<QuestQrCode value="https://example.test/?quest=quest-b" label="QR" />)
    const second = screen.getByRole('img', { name: 'QR' }).querySelector('path')?.getAttribute('d')
    expect(first).toBeTruthy()
    expect(second).toBeTruthy()
    expect(second).not.toBe(first)
  })
})
