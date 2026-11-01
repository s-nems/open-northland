/** Exact origins permitted for automatic catalogue downloads. The configured origin also permits
 *  an explicitly selected offline mirror, including its scheme and port. */
const CATALOG_ORIGINS: ReadonlySet<string> = new Set([
  'https://culturesnation.pl',
  'https://www.culturesnation.pl',
  'https://api.culturesnation.pl',
  'https://wikinger-tommy.de',
  'https://www.wikinger-tommy.de',
]);

export function permittedDownloadUrl(url: URL, upstream: string): boolean {
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  if (url.username !== '' || url.password !== '') return false;
  return CATALOG_ORIGINS.has(url.origin) || url.origin === new URL(upstream).origin;
}
