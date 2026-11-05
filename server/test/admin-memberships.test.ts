import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createFileMembershipLookup } from '../src/admin-memberships'
import { HttpError } from '../src/errors'

const entry = { uid: 'owner', active: true, orgId: 'demo-org', label: '架空の自治体', role: 'editor', areaId: 'demo-area' }

test('membership file is server-only, defaults to deny and is reread after revocation', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'quest-membership-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const file = join(directory, 'local.json')
  await writeFile(file, JSON.stringify({ memberships: [entry] }))
  const lookup = createFileMembershipLookup(file)
  assert.deepEqual(await lookup('owner'), [{ orgId: 'demo-org', label: '架空の自治体', role: 'editor', areaId: 'demo-area' }])
  assert.deepEqual(await lookup('traveler'), [])
  await writeFile(file, JSON.stringify({ memberships: [{ ...entry, active: false }] }))
  assert.deepEqual(await lookup('owner'), [])
})

test('malformed, excessive or missing membership files fail closed without disclosing the path or data', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'quest-membership-private-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const file = join(directory, 'private.json')
  const lookup = createFileMembershipLookup(file)
  const check = (error: unknown) => {
    assert(error instanceof HttpError)
    assert.equal(error.status, 503)
    assert.equal(error.code, 'SYSTEM_ERROR')
    assert(!error.message.includes(directory))
    assert(!error.message.includes('private-marker'))
    return true
  }
  await assert.rejects(lookup('owner'), check)
  for (const data of ['private-marker', JSON.stringify({ memberships: [{ ...entry, role: 'owner' }] }),
    JSON.stringify({ memberships: [entry, entry] }), JSON.stringify({ memberships: [{ ...entry, active: 'true' }] }),
    JSON.stringify({ memberships: [entry], unexpected: true }), ' '.repeat(65537)]) {
    await writeFile(file, data)
    await assert.rejects(lookup('owner'), check)
  }
})
