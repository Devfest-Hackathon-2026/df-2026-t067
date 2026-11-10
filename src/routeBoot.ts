/** Remove explorer-only boot markup before loading a non-explorer screen. */
export function prepareRouteBoot(pathname: string, body: HTMLElement, host: HTMLElement): void {
  if (!['/admin', '/admin-demo', '/admin-local', '/terms', '/terms/'].includes(pathname)) return
  body.classList.remove('explore-fullbleed')
  host.replaceChildren()
}
