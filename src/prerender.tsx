import { renderToString } from 'react-dom/server'
import App from './App'
import { TeamPreview } from './features/quests/TeamPreview'
import { PrerenderViewport } from './features/quests/useWideViewport'

/** Only render: effects, SDK startup, network and device permissions run in the browser. */
export function renderBoot() {
  const team = import.meta.env.VITE_QUEST_DATA_SOURCE === 'team-preview'
  const render = (wide: boolean) => renderToString(
    <PrerenderViewport value={wide}>{team ? <TeamPreview /> : <App />}</PrerenderViewport>,
    { identifierPrefix: wide ? 'boot-pc-' : 'boot-mobile-' },
  )
  return {
    html: `<div class="prerender-pc">${render(true)}</div><div class="prerender-mobile">${render(false)}</div>`,
    fullbleed: team,
  }
}
