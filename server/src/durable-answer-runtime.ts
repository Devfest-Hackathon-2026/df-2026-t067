import { setTimeout as delay } from 'node:timers/promises'
import type { AnswerPhotoStorage } from './answer-photo-storage'
import { createDurableAnswerServer } from './durable-answer-http'
import { runDueAnswerJobs } from './durable-answer-jobs'
import { runDueAnswerPhotoCleanup } from './durable-answer-photo-cleanup'
import type { runDurableAnswer } from './durable-answer-worker'
import { runDueDiscoveryDeletions } from './firestore-discovery-deletions'

type HttpOptions = Parameters<typeof createDurableAnswerServer>[0]
type WorkerOptions = Parameters<typeof runDurableAnswer>[1]
type MaintenancePass = 'answers' | 'discovery-deletions' | 'answer-photo-cleanup'

interface RuntimeOptions extends Omit<HttpOptions, 'photos' | 'enqueue'> {
  photos: Pick<AnswerPhotoStorage, 'writeIncoming' | 'readIncoming' | 'writeRecord' | 'readRecord' | 'deleteRecord' | 'deleteIncoming'>
  worker: Omit<WorkerOptions, 'db' | 'photos' | 'signal' | 'retryVerification'>
  maintenance: {
    intervalMs: number
    maximumJobs: number
    retryDelayMs: number
    onFailure?(pass: MaintenancePass): void
  }
}

export function createDurableAnswerRuntime({ worker, maintenance, ...http }: RuntimeOptions) {
  const { intervalMs, maximumJobs, retryDelayMs, onFailure } = maintenance
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 1 || intervalMs > 2_147_483_647 ||
    !Number.isSafeInteger(maximumJobs) || maximumJobs < 1 || maximumJobs > 256 ||
    !Number.isSafeInteger(retryDelayMs) || retryDelayMs < 1 || retryDelayMs > 2_147_483_647) {
    throw new Error('Invalid durable maintenance settings.')
  }
  const server = createDurableAnswerServer(http)
  const { db, photos } = http
  const stop = new AbortController()
  const { signal } = stop
  const sweep = { maximumJobs, retryDelayMs, signal }
  let running = Promise.resolve()
  const passes: Record<MaintenancePass, () => Promise<unknown>> = {
    answers: () => runDueAnswerJobs({ ...sweep, worker: { ...worker, db, photos } }),
    'discovery-deletions': () => runDueDiscoveryDeletions(db, photos, sweep),
    'answer-photo-cleanup': () => runDueAnswerPhotoCleanup(db, photos, sweep),
  }

  async function maintain(): Promise<void> {
    while (!signal.aborted) {
      for (const name of Object.keys(passes) as MaintenancePass[]) {
        if (signal.aborted) return
        try { await passes[name]() }
        catch {
          // Report only the pass name and let the remaining passes continue.
          try { onFailure?.(name) } catch { /* Observer failures cannot stop recovery. */ }
        }
      }
      if (!signal.aborted) await delay(intervalMs, undefined, { signal }).catch(() => {})
    }
  }

  function stopMaintenance(): Promise<void> {
    stop.abort()
    return running
  }

  server.once('listening', () => { running = maintain() })
  server.once('close', () => { void stopMaintenance() })
  return { server, stopMaintenance }
}
