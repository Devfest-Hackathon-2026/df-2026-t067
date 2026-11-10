import type { OrgMembership } from '../../shared/api'

export function sortMemberships(items: readonly OrgMembership[]): OrgMembership[] {
  return [...items].sort((a, b) =>
    (a.prefectureCode ?? '99').localeCompare(b.prefectureCode ?? '99') ||
    (a.municipalityCode ?? '999999').localeCompare(b.municipalityCode ?? '999999') ||
    a.label.localeCompare(b.label, 'ja'),
  )
}
