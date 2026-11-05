import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

const root = createRoot(document.getElementById('root')!)

if (window.location.pathname === '/admin-demo') {
  void import('./features/admin-demo/AdminDemo').then(({ default: AdminDemo }) => {
    root.render(<StrictMode><AdminDemo /></StrictMode>)
  })
} else {
  void import('./features/quests/ApiQuestApp').then(({ ApiQuestApp: App }) => {
    root.render(<StrictMode><App /></StrictMode>)
  })
}
