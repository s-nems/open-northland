// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { PLAYERS_SIGHT, switchableViewerSeat } from '../../src/game/viewer-seat.js';
import { DEFAULT_KEY_BINDINGS } from '../../src/hud/keybindings.js';
import { installSpectatorKeys } from '../../src/view/spectator-keys.js';

const uninstalls: (() => void)[] = [];
afterEach(() => {
  for (const uninstall of uninstalls.splice(0)) uninstall();
});

/** The picker lists seats 0, 2 and 5; the second listed is seat 2. */
const SEATS = [0, 2, 5];

function setup(active: () => boolean) {
  const viewer = switchableViewerSeat(PLAYERS_SIGHT);
  uninstalls.push(
    installSpectatorKeys({
      bindings: DEFAULT_KEY_BINDINGS,
      seats: SEATS,
      active,
      watch: viewer.watch,
    }),
  );
  // Stands for the unit controls, which listen in the bubble phase.
  const reached: string[] = [];
  const later = (e: KeyboardEvent): void => {
    reached.push(e.code);
  };
  window.addEventListener('keydown', later);
  uninstalls.push(() => window.removeEventListener('keydown', later));
  const press = (code: string): void => {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
  };
  return { viewer, reached, press };
}

describe('spectator keys', () => {
  it('watch the listed seat, the players sight or the revealed map, and keep the press from the controls', () => {
    const { viewer, reached, press } = setup(() => true);
    press('Digit2');
    expect(viewer.target()).toBe(2);
    press('Backquote');
    expect(viewer.target()).toBeNull();
    press('Digit0');
    expect(viewer.target()).toBe(PLAYERS_SIGHT);
    // Past the list: nothing to watch, and still no control group.
    press('Digit4');
    expect(viewer.target()).toBe(PLAYERS_SIGHT);
    expect(reached).toEqual([]);
  });

  it('leave the digits to the control groups while the viewer does not watch', () => {
    const { viewer, reached, press } = setup(() => false);
    press('Digit2');
    expect(viewer.target()).toBe(PLAYERS_SIGHT);
    expect(reached).toEqual(['Digit2']);
  });
});
