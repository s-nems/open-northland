/** The schemes a browser serves the app from; the desktop shell serves its own. */
const BROWSER_PROTOCOLS: readonly string[] = ['http:', 'https:'];

export function servedByBrowser(): boolean {
  return BROWSER_PROTOCOLS.includes(window.location.protocol);
}
