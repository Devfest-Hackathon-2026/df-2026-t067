import assert from 'node:assert/strict'
import test from 'node:test'
import { createDemoData } from '../src/demo-data'
import { DemoDiscoveryStore } from '../src/discoveries'
import { projectManagedQuest } from '../src/admin-publication'
import type { ManagedQuest } from '../../src/shared/api/admin'

const notices = /デモ|実在しません|実際の訪問|合成記録です|架空の.*です|現地へ移動しないでください/
test('public seed data and all ordinary hints contain no demo notices', () => {
  const { areas, quests, hints } = createDemoData()
  assert.doesNotMatch(JSON.stringify([areas, quests, [...hints.values()]]), notices)
})
test('owner fixture records contain no demo notices', async () => {
  const store = await DemoDiscoveryStore.withFixture('owner')
  assert.doesNotMatch(JSON.stringify(await store.listOwned('owner', {})), notices)
})
test('publication shared by local and team preview omits empty conditions and preserves real restrictions', () => {
  const quest: ManagedQuest = {
  questId: 'quest-a', orgId: 'org-a', areaId: 'area-a', draftRevision: 2, publishedVersion: null,
  status: 'review_pending', shootingAreaStatus: 'configured', source: 'mock',
  draft: {
    materials: { name: '内部対象', evidence: '確認済み', price: '', photoNote: '', photoRights: '合成',
      requiresBoat: false, requiresPaidFacility: false },
    content: { title: '問題', question: '問題文', hints: ['ヒント1', 'ヒント2', 'ヒント3'],
      verifiedFeatures: '特徴', draftingNotes: '' },
    afterClear: { access: '', hours: '', promoComment: '', explanation: '' },
    referenceAssetId: 'reference-a', hintAssetId: 'legacy-hint',
  },
}
  assert.equal(projectManagedQuest(quest, 1).quest.visitConditions, '')
  quest.draft.materials.requiresBoat = true
  quest.draft.materials.price = '500円'
  quest.draft.materials.photoNote = '通行を妨げないでください。'
  const visible = projectManagedQuest(quest, 1)
  assert.doesNotMatch(JSON.stringify(visible), notices)
  assert.equal(visible.quest.shootingConditions?.requiresBoat, true)
  assert.doesNotMatch(visible.quest.visitConditions, /船上・海上/)
  assert.match(visible.quest.visitConditions, /500円/)
  assert.doesNotMatch(visible.quest.visitConditions, /注意|通行を妨げない/)
})
