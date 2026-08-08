import { type MenuSettings, persistSettings, readStoredSettings } from './settings-store.js';

/**
 * The window mode of a browser document. A browser grants fullscreen only inside a user gesture and a
 * document never inherits one, so the mode a player chose is gone by the time the next document loads.
 */

type DisplayMode = MenuSettings['displayMode'];

/** The schemes a browser serves the app from; the desktop shell serves its own. */
const BROWSER_PROTOCOLS: readonly string[] = ['http:', 'https:'];

/**
 * A document whose window mode this module manages. The desktop shell is out of scope: it records a
 * change like any other document, but nothing puts its window back.
 */
export function fullscreenControllable(): boolean {
  return BROWSER_PROTOCOLS.includes(window.location.protocol) && document.fullscreenEnabled;
}

export function isFullscreen(): boolean {
  return document.fullscreenElement !== null;
}

/** A rejected request leaves the window mode untouched, and no caller has anything to recover. */
export function enterFullscreen(): Promise<void> {
  return document.documentElement.requestFullscreen().catch(() => undefined);
}

export function leaveFullscreen(): Promise<void> {
  return isFullscreen() ? document.exitFullscreen().catch(() => undefined) : Promise.resolve();
}

/** `?fullscreen=off`: a scripted session keeps the window it was given and is never asked about it. */
export function fullscreenOptedOut(params: URLSearchParams): boolean {
  return params.get('fullscreen') === 'off';
}

export interface DisplayModeEnv {
  readonly optedOut: boolean;
  readonly controllable: boolean;
  readonly alreadyFullscreen: boolean;
  readonly displayMode: DisplayMode;
}

/** `restore` records changes too; `track` only records what the player does to the window. */
export type DisplayModePlan = 'ignore' | 'track' | 'restore';

export function displayModePlan(env: DisplayModeEnv): DisplayModePlan {
  if (env.optedOut) return 'ignore';
  if (!env.controllable || env.alreadyFullscreen || env.displayMode !== 'fullscreen') return 'track';
  return 'restore';
}

function persistDisplayMode(mode: DisplayMode): void {
  persistSettings({ ...readStoredSettings(), displayMode: mode });
}

/**
 * Bind this document to the stored display mode: record every change the player makes to it, and take
 * a stored fullscreen back on the first gesture that can grant it.
 */
export function bindDisplayMode(
  params: URLSearchParams,
  persist: (mode: DisplayMode) => void = persistDisplayMode,
): void {
  const plan = displayModePlan({
    optedOut: fullscreenOptedOut(params),
    controllable: fullscreenControllable(),
    alreadyFullscreen: isFullscreen(),
    displayMode: readStoredSettings().displayMode,
  });
  if (plan === 'ignore') return;
  // Fullscreen also drops during the unloading document cleanup steps, and that exit is the browser
  // tearing the document down rather than the player asking for a window. Restoring the same document
  // from the back/forward cache resumes it, so the flag has to clear again.
  let unloading = false;
  window.addEventListener('pagehide', () => {
    unloading = true;
  });
  window.addEventListener('pageshow', () => {
    unloading = false;
  });
  document.addEventListener('fullscreenchange', () => {
    if (!unloading) persist(isFullscreen() ? 'fullscreen' : 'window');
  });
  if (plan === 'restore') armFirstGesture();
}

/**
 * Capture phase on `window` so any first gesture counts, including one the menu, HUD or camera
 * consumes. Nothing is prevented or stopped, so the gesture still reaches its real handler.
 */
function armFirstGesture(): void {
  let pending = false;
  const take = (): void => {
    if (pending) return;
    pending = true;
    // Which inputs count as activation differs by browser and by key, so the hook stays armed until a
    // request the browser accepts actually lands. The accept itself has to disarm it: reading the live
    // mode afterwards would leave it armed for a player who left fullscreen in between.
    void document.documentElement.requestFullscreen().then(disarm, () => {
      pending = false;
    });
  };
  const disarm = (): void => {
    window.removeEventListener('pointerdown', take, true);
    window.removeEventListener('keydown', take, true);
  };
  window.addEventListener('pointerdown', take, true);
  window.addEventListener('keydown', take, true);
}
