import type { ApiClient } from '../../shared/api'
import type { AuthClient } from '../auth/authTypes'
import { ApiQuestApp } from './ApiQuestApp'

export function TeamPreview({ authClient, apiClient }: { authClient?: AuthClient; apiClient?: ApiClient } = {}) {
  return <ApiQuestApp api={apiClient} authClient={authClient} dataMode="team-preview" />
}
