import { useCallback } from 'react'
import { ApiError } from '../../shared/api'
import type { ApiClient } from '../../shared/api'
import type { AuthSnapshot } from '../auth/authTypes'
import { demoQuest } from '../quests/demoQuest'
import { demoAreaLabel } from '../quests/demoQuest'
import type { PublicQuest } from '../../shared/api/types'
import { useRemote } from '../../shared/useRemote'
import type { Remote } from '../../shared/useRemote'

type DataSource = 'preview' | 'local-api' | 'invalid'
type QuestContent = PublicQuest & { areaLabel: string }

export function readDataSource(value: unknown, development: boolean): DataSource {
  if (value === undefined || value === '' || value === 'preview') return 'preview'
  return value === 'local-api' && development ? 'local-api' : 'invalid'
}

export function useQuestConnection(source: DataSource, api: ApiClient) {
  const read = useCallback(async (signal: AbortSignal): Promise<QuestContent> => {
    const quest = await api.getQuest('demo-quest', { signal })
    if (quest.questId !== 'demo-quest') throw new ApiError('INVALID_RESPONSE')
    return { ...quest, areaLabel: '架空のデモ地域' }
  }, [api])
  const remote = useRemote(source === 'local-api', read)
  const result: Remote<QuestContent> = source === 'preview' ? { status: 'ready', value: { ...demoQuest, areaLabel: demoAreaLabel } }
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
