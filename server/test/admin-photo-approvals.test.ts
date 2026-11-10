import assert from 'node:assert/strict'
import test from 'node:test'
import type { Firestore, Transaction } from 'firebase-admin/firestore'
import { isPhotoApproved, photoApprovalDigest, photoApprovalId } from '../src/admin-photo-approvals'

test('approval is bound to the exact organization, purpose, and bytes and can be revoked', async () => {
  const digest = photoApprovalDigest(Buffer.from('approved photo'))
  const id = photoApprovalId('org-a', 'reference', digest)
  let approval = { orgId: 'org-a', purpose: 'reference', digest, active: true }
  const db = { collection: (name: string) => {
    assert.equal(name, 'adminPhotoApprovals')
    return { doc: (key: string) => key }
  } } as unknown as Firestore
  const tx = { get: async (key: string) => ({ data: () => key === id ? approval : undefined }) } as unknown as Transaction
  assert.equal(await isPhotoApproved(db, tx, 'org-a', 'reference', digest), true)
  assert.equal(await isPhotoApproved(db, tx, 'org-b', 'reference', digest), false)
  assert.equal(await isPhotoApproved(db, tx, 'org-a', 'public_hint', digest), false)
  assert.equal(await isPhotoApproved(db, tx, 'org-a', 'photo_test', digest), false)
  assert.equal(await isPhotoApproved(db, tx, 'org-a', 'reference', photoApprovalDigest(Buffer.from('changed photo'))), false)
  assert.equal(await isPhotoApproved(db, tx, 'org-a', 'reference', undefined), false)
  approval = { ...approval, active: false }
  assert.equal(await isPhotoApproved(db, tx, 'org-a', 'reference', digest), false)
})
