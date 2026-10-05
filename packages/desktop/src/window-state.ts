import { readFileSync, renameSync, writeFileSync } from 'node:fs';

/** The window's mode and normal bounds, kept in the profile so a relaunch reopens it as it closed. */
export const WINDOW_STATE_FILE = 'window-state.json';
export const WINDOW_STATE_VERSION = 1;

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface WindowState {
  readonly version: typeof WINDOW_STATE_VERSION;
  readonly fullscreen: boolean;
  readonly maximized: boolean;
  /** The bounds outside fullscreen and maximize; `null` until the window first closes. */
  readonly bounds: Rect | null;
}

/** A game opens fullscreen on its first launch. */
export const FIRST_RUN_WINDOW_STATE: WindowState = {
  version: WINDOW_STATE_VERSION,
  fullscreen: true,
  maximized: false,
  bounds: null,
};

/** Share of the work area a window takes when it has no remembered bounds that still fit a display. */
const DEFAULT_WINDOW_SHARE = 0.8;
/** How much of a remembered window must stay on some display, per axis, for its bounds to be kept. */
const MIN_VISIBLE_PX = 120;

function isRect(value: unknown): value is Rect {
  if (typeof value !== 'object' || value === null) return false;
  const rect = value as Record<string, unknown>;
  return (
    (['x', 'y', 'width', 'height'] as const).every(
      (key) => typeof rect[key] === 'number' && Number.isInteger(rect[key]),
    ) &&
    (rect.width as number) > 0 &&
    (rect.height as number) > 0
  );
}

/** Anything but this version's exact shape starts over from the first-run state. */
export function parseWindowState(raw: unknown): WindowState {
  if (typeof raw !== 'object' || raw === null) return FIRST_RUN_WINDOW_STATE;
  const record = raw as Record<string, unknown>;
  if (
    record.version !== WINDOW_STATE_VERSION ||
    typeof record.fullscreen !== 'boolean' ||
    typeof record.maximized !== 'boolean' ||
    !(record.bounds === null || isRect(record.bounds))
  ) {
    return FIRST_RUN_WINDOW_STATE;
  }
  return {
    version: WINDOW_STATE_VERSION,
    fullscreen: record.fullscreen,
    maximized: record.maximized,
    bounds: record.bounds,
  };
}

export function readWindowState(path: string): WindowState {
  try {
    return parseWindowState(JSON.parse(readFileSync(path, 'utf8')));
  } catch {
    return FIRST_RUN_WINDOW_STATE;
  }
}

/** Synchronous, because it runs while the window closes and the app may quit right after. */
export function writeWindowState(path: string, state: WindowState): void {
  const staged = `${path}.tmp`;
  writeFileSync(staged, JSON.stringify(state));
  renameSync(staged, path);
}

function overlap(a: Rect, b: Rect): { readonly width: number; readonly height: number } {
  return {
    width: Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
    height: Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y),
  };
}

/** The work area holding most of `rect`, among those still showing enough of it. */
function homeArea(rect: Rect, workAreas: readonly Rect[]): Rect | undefined {
  let home: Rect | undefined;
  let homeShare = 0;
  for (const area of workAreas) {
    const shared = overlap(rect, area);
    if (shared.width < MIN_VISIBLE_PX || shared.height < MIN_VISIBLE_PX) continue;
    const share = shared.width * shared.height;
    if (share > homeShare) {
      home = area;
      homeShare = share;
    }
  }
  return home;
}

/**
 * Remembered bounds while a display still shows enough of them, moved and shrunk into the work area of
 * the display holding most of them; otherwise a window centred on the primary work area. Fullscreen and
 * maximize open on the display these bounds sit on.
 */
export function placeWindow(saved: Rect | null, workAreas: readonly Rect[], primary: Rect): Rect {
  const home = saved === null ? undefined : homeArea(saved, workAreas);
  if (saved !== null && home !== undefined) {
    const width = Math.min(saved.width, home.width);
    const height = Math.min(saved.height, home.height);
    return {
      x: Math.min(Math.max(saved.x, home.x), home.x + home.width - width),
      y: Math.min(Math.max(saved.y, home.y), home.y + home.height - height),
      width,
      height,
    };
  }
  const width = Math.round(primary.width * DEFAULT_WINDOW_SHARE);
  const height = Math.round(primary.height * DEFAULT_WINDOW_SHARE);
  return {
    x: primary.x + Math.round((primary.width - width) / 2),
    y: primary.y + Math.round((primary.height - height) / 2),
    width,
    height,
  };
}
