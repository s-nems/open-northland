import { isAppUrl } from './protocol-routing.js';

/** The slice of a `BrowserWindow` the fullscreen wait needs. */
export interface FullScreenWindow {
  isFullScreen(): boolean;
  setFullScreen(active: boolean): void;
  on(event: 'enter-full-screen', listener: () => void): unknown;
  on(event: 'leave-full-screen', listener: () => void): unknown;
  off(event: 'enter-full-screen', listener: () => void): unknown;
  off(event: 'leave-full-screen', listener: () => void): unknown;
}

/** A transition that never reports its end (a refused macOS Space) stops being awaited. */
export const FULLSCREEN_TRANSITION_TIMEOUT_MS = 3000;

/** Resolves once the window reports the requested mode, or after the timeout. */
export function setFullScreen(
  win: FullScreenWindow,
  active: boolean,
  timeoutMs: number = FULLSCREEN_TRANSITION_TIMEOUT_MS,
): Promise<void> {
  if (win.isFullScreen() === active) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = (): void => {
      clearTimeout(timer);
      win.off('enter-full-screen', settle);
      win.off('leave-full-screen', settle);
      resolve();
    };
    const settle = (): void => {
      if (win.isFullScreen() === active) finish();
    };
    const timer = setTimeout(finish, timeoutMs);
    win.on('enter-full-screen', settle);
    win.on('leave-full-screen', settle);
    win.setFullScreen(active);
  });
}

export interface KeyInput {
  readonly type: string;
  readonly key: string;
  readonly isAutoRepeat: boolean;
  readonly alt: boolean;
  readonly control: boolean;
  readonly meta: boolean;
  readonly shift: boolean;
}

/** Alt+Enter, the PC games' fullscreen toggle. AltGr reports control+alt and is not it. */
export function isFullscreenChord(input: KeyInput): boolean {
  return (
    input.type === 'keyDown' &&
    input.key === 'Enter' &&
    !input.isAutoRepeat &&
    input.alt &&
    !input.control &&
    !input.meta &&
    !input.shift
  );
}

/** Only the game's own window, on an `app://` page, may read or change its mode. */
export function isGameSender(fromGameWindow: boolean, frameUrl: string | undefined): boolean {
  return fromGameWindow && frameUrl !== undefined && isAppUrl(frameUrl);
}

/**
 * Whether the window returns maximized once it leaves fullscreen. macOS reports a fullscreen window as
 * unmaximized, so an unmaximize while fullscreen keeps the windowed state.
 */
export function maximizedAfter(
  maximized: boolean,
  event: 'maximize' | 'unmaximize',
  fullscreen: boolean,
): boolean {
  if (event === 'maximize') return true;
  return fullscreen ? maximized : false;
}
