import { createHash } from 'node:crypto'
import type { DocumentSnapshot, Firestore, Transaction } from 'firebase-admin/firestore'
import { parseOrgMembership } from '../../src/shared/api/admin'
import type { OrgMembership } from '../../src/shared/api/admin'
import { HttpError } from './errors'
import { answerTransaction, processingError } from './firestore-answer-data'
import { areaPrefectureCode, readMunicipalArea } from './municipal-areas'

function memberId(uid: string, orgId: string): string {
  return createHash('sha256').update(JSON.stringify([uid, orgId])).digest('hex')
}

function readMember(snapshot: DocumentSnapshot, uid: string) {
  const member = snapshot.data()
  if (member?.active !== true || member.uid !== uid || typeof member.orgId !== 'string' ||
    snapshot.id !== memberId(uid, member.orgId) || (member.role !== 'editor' && member.role !== 'publisher')) return null
  return parseOrgMembership({ orgId: member.orgId, role: member.role, label: member.label, areaId: member.areaId,
    ...(member.municipalityCode === undefined ? {} : { municipalityCode: member.municipalityCode }) })
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
    const members = rows.docs.flatMap((row) => {
      const member = readMember(row, uid)
      return member ? [member] : []
    }).sort((first, second) => first.orgId.localeCompare(second.orgId))
    const areaIds = [...new Set(members.map((member) => member.areaId))]
    if (!areaIds.length) return members
    const areas = await tx.getAll(...areaIds.map((id) => db.collection('areas').doc(id)))
    const byId = new Map(areas.map((area) => [area.id, area]))
    return members.map((member): OrgMembership => {
      const area = byId.get(member.areaId)
      const found = readMunicipalArea(area ? { id: area.id, data: area.data() } : null, member)
      // 地域の都道府県コードを所属にも載せ、管理画面が未分類（D-33）かどうかを表示できるようにする。
      const prefectureCode = area ? areaPrefectureCode(area.data()) : undefined
      return { ...member, ...(prefectureCode ? { prefectureCode } : {}),
        exploration: found ? { name: found.area.label, ...found.boundary } : { source: 'unavailable' } }
    })
  }, true)
}
