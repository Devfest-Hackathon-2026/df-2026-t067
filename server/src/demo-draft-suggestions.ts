import type { ManagedQuestDraft } from '../../src/shared/api/admin'
import { syntheticPng } from './demo-photo-test'
import { preparePhoto } from './photo-input'

export type FixtureDraftSuggester = (reference: Buffer) => ManagedQuestDraft['content'] | null

export async function createFixtureDraftSuggester(): Promise<FixtureDraftSuggester> {
  const fixture = await preparePhoto({ bytes: syntheticPng, mimeType: 'image/png' })
  return (reference) => reference.equals(fixture.bytes) ? {
    title: '合成画像の色を探す',
    question: '色の異なる画素が並ぶ、開発用の合成画像を探そう。',
    hints: ['小さな画像を見てみよう。', '画素は縦横2個ずつ並んでいる。', '色の違いを比べてみよう。'],
    verifiedFeatures: '縦横2個ずつの画素\n色の異なる画素が並ぶ',
    draftingNotes: '開発用の合成素材に対応する固定の候補です。AIは使っていません。',
  } : null
}
