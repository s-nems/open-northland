import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type DisplayModeEnv,
  defaultDisplayMode,
  displayModePlan,
  enterFullscreen,
  isFullscreen,
  leaveFullscreen,
  onFullscreenChange,
} from '../src/view/fullscreen.js';

/** A browser document opened by a player who last played in a window. */
const WINDOWED: DisplayModeEnv = {
  optedOut: false,
  controllable: true,
  alreadyFullscreen: false,
  displayMode: 'window',
};

describe('displayModePlan', () => {
  it('records what the player does to a window it has no stored fullscreen to take back', () => {
    expect(displayModePlan(WINDOWED)).toBe('track');
  });

  it('takes a stored fullscreen back, since the document opens windowed either way', () => {
    expect(displayModePlan({ ...WINDOWED, displayMode: 'fullscreen' })).toBe('restore');
  });

  it('has nothing to take back when the document is already fullscreen', () => {
    expect(displayModePlan({ ...WINDOWED, displayMode: 'fullscreen', alreadyFullscreen: true })).toBe(
      'track',
    );
  });

  it('leaves the window to the desktop shell but still records its mode', () => {
    expect(displayModePlan({ ...WINDOWED, controllable: false, displayMode: 'fullscreen' })).toBe('track');
  });

  it('never touches or records a session that opted out', () => {
    expect(displayModePlan({ ...WINDOWED, optedOut: true })).toBe('ignore');
    expect(displayModePlan({ ...WINDOWED, optedOut: true, displayMode: 'fullscreen' })).toBe('ignore');
  });
});

describe('the desktop shell window', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** A stand-in for the desktop preload: the window's mode flips when the shell is asked. */
  function stubDesktop() {
    let active = false;
    const listeners = new Set<() => void>();
    const fullscreen = {
      isActive: () => active,
      set: vi.fn(async (next: boolean) => {
        active = next;
        for (const listener of listeners) listener();
      }),
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
    vi.stubGlobal('window', { desktop: { fullscreen } });
    vi.stubGlobal('document', { fullscreenElement: null });
    return { fullscreen, listeners };
  }

  it('reads and drives the shell instead of the document', async () => {
    const { fullscreen } = stubDesktop();
    await enterFullscreen();
    expect(fullscreen.set).toHaveBeenLastCalledWith(true);
    expect(isFullscreen()).toBe(true);
    await leaveFullscreen();
    expect(fullscreen.set).toHaveBeenLastCalledWith(false);
    expect(isFullscreen()).toBe(false);
  });

  it('hears every shell change until its signal aborts', async () => {
    const { listeners } = stubDesktop();
    const scope = new AbortController();
    const heard = vi.fn();
    onFullscreenChange(heard, scope.signal);
    await enterFullscreen();
    expect(heard).toHaveBeenCalledTimes(1);
    scope.abort();
    expect(listeners.size).toBe(0);
  });

  it('opens a fresh desktop profile fullscreen and a browser one windowed', () => {
    stubDesktop();
    expect(defaultDisplayMode()).toBe('fullscreen');
    vi.stubGlobal('window', {});
    expect(defaultDisplayMode()).toBe('window');
  });
});
