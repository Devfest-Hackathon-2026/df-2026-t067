import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createModuleLoadGuard } from './moduleLoadGuard'
import { prepareRouteBoot } from './routeBoot'

// Explorer boot HTML stays visible until commit; admin routes clear it first.
// Deliberate replacement: URL, auth and viewport are browser-owned initial state.
// Static hosts can enter through public/terms/index.html without an SPA rewrite.
if (window.location.pathname === '/' && new URLSearchParams(window.location.search).get('page') === 'terms') {
  window.history.replaceState(null, '', '/terms')
}
const host = document.getElementById('root')!
prepareRouteBoot(window.location.pathname, document.body, host)
const root = createRoot(host)
const { load } = createModuleLoadGuard(root)

if (window.location.pathname === '/terms' || window.location.pathname === '/terms/') {
  void load(import('./Terms'), ({ Terms }) => <StrictMode><Terms /></StrictMode>)
} else if (window.location.pathname === '/admin-demo') {
  void load(import('./features/admin-demo/AdminDemo'), ({ default: AdminDemo }) => <StrictMode><AdminDemo /></StrictMode>)
} else if (import.meta.env.VITE_QUEST_DATA_SOURCE === 'team-preview') {
  if (window.location.pathname === '/admin') {
    void load(import('./features/admin/LocalAdminWorkspace'), ({ LocalAdminWorkspace }) => <StrictMode><LocalAdminWorkspace dataMode="team-preview" /></StrictMode>)
  } else {
    void load(import('./features/quests/TeamPreview'), ({ TeamPreview }) => <StrictMode><TeamPreview /></StrictMode>)
  }
} else if (import.meta.env.DEV && window.location.pathname === '/admin-local') {
  void load(import('./features/admin/LocalAdminWorkspace'), ({ LocalAdminWorkspace }) => <StrictMode><LocalAdminWorkspace dataMode={import.meta.env.VITE_QUEST_DATA_SOURCE === 'durable-local' ? 'durable-local' : 'demo'} /></StrictMode>)
} else if (import.meta.env.DEV) {
  const dataMode = import.meta.env.VITE_QUEST_DATA_SOURCE === 'durable-local' ? 'durable-local' : 'demo'
  void load(import('./features/quests/ApiQuestApp'), ({ ApiQuestApp: App }) => <StrictMode><App dataMode={dataMode} /></StrictMode>)
} else {
  // Hosting has no local API server. Preserve its existing offline preview.
  void load(import('./App'), ({ default: App }) => <StrictMode><App /></StrictMode>)
}
