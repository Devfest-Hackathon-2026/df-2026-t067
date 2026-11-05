import { randomUUID } from 'node:crypto'
import type { ManagedReport, ReportInput, ReportReceipt } from '../../src/shared/api/types'
import { HttpError } from './errors'
import { paginate } from './query'

export class DemoReportStore {
  private readonly reports = new Map<string, ManagedReport>()
  private readonly countByReporter = new Map<string, number>()

  submit(uid: string, key: string, input: ReportInput, target: Pick<ManagedReport, 'orgId' | 'questVersion'>): ReportReceipt {
    const index = JSON.stringify([uid, key])
    const previous = this.reports.get(index)
    if (previous) {
      if (previous.questId !== input.questId || previous.category !== input.category || previous.text !== input.text) {
        throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', '同じ報告キーで異なる内容は送信できません。')
      }
      return { reportId: previous.reportId, source: previous.source }
    }
    const count = this.countByReporter.get(uid) ?? 0
    if (this.reports.size >= 256 || count >= 10) throw new HttpError(429, 'RATE_LIMITED', '開発用の報告上限に達しました。')
    const receipt = { reportId: randomUUID(), source: 'mock' as const }
    this.reports.set(index, { ...input, ...target, ...receipt, receivedAt: new Date().toISOString() })
    this.countByReporter.set(uid, count + 1)
    return receipt
  }

  list(orgId: string, params: URLSearchParams) {
    const items = [...this.reports.values()].filter((report) => report.orgId === orgId).reverse()
    return paginate(items, params, 'reports:' + orgId, (report) => report.reportId)
  }
}
