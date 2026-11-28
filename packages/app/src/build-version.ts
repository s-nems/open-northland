declare const __GAME_VERSION__: string;
declare const __CLIENT_BUILD__: string;
declare const __RESTORE_IDENTITY__: string | null;

/** What a build made without `ON_VERSION` reports; such a build never compares itself with a host. */
export const DEV_GAME_VERSION = 'dev';

/** The release this bundle was built as, stamped by Vite; tests and unbundled runs read `dev`. */
export const GAME_VERSION = typeof __GAME_VERSION__ === 'string' ? __GAME_VERSION__ : DEV_GAME_VERSION;

/** The build a bundle was made as, stamped by Vite from its client packages' sources; a dev run
 *  that loads the sources unbundled reads `unbundled`. Two different builds replay a match
 *  differently even when both carry the same release, so a replay names this beside the release. */
export const CLIENT_BUILD = typeof __CLIENT_BUILD__ === 'string' ? __CLIENT_BUILD__ : 'unbundled';

/** What a save must share to restore in another build (`build/game-version.ts`); null when unknown. */
export const RESTORE_IDENTITY: string | null =
  typeof __RESTORE_IDENTITY__ === 'string' ? __RESTORE_IDENTITY__ : null;

/** A release name as a server reports it: `1.2.3` with an optional short suffix. */
const RELEASE_NAME = /^\d+\.\d+\.\d+[0-9A-Za-z.+-]{0,20}$/;

/** The release a server names, to show beside this game's; null for a label that is no release,
 *  and for this game's own name, which tells the two apart no better than none. */
export function otherRelease(named: string | null | undefined): string | null {
  if (named === null || named === undefined || named === GAME_VERSION) return null;
  return RELEASE_NAME.test(named) ? named : null;
}
