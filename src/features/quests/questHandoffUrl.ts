export function questHandoffUrl(quest: { areaId: string; questId: string }): string {
  const url = new URL(window.location.href)
  url.searchParams.set('area', quest.areaId)
  url.searchParams.set('quest', quest.questId)
  url.hash = ''
  return url.toString()
}

