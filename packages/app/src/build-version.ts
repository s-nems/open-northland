declare const __GAME_VERSION__: string;
declare const __RESTORE_IDENTITY__: string | null;

/** What a build made without `ON_VERSION` reports; such a build never compares itself with a host. */
export const DEV_GAME_VERSION = 'dev';

/** The release this bundle was built as, stamped by Vite; tests and unbundled runs read `dev`. */
export const GAME_VERSION = typeof __GAME_VERSION__ === 'string' ? __GAME_VERSION__ : DEV_GAME_VERSION;

/** What a save must share to restore in another build (`build/game-version.ts`); null when unknown. */
export const RESTORE_IDENTITY: string | null =
  typeof __RESTORE_IDENTITY__ === 'string' ? __RESTORE_IDENTITY__ : null;
