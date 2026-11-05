import { open } from 'node:fs/promises'
import { parseOrgMembership } from '../../src/shared/api/admin'
import type { MembershipLookup } from './admin-http'
import { HttpError } from './errors'

// Local development configuration only. It is never read from HTTP, a token
// claim, or the frontend environment. Production membership storage is separate.
export function createFileMembershipLookup(file: string): MembershipLookup {
  return async (uid) => {
    try {
      const handle = await open(file, 'r')
      const buffer = Buffer.alloc(65_537)
      let size = 0
      try {
        while (size < buffer.length) {
          const read = await handle.read(buffer, size, buffer.length - size, null)
          if (read.bytesRead === 0) break
          size += read.bytesRead
        }
      } finally { await handle.close() }
      if (size > 65_536) throw new Error('Invalid membership configuration.')
      const input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, size))) as unknown
      if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).join(',') !== 'memberships') throw new Error('Invalid membership configuration.')
      const rows = (input as { memberships: unknown }).memberships
      if (!Array.isArray(rows) || rows.length > 200) throw new Error('Invalid membership configuration.')
      const keys = new Set<string>()
      const memberships = rows.map((row: unknown) => {
        if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('Invalid membership configuration.')
        const { uid: owner, active, ...data } = row as Record<string, unknown>
        if (typeof owner !== 'string' || !owner.trim() || owner.length > 128 || typeof active !== 'boolean') throw new Error('Invalid membership configuration.')
        const membership = parseOrgMembership(data)
        const key = JSON.stringify([owner, membership.orgId])
        if (keys.has(key)) throw new Error('Invalid membership configuration.')
        keys.add(key)
        return { owner, active, membership }
      })
      return memberships.filter((row) => row.owner === uid && row.active).map((row) => row.membership)
    } catch {
      // Configuration path, UIDs and file content must not appear in responses.
      throw new HttpError(503, 'SYSTEM_ERROR', '所属設定を利用できません。', true)
    }
  }
}
