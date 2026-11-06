import sharp from 'sharp'
import { preparePhoto } from './photo-input'

export const vertexTrialCases = ['match', 'mismatch', 'uncertain'] as const
export type VertexTrialCase = typeof vertexTrialCases[number]
export const vertexTrialFeatures = ['合成図形の赤い縦長の塔。三角屋根と縦に並ぶ白い窓が2つ。実在スポットではない。情報が見えない灰色一色などはuncertainとする。'] as const

// These authored vector fixtures have no real location, person or private data.
const tower = '<rect x="220" y="150" width="72" height="300" fill="#e33434"/><polygon points="200,150 312,150 256,72" fill="#ba2020"/><rect x="244" y="210" width="24" height="36" fill="white"/><rect x="244" y="310" width="24" height="36" fill="white"/>'
const bridge = '<path d="M60 320 Q256 80 452 320" fill="none" stroke="#146dd9" stroke-width="42"/><rect x="45" y="315" width="422" height="28" fill="#146dd9"/><path d="M145 260V440M367 260V440" stroke="#146dd9" stroke-width="30"/>'
const gray = '<rect width="512" height="512" fill="#999999"/>'

export function renderVertexTrialFixture(caseName: VertexTrialCase): Promise<Buffer> {
  const art = { match: tower, mismatch: bridge, uncertain: gray }[caseName]
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="white"/>${art}</svg>`)).png().toBuffer()
}

export async function prepareVertexTrialFixture(caseName: VertexTrialCase) {
  return preparePhoto({ bytes: await renderVertexTrialFixture(caseName), mimeType: 'image/png' })
}
