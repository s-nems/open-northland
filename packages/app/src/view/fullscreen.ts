import { servedByBrowser } from './host.js';
import { type MenuSettings, persistSettings, readStoredSettings } from './settings-store.js';

/**
 * The page's window mode. A browser grants fullscreen only inside a user gesture and a document never
 * inherits one, so the mode a player chose is gone by the time the next document loads.
 */

type DisplayMode = MenuSettings['displayMode'];

/**
 * The desktop shell's window fullscreen, exposed by its preload. The shell owns the mode and keeps it
 * across documents and launches; a browser document holds only its own.
 */
interface DesktopFullscreen {
  isActive(): boolean;
  set(active: boolean): Promise<void>;
  /** Returns the unsubscribe call. */
  subscribe(listener: () => void): () => void;
}

declare global {
  interface Window {
    readonly desktop?: { readonly fullscreen: DesktopFullscreen };
  }
}

function desktopFullscreen(): DesktopFullscreen | null {
  return window.desktop?.fullscreen ?? null;
}

/** The mode a fresh profile starts in: the desktop opens fullscreen, a browser can't without a gesture. */
export function defaultDisplayMode(): DisplayMode {
  return desktopFullscreen() !== null ? 'fullscreen' : 'window';
}

export function onFullscreenChange(listener: () => void, signal: AbortSignal): void {
  const desktop = desktopFullscreen();
  if (desktop === null) {
    document.addEventListener('fullscreenchange', listener, { signal });
    return;
  }
  if (signal.aborted) return;
  signal.addEventListener('abort', desktop.subscribe(listener), { once: true });
}

interface KeyboardLock {
  lock(keys: string[]): Promise<void>;
  unlock(): void;
}

function syncFullscreenEscape(): void {
  // Escape never leaves a desktop window's fullscreen, so there is nothing to lock.
  if (desktopFullscreen() !== null) return;
  // Brave exposes the Keyboard API as `null` rather than leaving it out.
  const keyboard = (navigator as Navigator & { keyboard?: KeyboardLock | null }).keyboard;
  if (keyboard === undefined || keyboard === null) return;
  if (isFullscreen()) {
    // A short Escape press belongs to the game's menus while the page is fullscreen.
    void keyboard.lock(['Escape']).catch(() => undefined);
  } else {
    keyboard.unlock();
  }
}

/** A browser document whose window mode this module restores and prompts for. */
export function fullscreenControllable(): boolean {
  return servedByBrowser() && document.fullscreenEnabled;
}

export function isFullscreen(): boolean {
  return desktopFullscreen()?.isActive() ?? document.fullscreenElement !== null;
}

/** A rejected request leaves the window mode untouched, and no caller has anything to recover. */
export function enterFullscreen(): Promise<void> {
  const desktop = desktopFullscreen();
  const request = desktop !== null ? desktop.set(true) : document.documentElement.requestFullscreen();
  return request.catch(() => undefined);
}

export function leaveFullscreen(): Promise<void> {
  const desktop = desktopFullscreen();
  if (desktop !== null) return desktop.set(false).catch(() => undefined);
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
  // A document that never swaps its entry binds for its own lifetime.
  signal: AbortSignal = new AbortController().signal,
): void {
  const plan = displayModePlan({
    optedOut: fullscreenOptedOut(params),
    controllable: fullscreenControllable(),
    alreadyFullscreen: isFullscreen(),
    displayMode: readStoredSettings().displayMode,
  });
  onFullscreenChange(syncFullscreenEscape, signal);
  syncFullscreenEscape();
  if (plan === 'ignore') return;
  // Fullscreen also drops during the unloading document cleanup steps, and that exit is the browser
  // tearing the document down rather than the player asking for a window. Restoring the same document
  // from the back/forward cache resumes it, so the flag has to clear again.
  let unloading = false;
  window.addEventListener(
    'pagehide',
    () => {
      unloading = true;
    },
    { signal },
  );
  window.addEventListener(
    'pageshow',
    () => {
      unloading = false;
    },
    { signal },
  );
  onFullscreenChange(() => {
    if (!unloading) persist(isFullscreen() ? 'fullscreen' : 'window');
  }, signal);
  if (plan === 'restore') armFirstGesture(signal);
}

/**
 * Capture phase on `window` so any first gesture counts, including one the menu, HUD or camera
 * consumes. Nothing is prevented or stopped, so the gesture still reaches its real handler.
 */
function armFirstGesture(signal: AbortSignal): void {
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
  window.addEventListener('pointerdown', take, { capture: true, signal });
  window.addEventListener('keydown', take, { capture: true, signal });
}
