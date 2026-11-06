import type { DocumentSnapshot, Firestore, Transaction } from 'firebase-admin/firestore'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { parsePublicArea, parsePublicQuest, parseQuestHint } from '../../src/shared/api/validation'
import { publicHintImagePath } from './admin-publication'
import type { AnswerPhotoStorage } from './answer-photo-storage'
import { HttpError } from './errors'
import { answerTransaction, isPublicationStatus, notFound, processingError, questChanged, storedId, validGeneration } from './firestore-answer-data'
import { send } from './http-server'
import { intersectsBbox, paginate, parseAreaQuery, parseId, positiveRouteNumber, validateQuery } from './query'

// The local catalog has a fixed read bound. Fail closed instead of showing a
// partial catalog with incorrect region counts when that bound is exceeded.
export const maximumCatalogEntries = 256

async function readCollection(db: Firestore, tx: Transaction, name: 'areas' | 'questPublic') {
  const snapshot = await tx.get(db.collection(name).limit(maximumCatalogEntries + 1))
  if (snapshot.size > maximumCatalogEntries) throw processingError()
  return snapshot.docs
}

function readPublished(projection: DocumentSnapshot, current: DocumentSnapshot) {
  const publication = current.data()
  const data = projection.data()
  if (!publication || !data || !isPublicationStatus(publication.status) || publication.publishedVersion == null ||
    data.quest?.version !== publication.publishedVersion) return
  const quest = parsePublicQuest(data.quest)
  if (quest.questId !== storedId(projection.id)) throw processingError()
  storedId(quest.areaId)
  return { quest, hints: data.hints }
}

async function listPublished(db: Firestore, tx: Transaction) {
  const projections = await readCollection(db, tx, 'questPublic')
  if (!projections.length) return []
  const versions = await tx.getAll(...projections.map(({ id }) => db.collection('quests').doc(id)))
  return projections.flatMap((projection, index) => {
    const published = readPublished(projection, versions[index])
    return published ? [published.quest] : []
  })
}

export function readPublicArea(row: DocumentSnapshot, publishedCount: number) {
  return parsePublicArea({ areaId: storedId(row.id), label: row.get('label'), marker: row.get('marker'),
    publicGeometry: JSON.parse(row.get('publicGeometryJson')), publishedCount })
}

export async function handlePublicCatalog(db: Firestore, request: IncomingMessage, response: ServerResponse,
  path: string, params: URLSearchParams, photos?: Pick<AnswerPhotoStorage, 'readHint'>): Promise<boolean> {
  const areas = path === '/api/v1/areas'
  const quests = path === '/api/v1/quests'
  const detail = /^\/api\/v1\/quests\/([^/]+)(?:\/hints\/([^/]+))?$/.exec(path)
  const hintImage = /^\/api\/v1\/quests\/([^/]+)\/hint-image$/.exec(path)
  if (!areas && !quests && !detail && !hintImage) return false
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET')
    throw new HttpError(405, 'HTTP_ERROR', 'このメソッドは利用できません。')
  }

  if (areas) {
    const filter = parseAreaQuery(params)
    const { bbox } = filter
    const items = await answerTransaction(db, async (tx) => {
      const [rows, published] = await Promise.all([readCollection(db, tx, 'areas'), listPublished(db, tx)])
      const counts = new Map<string, number>()
      for (const { areaId } of published) counts.set(areaId, (counts.get(areaId) ?? 0) + 1)
      return rows.map((row) => readPublicArea(row, counts.get(row.id) ?? 0)).filter((area) => !bbox || intersectsBbox(area, bbox))
    }, true)
    send(response, 200, paginate(items, params, 'areas:' + JSON.stringify(filter), (area) => area.areaId))
  } else if (quests) {
    validateQuery(params, ['areaId', 'cursor', 'limit'])
    const rawAreaId = params.get('areaId')
    const areaId = rawAreaId === null ? undefined : parseId(rawAreaId)
    const items = await answerTransaction(db, (tx) => listPublished(db, tx), true)
    const matching = areaId ? items.filter((quest) => quest.areaId === areaId) : items
    send(response, 200, paginate(matching, params, 'quests:' + (areaId ?? ''), (quest) => quest.questId))
  } else if (hintImage) {
    validateQuery(params, ['expectedVersion'])
    if (!photos) throw notFound()
    const questId = parseId(decodeURIComponent(hintImage[1]))
    const version = positiveRouteNumber(params.get('expectedVersion') ?? '')
    const readHint = () => answerTransaction(db, (tx) => readHintAsset(db, tx, questId, version), true)
    const { orgId, assetId, generation } = await readHint()
    const { bytes } = await photos.readHint(orgId, assetId, generation)
    const current = await readHint()
    if (current.orgId !== orgId || current.assetId !== assetId || current.generation !== generation) throw processingError()
    if (response.destroyed || response.writableEnded) return true
    response.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': bytes.length, 'Content-Disposition': 'inline', 'Cache-Control': 'no-store' })
    response.end(bytes)
  } else if (detail) {
    const questId = parseId(decodeURIComponent(detail[1]))
    const hint = detail[2] !== undefined
    validateQuery(params, hint ? ['expectedVersion'] : [])
    const index = hint ? positiveRouteNumber(decodeURIComponent(detail[2])) : undefined
    const expectedVersion = hint ? positiveRouteNumber(params.get('expectedVersion') ?? '') : undefined
    const result = await answerTransaction(db, async (tx) => {
      const [projection, current] = await tx.getAll(db.collection('questPublic').doc(questId), db.collection('quests').doc(questId))
      const published = readPublished(projection, current)
      if (!published) throw notFound()
      const { quest, hints } = published
      if (index === undefined) return quest
      if (quest.version !== expectedVersion) throw questChanged()
      if (!Array.isArray(hints) || index > quest.hintCount || hints[index - 1] === undefined) throw notFound()
      return parseQuestHint({ questId, version: quest.version, index, text: hints[index - 1] })
    }, true)
    send(response, 200, result)
  }
  return true
}

async function readHintAsset(db: Firestore, tx: Transaction, questId: string, version: number) {
  const [projection, current] = await tx.getAll(db.collection('questPublic').doc(questId), db.collection('quests').doc(questId))
  const published = readPublished(projection, current)
  if (!published) throw notFound()
  if (published.quest.version !== version) throw questChanged()
  if (published.quest.optionalHintImage !== publicHintImagePath(questId, version)) throw notFound()
  const snapshot = await tx.get(db.collection('questVersions').doc(questId + ':' + version))
  const hint = snapshot.get('publicHintImage')
  const orgId = storedId(current.get('orgId'))
  if (!hint || hint.orgId !== orgId || !validGeneration(hint.generation)) throw processingError()
  return { orgId, assetId: storedId(hint.assetId), generation: hint.generation }
}
