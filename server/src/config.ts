import { isAbsolute } from 'node:path'

interface DemoServerConfig {
  mode: 'demo'
  port: number
  firebaseProjectId?: string
  demoLocation?: true
  demoMembershipsFile?: string
  demoDiscoveries?: true
  demoDiscoveryOwnerUid?: string
  demoAdminAssets?: true
  demoAdminPhotoTest?: true
  demoDraftSuggestions?: true
  demoReports?: true
}

export interface DurableLocalConfig {
  mode: 'durable-local'
  port: number
  firebaseProjectId: string
  storageEndpoint: string
  vertexTrialLedger?: string
  vertexDraftTrialLedger?: string
}

export const teamPreviewDatabase = 'quest-team-preview'

export interface TeamPreviewConfig {
  mode: 'team-preview'
  port: number
  firebaseProjectId: string
  projectNumber: string
  allowedUids: ReadonlySet<string>
  answerTrial: boolean
}

type ServerConfig = DemoServerConfig | DurableLocalConfig | TeamPreviewConfig

export function assertDemoMode(mode: unknown, nodeEnv: string | undefined): asserts mode is 'demo' {
  if (mode !== 'demo') throw new Error('QUEST_DATA_MODE must be explicitly selected as demo, durable-local, or team-preview.')
  assertLocalEnvironment(nodeEnv)
}

function assertLocalEnvironment(nodeEnv: string | undefined): void {
  if ((nodeEnv !== undefined && nodeEnv !== 'development' && nodeEnv !== 'test') || process.env.NODE_ENV === 'production') {
    throw new Error('Local data is restricted to development/test; production startup is not supported.')
  }
}

export function assertNoAuthEmulator(env: NodeJS.ProcessEnv): void {
  if (env.FIREBASE_AUTH_EMULATOR_HOST !== undefined) {
    throw new Error('FIREBASE_AUTH_EMULATOR_HOST is not supported: signed Firebase ID tokens are required.')
  }
}

export function assertProjectId(projectId: string): void {
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId)) {
    throw new Error('FIREBASE_PROJECT_ID must be a valid project ID.')
  }
}

