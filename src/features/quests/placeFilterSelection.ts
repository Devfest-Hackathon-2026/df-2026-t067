import { REGIONS } from './areaHierarchy'

/** 旧複数選択は最初の有効な県へ寄せる。県のない地方指定は全国になる。 */
export function normalizePlaceSelection(prefectures: readonly string[]): { regions: string[]; prefectures: string[] } {
  const prefecture = prefectures.find((value) =>
    REGIONS.some((region) => (region.prefectures as readonly string[]).includes(value)))
  return { regions: [], prefectures: prefecture ? [prefecture] : [] }
}
