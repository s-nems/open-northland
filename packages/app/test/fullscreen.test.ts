import { describe, expect, it } from 'vitest';
import { type DisplayModeEnv, displayModePlan } from '../src/view/fullscreen.js';

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
