import { diag } from './diag/index.js';
import {
  installNameOverlay,
  type Locale,
  localeParam,
  type NameOverlay,
  setActiveLocale,
} from './i18n/index.js';
import { routeFor } from './routes.js';
import { dismissBootProgress } from './view/boot-progress.js';
import { guardEntry, pushEntryUrl, releaseDocument } from './view/navigation-guard.js';

let cursorsInstalled = false;

/** Leaves the running entry for the one `search` names. */
export type LaunchEntry = (search: string) => void;

function gameCanvas(): HTMLCanvasElement {
  const canvas = document.getElementById('game');
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error('missing #game canvas');
  return canvas;
}

/** `locale`'s original tribe names. They are optional: a failed load keeps the authored ones and never
 *  fails the entry. */
function loadTribeNames(locale: Locale): Promise<NameOverlay> {
  return import('./content/original-names.js')
    .then((names) => names.originalTribeNameOverlay(locale))
    .catch((err: unknown) => {
      diag.warn('content', 'launch: original tribe names failed to load; the authored names stay', err);
      return {};
    });
}

/** Boots the entry `params` selects into the shared canvas. */
export async function runEntry(
  params: URLSearchParams,
  // Runs once the entry's module is in and before it draws, so the screen it replaces holds the frame
  // for the download instead of leaving an empty page behind.
  onLoaded: () => void = () => undefined,
): Promise<void> {
  // Set once this entry took the document; a load that fails earlier leaves the running one held.
  let guarded = false;
  try {
    const locale = localeParam(params);
    setActiveLocale(locale);
    const route = routeFor(params);
    const [run, tribeNames] = await Promise.all([route.load(), loadTribeNames(locale)]);
    if (!cursorsInstalled) {
      const { installCursorTheme } = await import('./view/cursors/theme.js');
      installCursorTheme();
      cursorsInstalled = true;
    }
    onLoaded();
    // Only now: the screen this replaces, a world with its full overlay, draws until `onLoaded`.
    installNameOverlay(locale, tribeNames);
    guardEntry(route.id);
    guarded = true;
    await run(gameCanvas(), params);
  } catch (err) {
    // A boot that throws never reaches its own `finish()`, so the progress card would sit there for
    // good, covering the crash banner.
    dismissBootProgress();
    // A game entry that never came up holds nothing worth a prompt.
    if (guarded) releaseDocument();
    throw err;
  }
}

/**
 * Hands this document to another entry rather than navigating to it: a navigation ends the browser's
 * fullscreen grant, and only a fresh user gesture inside the next document could take it back. The
 * URL changes with the handover, so a load that fails first leaves the caller's screen and URL
 * untouched. The navigation guard owns what going back does afterwards.
 */
export function swapToEntry(
  search: string,
  teardown: () => void,
  run: (params: URLSearchParams, onLoaded: () => void) => Promise<void> = runEntry,
): Promise<void> {
  return run(new URLSearchParams(search), () => {
    pushEntryUrl(search);
    teardown();
  });
}
