import { render } from '@testing-library/react'
import { expect, it } from 'vitest'
import AdminDemo from '../admin-demo/AdminDemo'
import { demoAreaLabel, demoQuest, demoQuestHints } from './demoQuest'

const notices = /デモ|実在しません|実際の訪問|訪問・撮影できる場所ではありません|合成記録です|架空の問題です/
it('keeps traveler seed copy free of demo notices', () => {
  expect(JSON.stringify([demoQuest, demoAreaLabel, demoQuestHints])).not.toMatch(notices)
})
it('keeps the initial admin form free of demo notices', () => {
  const { container } = render(<AdminDemo />)
  expect(container.textContent).not.toMatch(notices)
})
