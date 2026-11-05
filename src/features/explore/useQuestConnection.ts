import { useCallback, useEffect, useState } from 'react'
import { ApiError } from '../../shared/api'
import type { ApiClient } from '../../shared/api'
import type { AuthSnapshot } from '../auth/authTypes'
import { demoQuest } from '../quests/demoQuest'

type DataSource = 'preview' | 'local-api' | 'invalid'
type Remote<T> = { status: 'loading' } | { status: 'error' } | { status: 'ready'; value: T }
type QuestContent = typeof demoQuest

export function readDataSource(value: unknown, development: boolean): DataSource {
  if (value === undefined || value === '' || value === 'preview') return 'preview'
  return value === 'local-api' && development ? 'local-api' : 'invalid'
}

// Every request belongs to a callback/retry generation. Cleanup and the deadline
// abort the request, so an old result cannot overwrite a new user or retry.
function useRemote<T>(enabled: boolean, read: (signal: AbortSignal) => Promise<T>) {
  const [revision, setRevision] = useState(0)
  const [settled, setSettled] = useState<{ read: typeof read; revision: number; result: Remote<T> } | null>(null)
  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    const fail = () => setSettled({ read, revision, result: { status: 'error' } })
    const deadline = setTimeout(() => { fail(); controller.abort() }, 10_000)
    void read(controller.signal).then((value) => {
      if (!controller.signal.aborted) setSettled({ read, revision, result: { status: 'ready', value } })
    }).catch(() => {
      if (!controller.signal.aborted) fail()
    }).finally(() => clearTimeout(deadline))
    return () => { clearTimeout(deadline); controller.abort() }
  }, [enabled, read, revision])
  const result: Remote<T> = settled?.read === read && settled.revision === revision ? settled.result : { status: 'loading' }
  return { result, retry: () => setRevision((value) => value + 1) }
}

export function useQuestConnection(source: DataSource, api: ApiClient) {
  const read = useCallback(async (signal: AbortSignal): Promise<QuestContent> => {
    const quest = await api.getQuest('demo-quest', { signal })
    if (quest.questId !== 'demo-quest') throw new ApiError('INVALID_RESPONSE')
    return { title: quest.title, clue: quest.clue, visitConditions: quest.visitConditions, areaLabel: '架空のデモ地域' }
  }, [api])
  const remote = useRemote(source === 'local-api', read)
  const result: Remote<QuestContent> = source === 'preview' ? { status: 'ready', value: demoQuest }
    : source === 'invalid' ? { status: 'error' } : remote.result
  return { ...remote, result }
}

export function useServerIdentity(enabled: boolean, api: ApiClient, auth: AuthSnapshot) {
  const uid = auth.status === 'signed-in' ? auth.user.uid : null
  const read = useCallback(async (signal: AbortSignal) => {
    const identity = await api.getSession({ signal })
    if (identity.uid !== uid) throw new ApiError('INVALID_RESPONSE')
    return identity
  }, [api, uid])
  const remote = useRemote(enabled && uid !== null, read)
  return { ...remote, result: enabled && uid !== null ? remote.result : null }
}
