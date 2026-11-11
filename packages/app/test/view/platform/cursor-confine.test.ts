// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cursorConfined, installCursorConfine } from '../../../src/view/platform/cursor-confine.js';
import { patchStoredSettings } from '../../../src/view/settings/store.js';

/** A stand-in for the desktop preload of a shell that can hold the cursor. */
function stubShell(fullscreen: boolean) {
  const set = vi.fn(async () => undefined);
  vi.stubGlobal('desktop', { cursorConfine: { set }, fullscreen: { isActive: () => fullscreen } });
  return set;
}

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
  window.history.replaceState(null, '', '/');
});

describe('the desktop cursor hold', () => {
  it('hands the shell the stored mode and every later choice', () => {
    const set = stubShell(false);
    installCursorConfine();
    expect(set).toHaveBeenLastCalledWith('always');
    patchStoredSettings({ cursorConfine: 'fullscreen' });
    expect(set).toHaveBeenLastCalledWith('fullscreen');
  });

  it('holds a windowed game only in the always mode', () => {
    stubShell(false);
    expect(cursorConfined()).toBe(true);
    patchStoredSettings({ cursorConfine: 'fullscreen' });
    expect(cursorConfined()).toBe(false);
    stubShell(true);
    expect(cursorConfined()).toBe(true);
  });

  it('never takes the cursor in a scripted session', () => {
    window.history.replaceState(null, '', '/?fullscreen=off');
    const set = stubShell(true);
    installCursorConfine();
    expect(set).toHaveBeenLastCalledWith('never');
    expect(cursorConfined()).toBe(false);
  });

  it('holds nothing in a browser', () => {
    expect(cursorConfined()).toBe(false);
  });
});