export function readConfig(env: NodeJS.ProcessEnv): ServerConfig {
  const mode = env.QUEST_DATA_MODE
  if (mode === 'durable-local') assertLocalEnvironment(env.NODE_ENV)
  else if (mode !== 'team-preview') assertDemoMode(mode, env.NODE_ENV)
  assertNoAuthEmulator(env)
  const portText = env.PORT ?? '8787'
  const port = Number(portText)
  if (!/^[1-9]\d{0,4}$/.test(portText) || port > 65535) throw new Error('PORT must be an integer between 1 and 65535.')
  if (mode === 'team-preview') return readTeamPreviewConfig(env, port)
  if (mode === 'durable-local') return readDurableLocalConfig(env, port)
  if (env.QUEST_DURABLE_PHOTO_MATCHER !== undefined) {
    throw new Error('QUEST_DURABLE_PHOTO_MATCHER requires QUEST_DATA_MODE=durable-local.')
  }
  if (env.QUEST_DURABLE_DRAFT_GENERATOR !== undefined) {
    throw new Error('QUEST_DURABLE_DRAFT_GENERATOR requires QUEST_DATA_MODE=durable-local.')
  }
  const config: DemoServerConfig = { mode, port }
  if (env.QUEST_ADMIN_ASSETS_MODE !== undefined && env.QUEST_ADMIN_ASSETS_MODE !== 'off') {
    if (env.QUEST_ADMIN_ASSETS_MODE !== 'memory') throw new Error('QUEST_ADMIN_ASSETS_MODE must be off or memory.')
    config.demoAdminAssets = true
  }
  if (env.QUEST_ADMIN_PHOTO_TEST_MODE !== undefined && env.QUEST_ADMIN_PHOTO_TEST_MODE !== 'off') {
    if (env.QUEST_ADMIN_PHOTO_TEST_MODE !== 'fixtures') throw new Error('QUEST_ADMIN_PHOTO_TEST_MODE must be off or fixtures.')
    if (!config.demoAdminAssets) throw new Error('QUEST_ADMIN_PHOTO_TEST_MODE=fixtures requires QUEST_ADMIN_ASSETS_MODE=memory.')
    config.demoAdminPhotoTest = true
  }
  if (env.QUEST_ADMIN_DRAFT_MODE !== undefined && env.QUEST_ADMIN_DRAFT_MODE !== 'off') {
    if (env.QUEST_ADMIN_DRAFT_MODE !== 'fixtures') throw new Error('QUEST_ADMIN_DRAFT_MODE must be off or fixtures.')
    if (!config.demoAdminAssets) throw new Error('QUEST_ADMIN_DRAFT_MODE=fixtures requires QUEST_ADMIN_ASSETS_MODE=memory.')
    config.demoDraftSuggestions = true
  }
  if (env.QUEST_DISCOVERIES_MODE !== undefined && env.QUEST_DISCOVERIES_MODE !== 'off') {
    if (env.QUEST_DISCOVERIES_MODE !== 'memory') throw new Error('QUEST_DISCOVERIES_MODE must be off or memory.')
    config.demoDiscoveries = true
  }
  if (env.QUEST_REPORTS_MODE !== undefined && env.QUEST_REPORTS_MODE !== 'off') {
    if (env.QUEST_REPORTS_MODE !== 'memory') throw new Error('QUEST_REPORTS_MODE must be off or memory.')
    config.demoReports = true
  }
  if (env.QUEST_DEMO_DISCOVERY_OWNER_UID !== undefined) {
    const uid = env.QUEST_DEMO_DISCOVERY_OWNER_UID
    if (!config.demoDiscoveries) throw new Error('QUEST_DEMO_DISCOVERY_OWNER_UID requires QUEST_DISCOVERIES_MODE=memory.')
    if (!uid || uid !== uid.trim() || uid.length > 128 || Array.from(uid).some((char) => {
      const code = char.charCodeAt(0)
      return code < 32 || code === 127
    })) throw new Error('QUEST_DEMO_DISCOVERY_OWNER_UID must be a valid local UID.')
    config.demoDiscoveryOwnerUid = uid
  }
  if (env.QUEST_LOCATION_MODE !== undefined && env.QUEST_LOCATION_MODE !== 'off') {
    if (env.QUEST_LOCATION_MODE !== 'demo') throw new Error('QUEST_LOCATION_MODE must be off or demo.')
    config.demoLocation = true
  }
  if (env.QUEST_DEMO_MEMBERSHIPS_FILE !== undefined) {
    const file = env.QUEST_DEMO_MEMBERSHIPS_FILE
    if (!file.startsWith('/') || file.length > 4096 || Array.from(file).some((char) => char.charCodeAt(0) < 32)) {
      throw new Error('QUEST_DEMO_MEMBERSHIPS_FILE must be an absolute local file path.')
    }
    config.demoMembershipsFile = file
  }
  if (env.FIREBASE_PROJECT_ID !== undefined) {
    assertProjectId(env.FIREBASE_PROJECT_ID)
    config.firebaseProjectId = env.FIREBASE_PROJECT_ID
  }
  return config
}

