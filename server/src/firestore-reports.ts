import { createHash } from 'node:crypto'
import type { DocumentSnapshot, Firestore, Transaction } from 'firebase-admin/firestore'
import type { ReportInput, ReportReceipt } from '../../src/shared/api/types'
import { parseManagedReport } from '../../src/shared/api/validation'
import { HttpError } from './errors'
import { answerTransaction, notFound, processingError, storedId } from './firestore-answer-data'
import { requireOrgMember, requirePublisher } from './firestore-org-memberships'

const maxReports = 256
const maxPerReporter = 10

export class FirestoreReportStore {
  constructor(private readonly db: Firestore) {}

  submit(uid: string, key: string, input: ReportInput): Promise<ReportReceipt> {
    const reports = this.db.collection('managedReports')
    const reportId = hash([uid, key])
    const ref = reports.doc(reportId)
    return answerTransaction(this.db, async (tx) => {
      const previous = await tx.get(ref)
      const receipt = { reportId, source: 'real' as const }
      if (previous.exists) {
        const saved = readReport(previous)
        if (saved.questId !== input.questId || saved.category !== input.category || saved.text !== input.text) {
          throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', '同じ報告キーで異なる内容は送信できません。')
        }
        return receipt
      }

      const target = await this.readTarget(tx, input.questId)
      const usage = this.db.collection('managedReportUsage')
      const [all, byReporter] = await tx.getAll(usage.doc('global'), usage.doc(hash([uid])))
      const total = reportCount(all), reported = reportCount(byReporter)
      if (total >= maxReports || reported >= maxPerReporter) {
        throw new HttpError(429, 'RATE_LIMITED', '開発用の報告上限に達しました。')
      }
      tx.create(ref, { ...input, ...target, ...receipt, receivedAt: previous.readTime.toDate().toISOString() })
      tx.set(all.ref, { count: total + 1 })
      tx.set(byReporter.ref, { count: reported + 1 })
      return receipt
    })
  }

  list(uid: string, orgId: string) {
    return answerTransaction(this.db, async (tx) => {
      requirePublisher(await requireOrgMember(this.db, tx, uid, orgId))
      const reports = await tx.get(this.db.collection('managedReports').where('orgId', '==', orgId).limit(maxReports + 1))
      if (reports.size > maxReports) throw processingError()
      return reports.docs.map(readReport).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt) || a.reportId.localeCompare(b.reportId))
    }, true)
  }

  private async readTarget(tx: Transaction, questId: string) {
    const quest = (await tx.get(this.db.collection('quests').doc(questId))).data()
    if (!quest) throw notFound()
    const questVersion: unknown = quest.publishedVersion ?? (typeof quest.pauseReason === 'string' ? quest.latestPublishedVersion : null)
    if (questVersion == null) throw notFound()
    if (typeof questVersion !== 'number' || !Number.isSafeInteger(questVersion) || questVersion < 1) throw processingError()
    const version = await tx.get(this.db.collection('questVersions').doc(questId + ':' + questVersion))
    if (!version.exists) throw processingError()
    return { orgId: storedId(quest.orgId), questVersion }
  }
}

function readReport(snapshot: DocumentSnapshot) {
  const report = parseManagedReport(snapshot.data())
  if (report.reportId !== snapshot.id || report.source !== 'real') throw processingError()
  return report
}

function reportCount(snapshot: DocumentSnapshot): number {
  const count: unknown = snapshot.exists ? snapshot.get('count') : 0
  if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) throw processingError()
  return count
}

function hash(parts: string[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex')
}
