export const CONFINE_MODES = ['never', 'fullscreen', 'always'] as const;
/** When the cursor is held inside the game window: in no mode, only fullscreen, or windowed too. */
export type ConfineMode = (typeof CONFINE_MODES)[number];

export function parseConfineMode(value: unknown): ConfineMode | null {
  return CONFINE_MODES.find((mode) => mode === value) ?? null;
}

/** Development and scripted runs leave the cursor alone unless this is `1`; `0` frees a packaged build. */
export const CURSOR_CONFINE_ENV = 'ON_DESKTOP_CURSOR_CONFINE';

export function cursorConfineWanted(
  packaged: boolean,
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  const choice = env[CURSOR_CONFINE_ENV];
  return choice === undefined ? packaged : choice === '1';
}

export interface ScreenRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The operating system's part; rectangles are in the units its cursor calls take. */
export interface CursorHold {
  /** How often `hold` must run to keep the cursor inside, ms. */
  readonly intervalMs: number;
  hold(rect: ScreenRect): void;
  release(): void;
  /** Whether a mouse button the player drags a window frame with is down. */
  frameButtonHeld(): boolean;
}

/** The slice of the game window the confinement reads. */
export interface ConfinedWindow {
  isFocused(): boolean;
  isFullScreen(): boolean;
  /** The window's outer rectangle in the units of `CursorHold`. */
  holdRect(): ScreenRect;
}

export interface CursorConfine {
  setMode(mode: ConfineMode): void;
  /** Re-read the window after its focus or mode changed. */
  sync(): void;
  /** The player began moving or resizing the window by its frame: free the cursor until the button lifts. */
  frameDragStarted(): void;
  dispose(): void;
}

/** The part of `rect` inside `area`. */
export function rectWithin(rect: ScreenRect, area: ScreenRect): ScreenRect {
  const x = Math.max(rect.x, area.x);
  const y = Math.max(rect.y, area.y);
  return {
    x,
    y,
    width: Math.min(rect.x + rect.width, area.x + area.width) - x,
    height: Math.min(rect.y + rect.height, area.y + area.height) - y,
  };
}

export function createCursorConfine(win: ConfinedWindow, hold: CursorHold): CursorConfine {
  let mode: ConfineMode = 'never';
  let frameDrag = false;
  // A native call that fails once would fail on every tick, so the cursor goes free for the run.
  let failed = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  const wanted = (): boolean =>
    !failed && mode !== 'never' && win.isFocused() && (mode === 'always' || win.isFullScreen());
  const release = (): void => {
    try {
      hold.release();
    } catch {
      failed = true;
    }
  };
  const stop = (): void => {
    if (timer === null) return;
    clearInterval(timer);
    timer = null;
    frameDrag = false;
    release();
  };
  const enforce = (): void => {
    try {
      if (frameDrag) {
        if (hold.frameButtonHeld()) return;
        frameDrag = false;
      }
      hold.hold(win.holdRect());
    } catch {
      failed = true;
      stop();
    }
  };
  const sync = (): void => {
    if (!wanted()) {
      stop();
      return;
    }
    timer ??= setInterval(enforce, hold.intervalMs);
    enforce();
  };
  return {
    setMode: (next) => {
      mode = next;
      sync();
    },
    sync,
    frameDragStarted: () => {
      if (timer === null || frameDrag) return;
      frameDrag = true;
      release();
      if (failed) stop();
    },
    dispose: stop,
  };
}
