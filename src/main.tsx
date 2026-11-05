import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

const root = createRoot(document.getElementById('root')!)

if (import.meta.env.DEV && window.location.pathname === '/admin-local') {
  void import('./features/admin-demo/LocalAdminWorkspace').then(({ LocalAdminWorkspace }) => {
    root.render(<StrictMode><LocalAdminWorkspace /></StrictMode>)
  })
} else if (window.location.pathname === '/admin-demo') {
  void import('./features/admin-demo/AdminDemo').then(({ default: AdminDemo }) => {
    root.render(<StrictMode><AdminDemo /></StrictMode>)
  })
} else if (import.meta.env.DEV) {
  void import('./features/quests/ApiQuestApp').then(({ ApiQuestApp: App }) => {
    root.render(<StrictMode><App /></StrictMode>)
  })
} else {
  // Hosting has no local API server. Preserve its existing offline preview.
  void import('./App').then(({ default: App }) => {
    root.render(<StrictMode><App /></StrictMode>)
  })
}
