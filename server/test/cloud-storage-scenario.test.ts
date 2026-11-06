import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { Storage } from '@google-cloud/storage'
import { deleteApp, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import test from 'node:test'
import { exerciseAnswerStorage } from './cloud-storage-scenario'
import { cloudTrialTarget, requireCloudTrialLocation, verifyCloudTrialResources } from './cloud-storage-target'

test('cloud storage trial rejects unapproved or emulator configuration before authenticating', () => {
  const env = { QUEST_CLOUD_TRIAL_RUN: 'approved', QUEST_CLOUD_TRIAL_LOCATION: 'asia-northeast1' }
  assert.throws(() => requireCloudTrialLocation({}))
  assert.throws(() => requireCloudTrialLocation({ ...env, QUEST_CLOUD_TRIAL_LOCATION: 'global' }))
  assert.throws(() => requireCloudTrialLocation({ ...env, FIRESTORE_EMULATOR_HOST: '127.0.0.1:8688' }))
  assert.equal(requireCloudTrialLocation(env), 'asia-northeast1')
})

test('cloud storage preflight requires a private bucket in the trial project and denied anonymous reads', async () => {
  const { projectId, databaseId, bucket } = cloudTrialTarget
  const location = 'asia-northeast1'
  const name = `projects/${projectId}/databases/${databaseId}`
  const approvedBucket = { name: bucket, location: location.toUpperCase(),
    iamConfiguration: { publicAccessPrevention: 'enforced', uniformBucketLevelAccess: { enabled: true } } }
  let bucketInfo = approvedBucket
  let anonymousStatus = 403
  const http: typeof fetch = async (url, init) => {
    const target = new URL(String(url))
    if (target.pathname.endsWith('/anonymous-access-probe')) {
      assert.equal(init?.headers, undefined)
      return new Response(null, { status: anonymousStatus })
    }
    assert.equal(new Headers(init?.headers).get('Authorization'), 'test-credential')
    if (target.hostname === 'firestore.googleapis.com') {
      assert.equal(target.pathname, '/v1/' + name)
      return Response.json({ name, locationId: location, type: 'FIRESTORE_NATIVE' })
    }
    assert.equal(target.searchParams.get('project'), projectId)
    return Response.json({ items: [bucketInfo] })
  }
  await verifyCloudTrialResources(location, 'test-credential', http)
  bucketInfo = { ...approvedBucket, iamConfiguration: { ...approvedBucket.iamConfiguration, publicAccessPrevention: 'inherited' } }
  await assert.rejects(verifyCloudTrialResources(location, 'test-credential', http), /非公開設定/)
  bucketInfo = approvedBucket
  anonymousStatus = 404
  await assert.rejects(verifyCloudTrialResources(location, 'test-credential', http), /匿名アクセス/)
})

const firestore = process.env.QUEST_FIRESTORE_TEST_HOST
const storage = process.env.QUEST_STORAGE_TEST_HOST
test('cloud storage exercise completes against the two loopback substitutes', { skip: !firestore || !storage, timeout: 30_000 }, async (t) => {
  assert(firestore && storage && [firestore, storage].every((host) =>
    /^127\.0\.0\.1:[1-9]\d{0,4}$/.test(host) && Number(host.split(':')[1]) <= 65535))
  process.env.FIRESTORE_EMULATOR_HOST = firestore
  const projectId = 'demo-t067-cloud-' + randomUUID().slice(0, 8)
  const app = initializeApp({ projectId }, projectId)
  t.after(() => deleteApp(app))
  const db = getFirestore(app)
  db.settings({ universeDomain: 'googleapis.com' })
  const name = projectId + '.appspot.com'
  const setup = await fetch(`http://${storage}/storage/v1/b?project=${projectId}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
  })
  assert.equal(setup.status, 200)
  await setup.body?.cancel()
  await exerciseAnswerStorage(t, db, new Storage({ projectId, apiEndpoint: 'http://' + storage }).bucket(name))
})
