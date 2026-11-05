import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ApiQuestApp } from './features/quests/ApiQuestApp'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ApiQuestApp />
  </StrictMode>,
)
