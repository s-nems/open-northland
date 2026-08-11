import { isContentRoute } from '@open-northland/content-resolver';

/**
 * The content route a request asks for, or undefined when it is not this worker's to answer.
 * `swPath` is where `sw.js` itself was served, which is what puts the app at `<base>/play/` without
 * the deployment path being compiled in anywhere.
 */
export function contentRouteOf(swPath: string, requestUrl: URL, origin: string): string | undefined {
  const playPrefix = `${swPath.replace(/\/[^/]*$/, '')}/play`;
  if (requestUrl.origin !== origin || !requestUrl.pathname.startsWith(`${playPrefix}/`)) return undefined;
  const pathname = requestUrl.pathname.slice(playPrefix.length);
  return isContentRoute(pathname) ? pathname : undefined;
}
