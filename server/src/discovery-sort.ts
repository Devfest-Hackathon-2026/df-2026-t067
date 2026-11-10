import { invalidInput } from './errors'

export type DiscoverySort = 'cleared-desc' | 'cleared-asc' | 'prefecture-asc' | 'prefecture-desc'

export function parseDiscoverySort(value: unknown): DiscoverySort {
  if (value === undefined) return 'cleared-desc'
  if (value === 'cleared-desc' || value === 'cleared-asc' || value === 'prefecture-asc' || value === 'prefecture-desc') return value
  return invalidInput()
}

export interface DiscoveryPosition {
  prefectureCode?: string
  seconds: number
  nanoseconds: number
  id: string
}

// Negative means a precedes b. Unknown prefectures always follow known ones.
export function compareDiscoveryPosition(sort: DiscoverySort, a: DiscoveryPosition, b: DiscoveryPosition): number {
  if (sort.startsWith('prefecture-')) {
    if (a.prefectureCode === undefined && b.prefectureCode !== undefined) return 1
    if (b.prefectureCode === undefined && a.prefectureCode !== undefined) return -1
    if (a.prefectureCode !== b.prefectureCode) {
      const order = a.prefectureCode! < b.prefectureCode! ? -1 : 1
      return sort === 'prefecture-asc' ? order : -order
    }
  }
  const order = a.seconds - b.seconds || a.nanoseconds - b.nanoseconds || (a.id === b.id ? 0 : a.id < b.id ? -1 : 1)
  return sort === 'cleared-asc' ? order : -order
}
