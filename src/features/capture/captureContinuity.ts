// 写真・位置・認証情報は保存せず、本人と問題に対応する受付IDだけを保持する。
export function receiptKey(owner: string, questId: string) { return `quest-receipt:${owner}:${questId}` }
export function readReceipt(key?: string): string | null {
  try { return key ? sessionStorage.getItem(key) : null } catch { return null }
}
export function saveReceipt(key: string | undefined, id: string | null) {
  try { if (key) { if (id) sessionStorage.setItem(key, id); else sessionStorage.removeItem(key) } } catch { /* 保存不可でも現在の照会を続ける */ }
}
export const openedHints = new Map<string, Record<number, string>>()
