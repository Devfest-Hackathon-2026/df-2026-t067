import { createVertexPhotoMatcher } from './vertex-match'
import { prepareVertexTrialFixture, vertexTrialFeatures } from './vertex-trial-fixtures'
import type { VertexTrialCase } from './vertex-trial-fixtures'
import { createVertexTrialTransport } from './vertex-transport'
import { initializeTrialLedger } from './vertex-trial-ledger'

export async function syntheticTrialInput(caseName: VertexTrialCase) {
  const [reference, candidate] = await Promise.all([prepareVertexTrialFixture('match'), prepareVertexTrialFixture(caseName)])
  return { reference, candidate, features: vertexTrialFeatures }
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
    return { source: 'vertex-trial', status: 'initialized', used: 5, limit: 50 }
  }
  const controller = new AbortController()
  const abort = () => controller.abort()
  process.once('SIGINT', abort); process.once('SIGTERM', abort)
  try {
    const matcher = createVertexPhotoMatcher(createVertexTrialTransport(file))
    const decision = await matcher(await syntheticTrialInput(command as VertexTrialCase), { signal: controller.signal })
    return { source: 'vertex-trial', fixture: command, model: 'gemini-3.8-flash', decision }
  } finally { process.removeListener('SIGINT', abort); process.removeListener('SIGTERM', abort) }
}

if (require.main === module) {
  runVertexTrial(process.argv.slice(2)).then((result) => process.stdout.write(JSON.stringify(result) + '\n')).catch(() => {
    process.stderr.write('試験を完了できませんでした。設定・認証・台帳の上限とロックを確認してください。自動再試行はしません。\n')
    process.exitCode = 1
  })
}
