import assert from 'node:assert/strict'
import test from 'node:test'
import { hasSpotShootingArea } from '../src/firestore-managed-drafts'

test('matches only the single 1km circle centered at the saved spot', () => {
  const position = { latitude: 35, longitude: 135 }
  const afterClear = { access: '', hours: '', promoComment: '', explanation: '' }
  const draft = { afterClear: { ...afterClear, spot: { name: '架空の塔', address: '架空住所', position } } }
  const zone = { ...position, radiusMeters: 1000 }
  assert.equal(hasSpotShootingArea(draft, [zone]), true)
  assert.equal(hasSpotShootingArea(draft, [{ ...zone, longitude: 136 }]), false)
  assert.equal(hasSpotShootingArea(draft, [{ ...zone, radiusMeters: 999 }]), false)
  assert.equal(hasSpotShootingArea(draft, [zone, zone]), false)
  assert.equal(hasSpotShootingArea({ afterClear }, [zone]), false)
})
