import type { ApiClient } from '../../shared/api'
import type { AuthClient } from '../auth/authTypes'
import { ApiQuestApp } from './ApiQuestApp'

export function TeamPreview({ authClient, apiClient }: { authClient?: AuthClient; apiClient?: ApiClient } = {}) {
  // Build-time mirror of the server's QUEST_TEAM_ANSWER_TRIAL switch. The
  // server stays authoritative: with the trial off it rejects the traveler
  // answer routes no matter what this build shows.
  const answerTrial = import.meta.env.VITE_QUEST_TEAM_ANSWER_TRIAL === 'true'
  return <ApiQuestApp api={apiClient} authClient={authClient} dataMode="team-preview" teamAnswerTrial={answerTrial} />
}
