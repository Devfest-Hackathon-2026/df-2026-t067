import { readFileSync } from 'node:fs'
import { prepareN03Area } from './municipal-areas'

const [file, municipalityCode, year, name, lat, lng, ...extra] = process.argv.slice(2)
try {
  if (!file || !/^\d{5}$/.test(municipalityCode ?? '') || !/^\d{4}$/.test(year ?? '') || !name?.trim() ||
    !lat?.trim() || !lng?.trim() || extra.length) {
    throw new Error('引数: GeoJSONファイル 自治体コード 年度 自治体名 代表点緯度 代表点経度')
  }
  const result = prepareN03Area(JSON.parse(readFileSync(file, 'utf8')) as unknown, {
    areaId: `n03-${municipalityCode}-${year}`, municipalityCode, year: Number(year), name,
    marker: { latitude: Number(lat), longitude: Number(lng) },
  })
  process.stdout.write(JSON.stringify(result, null, 2) + '\n')
} catch (error) {
  console.error(error instanceof Error ? error.message : '行政区域を変換できませんでした。')
  process.exitCode = 1
}
