import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MapPreview } from './MapPreview'

describe('Google map panel', () => {
  it('explains that a key is required while leaving problem browsing available', () => {
    render(<MapPreview />)
    expect(screen.getByText('Google Mapsの設定が必要です')).toBeVisible()
    expect(screen.getByText('地図を表示するには設定をご確認ください。問題の閲覧は続けられます。')).toBeVisible()
  })
  it('does not create quest markers from the currently selected sample', () => {
    render(<MapPreview />)
    expect(screen.queryByRole('button', { name: /謎を地図から見る/ })).not.toBeInTheDocument()
  })
})
