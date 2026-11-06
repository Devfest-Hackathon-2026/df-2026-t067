export const cloudTrialTarget = {
  projectId: 'tour-513804',
  databaseId: 'quest-integration',
  bucket: 'tour-513804-quest-integration',
} as const

export function requireCloudTrialLocation(env: NodeJS.ProcessEnv): string {
  if (env.QUEST_CLOUD_TRIAL_RUN !== 'approved') throw new Error('実行前にクラウド試験の承認を確認してください。')
  const location = env.QUEST_CLOUD_TRIAL_LOCATION
  if (!location || !/^[a-z]+-[a-z]+[1-9]\d*$/.test(location)) {
    throw new Error('承認済みの単一リージョンを QUEST_CLOUD_TRIAL_LOCATION に指定してください。')
  }
  const endpointOverrides = ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST', 'STORAGE_EMULATOR_HOST', 'FIREBASE_STORAGE_EMULATOR_HOST']
  if (endpointOverrides.some((name) => env[name] !== undefined)) throw new Error('実試験の前にエミュレーター設定を外してください。')
  return location
}

export async function verifyCloudTrialResources(location: string, authorization: string, http: typeof fetch = fetch) {
  const { projectId, databaseId, bucket } = cloudTrialTarget
  const database = `projects/${projectId}/databases/${databaseId}`
  const firestore = 'https://firestore.googleapis.com/v1/' + database
  const options = { redirect: 'error', signal: AbortSignal.timeout(15_000) } as const
  const headers = { authorization, 'x-goog-user-project': projectId }
  const db = await http(firestore, { ...options, headers })
  if (!db.ok) throw new Error('試験用Firestoreを確認できません。HTTP ' + db.status)
  const dbInfo = await db.json() as { name?: string; locationId?: string; type?: string }
  if (dbInfo.name !== database || dbInfo.locationId !== location || dbInfo.type !== 'FIRESTORE_NATIVE') {
    throw new Error('Firestoreの試験DB・リージョン・モードを確認してください。')
  }

  const bucketList = new URL('https://storage.googleapis.com/storage/v1/b')
  bucketList.search = new URLSearchParams({
    project: projectId, prefix: bucket,
    fields: 'items(name,location,iamConfiguration,versioning,softDeletePolicy,retentionPolicy),nextPageToken',
  }).toString()
  const storage = await http(bucketList, { ...options, headers })
  if (!storage.ok) throw new Error('試験用バケットを確認できません。HTTP ' + storage.status)
  const body = await storage.json() as { items?: Array<{
    name?: string; location?: string
    iamConfiguration?: { publicAccessPrevention?: string; uniformBucketLevelAccess?: { enabled?: boolean } }
    versioning?: { enabled?: boolean }; softDeletePolicy?: { retentionDurationSeconds?: string }
    retentionPolicy?: unknown
  }> }
  const found = body.items?.find((item) => item.name === bucket)
  if (!found || found.location?.toLowerCase() !== location ||
    found.iamConfiguration?.publicAccessPrevention !== 'enforced' ||
    found.iamConfiguration.uniformBucketLevelAccess?.enabled !== true ||
    found.versioning?.enabled === true || found.retentionPolicy !== undefined ||
    ![undefined, '0'].includes(found.softDeletePolicy?.retentionDurationSeconds)) {
    throw new Error('試験用バケットの所属、リージョン、非公開設定と削除設定を確認してください。')
  }

  const anonymous = await http(firestore + '/documents/quests/anonymous-access-probe', options)
  await anonymous.body?.cancel()
  if (anonymous.status !== 403) throw new Error('Firestoreの匿名アクセス拒否を確認できません。')
}
