import type { CursorHold, ScreenRect } from './confine.js';

type Koffi = typeof import('koffi')['default'];

/** The system reverts a clip on its own (a focus change, a secure desktop), so it is set again this often. */
const WINDOWS_CLIP_INTERVAL_MS = 100;
const VK_LBUTTON = 0x01;
const VK_RBUTTON = 0x02;
/** `GetAsyncKeyState` sets the sign bit of its 16-bit result while the key is down. */
const KEY_DOWN_MASK = 0x8000;

function windowsHold(koffi: Koffi): CursorHold {
  const user32 = koffi.load('user32.dll');
  koffi.struct('RECT', { left: 'long', top: 'long', right: 'long', bottom: 'long' });
  const clipCursor = user32.func('int __stdcall ClipCursor(const RECT *rect)');
  const keyState = user32.func('short __stdcall GetAsyncKeyState(int key)');
  const down = (key: number): boolean => (keyState(key) & KEY_DOWN_MASK) !== 0;
  return {
    intervalMs: WINDOWS_CLIP_INTERVAL_MS,
    hold: (rect) => {
      clipCursor({ left: rect.x, top: rect.y, right: rect.x + rect.width, bottom: rect.y + rect.height });
    },
    release: () => {
      clipCursor(null);
    },
    frameButtonHeld: () => down(VK_LBUTTON) || down(VK_RBUTTON),
  };
}

/**
 * macOS has no cursor clip, so a cursor found outside is put back. A display draws it there for a frame
 * when the check comes late, so the check runs several times per frame; one costs about 40 microseconds.
 */
const MAC_WARP_INTERVAL_MS = 2;
const CORE_GRAPHICS = '/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics';
/** `kCGEventSourceStateCombinedSessionState` and `kCGMouseButtonLeft`. */
const COMBINED_SESSION_STATE = 0;
const LEFT_MOUSE_BUTTON = 0;

export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

/** The nearest point of `rect` to `point`, or null when it is already inside. */
export function pointHeldIn(rect: ScreenRect, point: ScreenPoint): ScreenPoint | null {
  const x = Math.min(Math.max(point.x, rect.x), rect.x + rect.width - 1);
  const y = Math.min(Math.max(point.y, rect.y), rect.y + rect.height - 1);
  return x === point.x && y === point.y ? null : { x, y };
}

function macHold(koffi: Koffi, cursorPoint: () => ScreenPoint): CursorHold {
  const graphics = koffi.load(CORE_GRAPHICS);
  koffi.struct('CGPoint', { x: 'double', y: 'double' });
  const warp = graphics.func('int32_t CGWarpMouseCursorPosition(CGPoint point)');
  const associate = graphics.func('int32_t CGAssociateMouseAndMouseCursorPosition(bool connected)');
  const buttonState = graphics.func('bool CGEventSourceButtonState(int32_t state, uint32_t button)');
  return {
    intervalMs: MAC_WARP_INTERVAL_MS,
    hold: (rect) => {
      const inside = pointHeldIn(rect, cursorPoint());
      if (inside === null) return;
      warp(inside);
      // A warp alone mutes mouse movement for a quarter of a second; re-associating lifts that.
      associate(true);
    },
    release: () => undefined,
    frameButtonHeld: () => buttonState(COMBINED_SESSION_STATE, LEFT_MOUSE_BUTTON) === true,
  };
}

/**
 * The host's way to hold the cursor, or null where there is none: Linux, and any machine whose native
 * call library fails to load. `cursorPoint` reads the cursor in the screen coordinates of the window.
 */
export async function loadCursorHold(
  platform: NodeJS.Platform,
  cursorPoint: () => ScreenPoint,
): Promise<CursorHold | null> {
  if (platform !== 'win32' && platform !== 'darwin') return null;
  try {
    const { default: koffi } = await import('koffi');
    return platform === 'win32' ? windowsHold(koffi) : macHold(koffi, cursorPoint);
  } catch {
    return null;
  }
}
