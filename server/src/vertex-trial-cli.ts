import sharp from 'sharp'
import { preparePhoto } from './photo-input'
import { createVertexPhotoMatcher } from './vertex-match'
import { createVertexTrialTransport } from './vertex-transport'
import { initializeTrialLedger } from './vertex-trial-ledger'

// These authored vector fixtures have no real location, person or private data.
export async function syntheticTrialInput(caseName: 'match' | 'mismatch' | 'uncertain') {
  const tower = '<rect x="220" y="150" width="72" height="300" fill="#e33434"/><polygon points="200,150 312,150 256,72" fill="#ba2020"/><rect x="244" y="210" width="24" height="36" fill="white"/><rect x="244" y="310" width="24" height="36" fill="white"/>'
  const bridge = '<path d="M60 320 Q256 80 452 320" fill="none" stroke="#146dd9" stroke-width="42"/><rect x="45" y="315" width="422" height="28" fill="#146dd9"/><path d="M145 260V440M367 260V440" stroke="#146dd9" stroke-width="30"/>'
  const body = caseName === 'mismatch' ? bridge : caseName === 'uncertain' ? '<rect width="512" height="512" fill="#999999"/>' : tower
  const render = async (art: string) => sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="white"/>${art}</svg>`)).png().toBuffer()
  const reference = await preparePhoto({ bytes: await render(tower), mimeType: 'image/png' })
  const candidate = await preparePhoto({ bytes: await render(body), mimeType: 'image/png' })
  return { reference, candidate, features: ['合成図形の赤い縦長の塔。三角屋根と縦に並ぶ白い窓が2つ。実在スポットではない。情報が見えない灰色一色などはuncertainとする。'] }
}

export async function runVertexTrial(args: readonly string[], env: NodeJS.ProcessEnv = process.env): Promise<Record<string, unknown>> {
  const file = env.QUEST_VERTEX_TRIAL_LEDGER
  const command = args[0]
  if (env.NODE_ENV !== 'development' || !file?.startsWith('/') || args.length !== 1 ||
    !['init', 'match', 'mismatch', 'uncertain'].includes(command)) throw new Error('invalid trial configuration')
  if (command === 'init') {
    // Latest confirmed campaign total: initial text 1 + image attempts 4.
    // The existing shared ledger remains authoritative; never reinitialize it.
    await initializeTrialLedger(file, 5)
    return { source: 'vertex-trial', status: 'initialized', used: 5, limit: 20 }
  }
  const controller = new AbortController()
  const abort = () => controller.abort()
  process.once('SIGINT', abort); process.once('SIGTERM', abort)
  try {
    const matcher = createVertexPhotoMatcher(createVertexTrialTransport(file))
    const decision = await matcher(await syntheticTrialInput(command as 'match' | 'mismatch' | 'uncertain'), { signal: controller.signal })
    return { source: 'vertex-trial', fixture: command, model: 'gemini-3.8-flash', decision }
  } finally { process.removeListener('SIGINT', abort); process.removeListener('SIGTERM', abort) }
}

if (require.main === module) {
  runVertexTrial(process.argv.slice(2)).then((result) => process.stdout.write(JSON.stringify(result) + '\n')).catch(() => {
    process.stderr.write('試験を完了できませんでした。設定・認証・台帳の上限とロックを確認してください。自動再試行はしません。\n')
    process.exitCode = 1
  })
}
