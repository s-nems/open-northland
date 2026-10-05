import { describe, expect, it, vi } from 'vitest';
import {
  type FullScreenWindow,
  isFullscreenChord,
  isGameSender,
  type KeyInput,
  maximizedAfter,
  setFullScreen,
} from '../src/window-control.js';

type FullScreenEvent = 'enter-full-screen' | 'leave-full-screen';

/** A window whose transition lands only when `land` runs, as a native animation would. */
function fakeWindow(initial: boolean) {
  let active = initial;
  let requested = initial;
  const listeners = new Map<FullScreenEvent, Set<() => void>>([
    ['enter-full-screen', new Set()],
    ['leave-full-screen', new Set()],
  ]);
  const win: FullScreenWindow = {
    isFullScreen: () => active,
    setFullScreen: vi.fn((next: boolean) => {
      requested = next;
    }),
    on: (event: FullScreenEvent, listener: () => void) => listeners.get(event)?.add(listener),
    off: (event: FullScreenEvent, listener: () => void) => listeners.get(event)?.delete(listener),
  };
  const land = (): void => {
    active = requested;
    for (const listener of listeners.get(active ? 'enter-full-screen' : 'leave-full-screen') ?? [])
      listener();
  };
  const listening = (): number => [...listeners.values()].reduce((sum, set) => sum + set.size, 0);
  return { win, land, listening };
}

describe('setFullScreen', () => {
  it('resolves once the transition lands and stops listening', async () => {
    const { win, land, listening } = fakeWindow(false);
    let settled = false;
    const done = setFullScreen(win, true).then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    land();
    await done;
    expect(win.isFullScreen()).toBe(true);
    expect(listening()).toBe(0);
  });

  it('asks nothing of a window already in the requested mode', async () => {
    const { win } = fakeWindow(true);
    await setFullScreen(win, true);
    expect(win.setFullScreen).not.toHaveBeenCalled();
  });

  it('gives up on a transition that never reports', async () => {
    vi.useFakeTimers();
    try {
      const { win, listening } = fakeWindow(false);
      const done = setFullScreen(win, true, 50);
      vi.advanceTimersByTime(50);
      await done;
      expect(win.isFullScreen()).toBe(false);
      expect(listening()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('isFullscreenChord', () => {
  const altEnter: KeyInput = {
    type: 'keyDown',
    key: 'Enter',
    isAutoRepeat: false,
    alt: true,
    control: false,
    meta: false,
    shift: false,
  };

  it('takes a fresh Alt+Enter press', () => {
    expect(isFullscreenChord(altEnter)).toBe(true);
  });

  it('leaves AltGr, other chords, repeats and releases to the game', () => {
    expect(isFullscreenChord({ ...altEnter, control: true })).toBe(false);
    expect(isFullscreenChord({ ...altEnter, shift: true })).toBe(false);
    expect(isFullscreenChord({ ...altEnter, alt: false })).toBe(false);
    expect(isFullscreenChord({ ...altEnter, isAutoRepeat: true })).toBe(false);
    expect(isFullscreenChord({ ...altEnter, type: 'keyUp' })).toBe(false);
  });
});

describe('maximizedAfter', () => {
  it('follows maximize and unmaximize in a window', () => {
    expect(maximizedAfter(false, 'maximize', false)).toBe(true);
    expect(maximizedAfter(true, 'unmaximize', false)).toBe(false);
  });

  it('keeps a maximized window maximized through the unmaximize fullscreen reports', () => {
    expect(maximizedAfter(true, 'unmaximize', true)).toBe(true);
    expect(maximizedAfter(false, 'unmaximize', true)).toBe(false);
  });
});

describe('isGameSender', () => {
  it('accepts only the game window on an app:// page', () => {
    expect(isGameSender(true, 'app://game/index.html')).toBe(true);
    expect(isGameSender(false, 'app://game/index.html')).toBe(false);
    expect(isGameSender(true, 'https://example.com/')).toBe(false);
    expect(isGameSender(true, undefined)).toBe(false);
  });
});
