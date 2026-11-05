export interface ServerConfig {
  mode: 'demo'
  port: number
  firebaseProjectId?: string
  demoLocation?: true
  demoMembershipsFile?: string
  demoDiscoveries?: true
  demoDiscoveryOwnerUid?: string
  demoAdminAssets?: true
  demoAdminPhotoTest?: true
}

export function assertDemoMode(mode: unknown, nodeEnv: string | undefined): asserts mode is 'demo' {
  if (mode !== 'demo') throw new Error('QUEST_DATA_MODE=demo must be explicitly selected; no real data adapter exists.')
  if ((nodeEnv !== undefined && nodeEnv !== 'development' && nodeEnv !== 'test') || process.env.NODE_ENV === 'production') {
    throw new Error('Demo data is restricted to development/test; production startup is not supported.')
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
  assertDemoMode(env.QUEST_DATA_MODE, env.NODE_ENV)
  assertNoAuthEmulator(env)
  const portText = env.PORT ?? '8787'
  const port = Number(portText)
  if (!/^[1-9]\d{0,4}$/.test(portText) || port > 65535) throw new Error('PORT must be an integer between 1 and 65535.')
  const config: ServerConfig = { mode: env.QUEST_DATA_MODE, port }
  if (env.QUEST_ADMIN_ASSETS_MODE !== undefined && env.QUEST_ADMIN_ASSETS_MODE !== 'off') {
    if (env.QUEST_ADMIN_ASSETS_MODE !== 'memory') throw new Error('QUEST_ADMIN_ASSETS_MODE must be off or memory.')
    config.demoAdminAssets = true
  }
  if (env.QUEST_ADMIN_PHOTO_TEST_MODE !== undefined && env.QUEST_ADMIN_PHOTO_TEST_MODE !== 'off') {
    if (env.QUEST_ADMIN_PHOTO_TEST_MODE !== 'fixtures') throw new Error('QUEST_ADMIN_PHOTO_TEST_MODE must be off or fixtures.')
    if (!config.demoAdminAssets) throw new Error('QUEST_ADMIN_PHOTO_TEST_MODE=fixtures requires QUEST_ADMIN_ASSETS_MODE=memory.')
    config.demoAdminPhotoTest = true
  }
  if (env.QUEST_DISCOVERIES_MODE !== undefined && env.QUEST_DISCOVERIES_MODE !== 'off') {
    if (env.QUEST_DISCOVERIES_MODE !== 'memory') throw new Error('QUEST_DISCOVERIES_MODE must be off or memory.')
    config.demoDiscoveries = true
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
