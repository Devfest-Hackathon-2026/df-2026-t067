import type { Position } from './types'
import { ContractError } from './validation'

export type SpotAddressInput =
  | { position: Position; googlePlaceId?: string }
  | { position?: Position; googlePlaceId: string }

export type SpotAddressCandidate =
  | { status: 'candidate'; source: 'place' | 'nearby'; address: string }
  | { status: 'no-result' | 'unavailable' | 'conflict' }

export type SpotAddressLookup = { orgId: string } & SpotAddressCandidate

function object(input: unknown, keys: string[], path: string): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some((key) => !keys.includes(key))) {
    throw new ContractError(path)
  }
  return input as Record<string, unknown>
}

export function parseSpotAddressInput(input: unknown): SpotAddressInput {
  const row = object(input, ['position', 'googlePlaceId'], 'spotAddress')
  let position: Position | undefined
  if (row.position !== undefined) {
    const { latitude, longitude } = object(row.position, ['latitude', 'longitude'], 'spotAddress.position')
    if (typeof latitude !== 'number' || !Number.isFinite(latitude) || Math.abs(latitude) > 90 ||
      typeof longitude !== 'number' || !Number.isFinite(longitude) || Math.abs(longitude) > 180) throw new ContractError('spotAddress.position')
    position = { latitude, longitude }
  }
  const googlePlaceId = row.googlePlaceId
  if (googlePlaceId !== undefined) {
    if (typeof googlePlaceId !== 'string' || !/^[A-Za-z0-9_-]{1,512}$/.test(googlePlaceId)) throw new ContractError('spotAddress.googlePlaceId')
    return position ? { position, googlePlaceId } : { googlePlaceId }
  }
  if (!position) throw new ContractError('spotAddress')
  return { position }
}

export function parseSpotAddressLookup(input: unknown): SpotAddressLookup {
  const row = object(input, ['orgId', 'status', 'address', 'source'], 'spotAddressResult')
  const { orgId, status, source, address } = row
  if (typeof orgId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(orgId)) throw new ContractError('spotAddressResult.orgId')
  if (status === 'candidate' && (source === 'place' || source === 'nearby') && typeof address === 'string' &&
    address.length <= 1000 && address.trim()) return { orgId, status, source, address: address.trim() }
  if ((status === 'no-result' || status === 'unavailable' || status === 'conflict') && !('address' in row) && !('source' in row)) {
    return { orgId, status }
  }
  throw new ContractError('spotAddressResult')
}
