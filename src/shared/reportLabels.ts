import type { ReportInput } from './api/types'

export const reportCategoryLabels: Record<ReportInput['category'], string> = {
  PHOTO_UNAVAILABLE: '撮影できない',
  MATCHING_PROBLEM: '写真判定の不具合',
  UNSAFE_GUIDANCE: '危険な案内',
}
