import type { Firestore } from 'firebase-admin/firestore'
import { parseCaptureZones } from '../../src/shared/api/admin'
import type { AnswerPhotoStorage } from './answer-photo-storage'
import type { VerificationVersion } from './durable-answer-worker'
import { answerTransaction, processingError, readPublishedAnswerVersion, storedId, validGeneration } from './firestore-answer-data'
import type { LocationPolicy } from './location'
import { validPhotoFeatures } from './photo-match'

// The publication writer freezes this data with the version. The HTTP catalog
// reads a separate public projection and never gets these fields.
export function createPublishedAnswerMaterialLoader(db: Firestore, photos: Pick<AnswerPhotoStorage, 'readReference'>,
  locationLimits: Omit<LocationPolicy, 'zones'>) {
  function readMaterial(target: VerificationVersion) {
    return answerTransaction(db, async (tx) => {
      const current = await readPublishedAnswerVersion(db, tx, target.questId, target.version)
      const material = current.snapshot.answerMaterial
      if (current.placeId !== target.placeId || !material) throw processingError()
      const orgId = storedId(current.orgId)
      const { referenceAssetId, referenceGeneration, features } = material
      if (material.orgId !== orgId || !validGeneration(referenceGeneration) || !Number.isSafeInteger(Number(referenceGeneration)) ||
        !validPhotoFeatures(features)) throw processingError()
      const zones = parseCaptureZones(material.zones)
      if (zones.length === 0) throw processingError()
      return { orgId, assetId: storedId(referenceAssetId), generation: referenceGeneration, features, zones }
    }, true)
  }

  return {
    async locationPolicy(target: VerificationVersion): Promise<LocationPolicy> {
      const { zones } = await readMaterial(target)
      return { ...locationLimits, zones }
    },
    async loadReference(target: VerificationVersion) {
      const { orgId, assetId, generation, features } = await readMaterial(target)
      return { reference: await photos.readReference(orgId, assetId, generation), features }
    },
  }
}
