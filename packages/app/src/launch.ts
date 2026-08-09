import { localeParam, setActiveLocale } from './i18n/index.js';
import { routeFor } from './routes.js';
import { dismissBootProgress } from './view/boot-progress.js';

/** Leaves the running entry for the one `search` names. */
export type LaunchEntry = (search: string) => void;

function gameCanvas(): HTMLCanvasElement {
  const canvas = document.getElementById('game');
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error('missing #game canvas');
  return canvas;
}

/** Boots the entry `params` selects into the shared canvas. */
export async function runEntry(
  params: URLSearchParams,
  // Runs once the entry's module is in and before it draws, so the screen it replaces holds the frame
  // for the download instead of leaving an empty page behind.
  onLoaded: () => void = () => undefined,
): Promise<void> {
  try {
    setActiveLocale(localeParam(params));
    const run = await routeFor(params).load();
    onLoaded();
    await run(gameCanvas(), params);
  } catch (err) {
    // A boot that throws never reaches its own `finish()`, so the progress card would sit there for
    // good, covering the crash banner.
    dismissBootProgress();
    throw err;
  }
}

/**
 * Hands this document to another entry rather than navigating to it: a navigation ends the browser's
 * fullscreen grant, and only a fresh user gesture inside the next document could take it back. The
 * URL changes with the handover, so a load that fails first leaves the caller's screen and URL
 * untouched. Going back reloads, so a URL reached that way boots the way a typed one does.
 */
export function swapToEntry(
  search: string,
  teardown: () => void,
  run: (params: URLSearchParams, onLoaded: () => void) => Promise<void> = runEntry,
): Promise<void> {
  return run(new URLSearchParams(search), () => {
    window.history.pushState(null, '', search);
    window.addEventListener('popstate', () => window.location.reload(), { once: true });
    teardown();
  });
}
