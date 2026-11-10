import { createHash } from 'node:crypto'
import type { Firestore, Transaction } from 'firebase-admin/firestore'
import type { AssetPurpose } from '../../src/shared/api/admin'
import { validDigest } from './firestore-answer-data'
import { HttpError } from './errors'

export type ApprovalPurpose = AssetPurpose | 'photo_test'
export const photoApprovalDigest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

export function photoApprovalId(orgId: string, purpose: ApprovalPurpose, digest: string) {
  return createHash('sha256').update(JSON.stringify([orgId, purpose, digest])).digest('hex')
}

export async function isPhotoApproved(db: Firestore, tx: Transaction, orgId: string, purpose: ApprovalPurpose, digest: unknown) {
  if (!validDigest(digest)) return false
  const approval = (await tx.get(db.collection('adminPhotoApprovals').doc(photoApprovalId(orgId, purpose, digest)))).data()
  return approval?.orgId === orgId && approval.purpose === purpose && approval.digest === digest && approval.active === true
}

export function photoApprovalRequired() {
  return new HttpError(403, 'PHOTO_APPROVAL_REQUIRED', 'この写真は指定用途で事前承認されていません。')
}
