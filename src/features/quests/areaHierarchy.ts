import type { PublicArea } from '../../shared/api/types'

export const REGIONS = [
  { name: '北海道', prefectures: ['北海道'] },
  { name: '東北', prefectures: ['青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県'] },
  { name: '関東', prefectures: ['茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県'] },
  { name: '中部', prefectures: ['新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県', '岐阜県', '静岡県', '愛知県'] },
  { name: '近畿', prefectures: ['三重県', '滋賀県', '京都府', '大阪府', '兵庫県', '奈良県', '和歌山県'] },
  { name: '中国', prefectures: ['鳥取県', '島根県', '岡山県', '広島県', '山口県'] },
  { name: '四国', prefectures: ['徳島県', '香川県', '愛媛県', '高知県'] },
  { name: '九州・沖縄', prefectures: ['福岡県', '佐賀県', '長崎県', '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県'] },
] as const

const prefecturesByCode = REGIONS.flatMap((region) => region.prefectures)

export function prefectureForArea(area: PublicArea): string | undefined {
  // The public catalog must provide only the code resolved from the selected pin.
  if (!('prefectureCode' in area) || typeof area.prefectureCode !== 'string') return undefined
  const code = area.prefectureCode
  if (!/^[0-9]{2}$/u.test(code)) return undefined
  return prefecturesByCode[Number(code) - 1]
}

export function regionForPrefecture(prefecture: string) {
  return REGIONS.find((region) => (region.prefectures as readonly string[]).includes(prefecture))?.name
}

function asList(value: string | readonly string[] | undefined): string[] {
  if (value == null || value === '') return []
  return (typeof value === 'string' ? [value] : [...value]).filter(Boolean)
}

/** 絞り込みは「または」。選んだ地方のいずれかに属する、または選んだ都道府県のいずれかに一致すれば残す。
 *  地方とその中の県を両方選んでも、地方全体が残る（県指定は冗長）。未選択は全件。 */
export function getRegionAreas(areas: PublicArea[], region: string | readonly string[] = '', prefecture: string | readonly string[] = '') {
  const regions = asList(region)
  const prefectures = asList(prefecture)
  if (regions.length === 0 && prefectures.length === 0) return areas
  const regionSet = new Set(regions)
  const prefectureSet = new Set(prefectures)
  return areas.filter((area) => {
    const classifiedPrefecture = prefectureForArea(area)
    // 「未分類」という分類は廃止した（D-33）。コードの無い地域は、未選択（全件表示）の時だけ出る。
    if (!classifiedPrefecture) return false
    if (prefectureSet.has(classifiedPrefecture)) return true
    const classifiedRegion = regionForPrefecture(classifiedPrefecture)
    return !!classifiedRegion && regionSet.has(classifiedRegion)
  })
}

