import { createHash } from 'node:crypto'
import type { DocumentSnapshot, Firestore, Transaction } from 'firebase-admin/firestore'
import { parseOrgMembership } from '../../src/shared/api/admin'
import type { OrgMembership } from '../../src/shared/api/admin'
import { HttpError } from './errors'
import { answerTransaction, processingError } from './firestore-answer-data'

function memberId(uid: string, orgId: string): string {
  return createHash('sha256').update(JSON.stringify([uid, orgId])).digest('hex')
}

function readMember(snapshot: DocumentSnapshot, uid: string) {
  const member = snapshot.data()
  if (member?.active !== true || member.uid !== uid || typeof member.orgId !== 'string' ||
    snapshot.id !== memberId(uid, member.orgId) || (member.role !== 'editor' && member.role !== 'publisher')) return null
  return parseOrgMembership({ orgId: member.orgId, role: member.role, label: member.label, areaId: member.areaId })
}

export async function requireOrgMember(db: Firestore, tx: Transaction, uid: string, orgId: string) {
  const member = readMember(await tx.get(db.collection('memberships').doc(memberId(uid, orgId))), uid)
  if (!member || member.orgId !== orgId) throw new HttpError(403, 'FORBIDDEN', 'この自治体の操作権限がありません。')
  return member
}

export function requirePublisher(member: OrgMembership): void {
  if (member.role !== 'publisher') throw new HttpError(403, 'FORBIDDEN', '公開担当者の権限が必要です。')
}

export function listOrgMemberships(db: Firestore, uid: string) {
  return answerTransaction(db, async (tx) => {
    const rows = await tx.get(db.collection('memberships').where('uid', '==', uid).where('active', '==', true).limit(201))
    if (rows.size > 200) throw processingError()
    return rows.docs.flatMap((row) => {
      const member = readMember(row, uid)
      return member ? [member] : []
    }).sort((first, second) => first.orgId.localeCompare(second.orgId))
  }, true)
}
