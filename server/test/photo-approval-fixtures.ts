import type { Firestore } from 'firebase-admin/firestore'
import { photoApprovalId } from '../src/admin-photo-approvals'
import type { ApprovalPurpose } from '../src/admin-photo-approvals'

export function approveFixture(db: Firestore, orgId: string, purpose: ApprovalPurpose, digest: string) {
  return db.collection('adminPhotoApprovals').doc(photoApprovalId(orgId, purpose, digest))
    .set({ orgId, purpose, digest, active: true })
}
