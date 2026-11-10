import { constants } from 'node:fs'
import { open, mkdir, rmdir } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { photoSystemError } from './photo-match'

const identity = { version: 1, trial: 'vertex-photo-2026-11-05', project: 'tour-513804', model: 'gemini-3.8-flash', location: 'global', limit: 50 }

function assertFile(file: string) {
  if (!isAbsolute(file) || file.length > 4000 || Array.from(file).some((char) => char.charCodeAt(0) < 32)) throw photoSystemError(false)
}

export async function initializeTrialLedger(file: string, alreadyUsed: number): Promise<void> {
  assertFile(file)
  if (!Number.isSafeInteger(alreadyUsed) || alreadyUsed < 1 || alreadyUsed > 50) throw photoSystemError(false)
  // Explicit init only; wx never overwrites an existing allowance.
  try {
    const handle = await open(file, 'wx', 0o600)
    try { await handle.writeFile(JSON.stringify({ ...identity, used: alreadyUsed })); await handle.sync() }
    finally { await handle.close() }
  } catch { throw photoSystemError(false) }
}

export async function withTrialSlot<T>(file: string, signal: AbortSignal, work: (used: number) => Promise<T>): Promise<T> {
  assertFile(file)
  signal.throwIfAborted()
  const lock = file + '.lock'
  // Atomic across processes on this local filesystem. A crash leaves the lock;
  // fail closed rather than guessing whether its network request completed.
  try { await mkdir(lock, { mode: 0o700 }) } catch { throw photoSystemError(false) }
  try {
    let count: number
    try {
      const handle = await open(file, constants.O_RDWR | constants.O_NOFOLLOW | constants.O_NONBLOCK)
      try {
        const info = await handle.stat()
        if (!info.isFile() || info.nlink !== 1 || (info.mode & 0o077) !== 0 || info.size > 1024 ||
          (process.getuid && info.uid !== process.getuid())) throw photoSystemError(false)
        const data = JSON.parse(await handle.readFile('utf8')) as Record<string, unknown>
        if (!data || Object.keys(data).sort().join(',') !== [...Object.keys(identity), 'used'].sort().join(',') ||
          Object.entries(identity).some(([key, value]) => data[key] !== value) ||
          !Number.isSafeInteger(data.used) || (data.used as number) < 1 || (data.used as number) >= 50) throw photoSystemError(false)
        signal.throwIfAborted()
        count = (data.used as number) + 1
        const bytes = Buffer.from(JSON.stringify({ ...identity, used: count }))
        // Explicit position because readFile advanced the descriptor offset.
        const written = await handle.write(bytes, 0, bytes.length, 0)
        if (written.bytesWritten !== bytes.length) throw photoSystemError(false)
        await handle.truncate(bytes.length)
        await handle.sync()
      } finally { await handle.close() }
    } catch { signal.throwIfAborted(); throw photoSystemError(false) }
    signal.throwIfAborted()
    return await work(count)
  } finally { await rmdir(lock) }
}
