import type { Server } from 'node:http'
import { createFileMembershipLookup } from './admin-memberships'
import { readConfig } from './config'
import { createDurableLocalRuntime } from './durable-local'
import { createFirebaseVerifier } from './firebase-auth'
import { createServer } from './server'
import { DemoDiscoveryStore } from './discoveries'
import { DemoAssetStore } from './admin-assets'
import { createFixturePhotoMatcher } from './demo-photo-test'
import { createFixtureDraftSuggester } from './demo-draft-suggestions'

type DemoConfig = Extract<ReturnType<typeof readConfig>, { mode: 'demo' }>
interface Runtime {
  server: Server
  close(): Promise<void>
  stopMaintenance?(): Promise<void>
  label: string
}

async function createDemoRuntime(config: DemoConfig) {
  const matcher = config.demoAdminPhotoTest ? await createFixturePhotoMatcher() : undefined
  const suggestDraft = config.demoDraftSuggestions ? await createFixtureDraftSuggester() : undefined
  const discoveries = config.demoDiscoveryOwnerUid ? await DemoDiscoveryStore.withFixture(config.demoDiscoveryOwnerUid)
    : config.demoDiscoveries ? new DemoDiscoveryStore() : undefined
  const verifier = config.firebaseProjectId ? createFirebaseVerifier(config.firebaseProjectId) : undefined
  const server = createServer({ mode: config.mode, verifier,
    memberships: config.demoMembershipsFile ? createFileMembershipLookup(config.demoMembershipsFile) : undefined,
    discoveries,
    adminAssets: config.demoAdminAssets ? new DemoAssetStore() : undefined,
    adminPhotoTest: matcher ? { matcher } : undefined,
    suggestDraft,
    demoReports: config.demoReports,
    locationValidation: config.demoLocation ? 'demo' : undefined })
  const label = 'FICTIONAL DEMO DATA; auth ' + (verifier ? 'configured' : 'unconfigured') +
    '; GPS demo ' + (config.demoLocation ? 'enabled' : 'off') +
    '; admin photo test ' + (matcher ? 'fixtures' : 'off') +
    '; admin draft ' + (suggestDraft ? 'fixtures' : 'off') +
    '; discovery fixture ' + (config.demoDiscoveryOwnerUid ? 'enabled' : 'off')
  return { server, close: async () => { await verifier?.close() }, label }
}

async function main(): Promise<void> {
  const config = readConfig(process.env)
  const runtime: Runtime = config.mode === 'durable-local' ? await createDurableLocalRuntime(config) : await createDemoRuntime(config)
  const { server } = runtime
  let stopping = false
  const stop = () => {
    if (stopping) return
    stopping = true
    const maintenance = runtime.stopMaintenance?.()
    const deadline = setTimeout(() => server.closeAllConnections(), 5_000)
    deadline.unref()
    server.close(() => {
      clearTimeout(deadline)
      void Promise.resolve(maintenance).then(runtime.close).catch(() => { process.exitCode = 1 })
    })
  }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  server.once('error', () => {
    // Do not log SDK error objects, configuration values, headers, or tokens.
    console.error('Local API failed to listen; check the port.')
    process.exitCode = 1
    stop()
  })
  server.listen(config.port, '127.0.0.1', () => {
    console.info('Local API: http://127.0.0.1:' + config.port + ' (' + runtime.label + ')')
  })
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    // Configuration errors contain names/constraints only, never supplied values.
    console.error(error instanceof Error ? error.message : 'Local API startup failed.')
    process.exitCode = 1
  })
}
