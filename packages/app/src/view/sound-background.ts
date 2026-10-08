import type { GestureSource, ResumableAudio } from './sound-start.js';

/** The page state the audio follows: `document` in the browser. */
export interface PageFocus extends GestureSource {
  readonly hidden: boolean;
  hasFocus(): boolean;
}

/** Audio that hears when the page goes to the background: the game's driver, or the menu's engine. */
export interface PageAudio extends ResumableAudio {
  setPageInBackground(inBackground: boolean): void;
}

export interface PageFocusEnv {
  readonly page?: PageFocus;
  /** Where the window's `focus` and `blur` arrive: `window` in the browser. */
  readonly focusEvents?: GestureSource;
  readonly activation?: Pick<UserActivation, 'hasBeenActive'> | null;
  /** The audio's lifetime: its end drops the listeners. */
  readonly signal: AbortSignal;
}

const PAGE_EVENTS = ['visibilitychange'] as const;
const FOCUS_EVENTS = ['focus', 'blur'] as const;

/**
 * Tell `audio` whether the page is in the background, now and on every change: a hidden tab or an
 * unfocused window. A page back in front also asks for a context the platform paused meanwhile, which
 * an activated document is granted; one never activated waits for {@link startSound}'s gesture.
 */
export function followPageFocus(audio: PageAudio, env: PageFocusEnv): void {
  const {
    page = document,
    focusEvents = window,
    activation = navigator.userActivation ?? null,
    signal,
  } = env;
  if (signal.aborted) return;
  const sync = (): void => {
    const inBackground = page.hidden || !page.hasFocus();
    audio.setPageInBackground(inBackground);
    if (!inBackground && !audio.started && activation?.hasBeenActive === true) {
      void audio.resume().catch(() => undefined);
    }
  };
  for (const event of PAGE_EVENTS) page.addEventListener(event, sync);
  for (const event of FOCUS_EVENTS) focusEvents.addEventListener(event, sync);
  signal.addEventListener('abort', () => {
    for (const event of PAGE_EVENTS) page.removeEventListener(event, sync);
    for (const event of FOCUS_EVENTS) focusEvents.removeEventListener(event, sync);
  });
  sync();
}
