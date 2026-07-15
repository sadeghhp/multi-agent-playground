/** Cache-bust and reload so browsers/CDNs refetch index.html and latest assets. */
export function reloadApp(): void {
  const url = new URL(window.location.href);
  url.searchParams.set('_', String(Date.now()));
  window.location.replace(url);
}
