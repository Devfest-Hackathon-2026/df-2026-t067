import { Storage } from '@google-cloud/storage'
import { applicationDefault, deleteApp, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { GoogleAuth } from 'google-auth-library'
import test from 'node:test'
import { exerciseAnswerStorage } from './cloud-storage-scenario'
import { cloudTrialTarget, requireCloudTrialLocation, verifyCloudTrialResources } from './cloud-storage-target'

test('approved cloud trial verifies real Firestore and private GCS answer storage', { timeout: 120_000 }, async (t) => {
  const location = requireCloudTrialLocation(process.env)
  const { projectId, databaseId, bucket } = cloudTrialTarget
  const auth = new GoogleAuth({ projectId, scopes: ['https://www.googleapis.com/auth/cloud-platform'] })
  let token: string | null | undefined
  try { token = await auth.getAccessToken() }
  catch { throw new Error('試験用のサーバー認証を確認してください。') }
  if (!token) throw new Error('試験用のサーバー認証を確認してください。')
  await verifyCloudTrialResources(location, 'Bearer ' + token)

  const app = initializeApp({ projectId, credential: applicationDefault() }, 'quest-storage-trial')
  const db = getFirestore(app, databaseId)
  const storage = new Storage({ projectId, retryOptions: { totalTimeout: 15 } }).bucket(bucket)
  t.after(() => deleteApp(app))
  try { await exerciseAnswerStorage(t, db, storage) }
  catch { throw new Error('合成回答の保存・本人照会・削除の検証に失敗しました。DBの索引とSDKの権限を確認してください。') }
})