function readTeamPreviewConfig(env: NodeJS.ProcessEnv, port: number): TeamPreviewConfig {
  if (env.NODE_ENV !== 'production') throw new Error('team-preview requires NODE_ENV=production.')
  for (const name of ['FIRESTORE_EMULATOR_HOST', 'STORAGE_EMULATOR_HOST', 'FIREBASE_STORAGE_EMULATOR_HOST',
    'QUEST_DURABLE_STORAGE_ENDPOINT', 'QUEST_DURABLE_PHOTO_MATCHER', 'QUEST_DURABLE_DRAFT_GENERATOR', 'QUEST_VERTEX_TRIAL_LEDGER']) {
    if (env[name] !== undefined) throw new Error(name + ' is not supported in team-preview.')
  }
  const firebaseProjectId = env.FIREBASE_PROJECT_ID ?? ''
  assertProjectId(firebaseProjectId)
  const projectNumber = env.QUEST_TEAM_PROJECT_NUMBER ?? ''
  if (!/^[1-9]\d{5,19}$/.test(projectNumber)) throw new Error('QUEST_TEAM_PROJECT_NUMBER must identify the approved project.')
  const uids = (env.QUEST_TEAM_UIDS ?? '').split(',').map((uid) => uid.trim())
  const allowedUids = new Set(uids)
  if (uids.length !== 4 || allowedUids.size !== 4 || uids.some((uid) => !/^[A-Za-z0-9_-]{1,128}$/.test(uid))) {
    throw new Error('QUEST_TEAM_UIDS must contain four distinct Firebase user IDs.')
  }
  // The answer trial is opt-in per deployment. Any other value fails closed
  // at startup instead of silently leaving real photo matching disabled.
  if (env.QUEST_TEAM_ANSWER_TRIAL !== undefined && env.QUEST_TEAM_ANSWER_TRIAL !== 'vertex-trial') {
    throw new Error('QUEST_TEAM_ANSWER_TRIAL must be vertex-trial when set.')
  }
  return { mode: 'team-preview', port, firebaseProjectId, projectNumber, allowedUids,
    answerTrial: env.QUEST_TEAM_ANSWER_TRIAL === 'vertex-trial' }
}

function readDurableLocalConfig(env: NodeJS.ProcessEnv, port: number): DurableLocalConfig {
  const firebaseProjectId = env.FIREBASE_PROJECT_ID
  if (!firebaseProjectId) throw new Error('FIREBASE_PROJECT_ID is required for durable-local.')
  assertProjectId(firebaseProjectId)
  if (!isLoopbackHost(env.FIRESTORE_EMULATOR_HOST)) {
    throw new Error('FIRESTORE_EMULATOR_HOST must be 127.0.0.1 with an explicit port.')
  }
  const storageEndpoint = env.QUEST_DURABLE_STORAGE_ENDPOINT
  if (!storageEndpoint?.startsWith('http://') || !isLoopbackHost(storageEndpoint.slice('http://'.length))) {
    throw new Error('QUEST_DURABLE_STORAGE_ENDPOINT must be http://127.0.0.1 with an explicit port.')
  }
  if (env.STORAGE_EMULATOR_HOST !== undefined || env.FIREBASE_STORAGE_EMULATOR_HOST !== undefined) {
    throw new Error('Unset STORAGE_EMULATOR_HOST and FIREBASE_STORAGE_EMULATOR_HOST for durable-local.')
  }
  const config: DurableLocalConfig = { mode: 'durable-local', port, firebaseProjectId, storageEndpoint }
  const matcher = env.QUEST_DURABLE_PHOTO_MATCHER ?? 'fixtures'
  const generator = env.QUEST_DURABLE_DRAFT_GENERATOR ?? 'fixtures'
  if (matcher !== 'fixtures' && matcher !== 'vertex-trial') throw new Error('QUEST_DURABLE_PHOTO_MATCHER must be fixtures or vertex-trial.')
  if (generator !== 'fixtures' && generator !== 'vertex-trial') throw new Error('QUEST_DURABLE_DRAFT_GENERATOR must be fixtures or vertex-trial.')
  if (matcher === 'fixtures' && generator === 'fixtures') return config
  if (env.NODE_ENV !== 'development') throw new Error('The Vertex trial requires NODE_ENV=development.')
  const file = env.QUEST_VERTEX_TRIAL_LEDGER
  if (!file || !isAbsolute(file) || file.length > 4000 || Array.from(file).some((char) => char.charCodeAt(0) < 32)) {
    throw new Error('QUEST_VERTEX_TRIAL_LEDGER must be the absolute path to the shared trial ledger.')
  }
  if (matcher === 'vertex-trial') config.vertexTrialLedger = file
  if (generator === 'vertex-trial') config.vertexDraftTrialLedger = file
  return config
}

function isLoopbackHost(host: string | undefined): boolean {
  const port = /^127\.0\.0\.1:([1-9]\d{0,4})$/.exec(host ?? '')?.[1]
  return port !== undefined && Number(port) <= 65535
}
