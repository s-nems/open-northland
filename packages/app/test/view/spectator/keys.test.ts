// @vitest-environment jsdom
import type { Camera } from '@open-northland/render';
import type { Entity, HalfCellNode, SimEvent } from '@open-northland/sim';
import { afterEach, describe, expect, it } from 'vitest';
import { PLAYERS_SIGHT, switchableViewerSeat } from '../../../src/game/viewer-seat.js';
import { DEFAULT_KEY_BINDINGS } from '../../../src/hud/keybindings.js';
import { installSpectatorKeys } from '../../../src/view/spectator/keys.js';
import { createLatestFights, type LatestFights } from '../../../src/view/spectator/latest-fights.js';
import { snapshotOf } from '../../support/snapshot.js';

const uninstalls: (() => void)[] = [];
afterEach(() => {
  for (const uninstall of uninstalls.splice(0)) uninstall();
});

/** The picker lists seats 0, 2 and 5; the second listed is seat 2. */
const SEATS = [0, 2, 5];

const RED_MAN = 1;
const BLUE_MAN = 2;
const WORLD = snapshotOf([
  { id: RED_MAN, components: { Owner: { player: 0 } } },
  { id: BLUE_MAN, components: { Owner: { player: 1 } } },
]);

/** A blow from red on blue at `at`. */
const blow = (at: HalfCellNode): SimEvent => ({
  kind: 'combatHit',
  damage: 10,
  targetMaxHealth: 100,
  attacker: RED_MAN as Entity,
  attackerPlayer: 0,
  target: BLUE_MAN as Entity,
  at,
});

/** Two fights far apart, the one at hx 10 the newer. */
function twoFights(): LatestFights {
  const fights = createLatestFights();
  fights.record([blow({ hx: 400, hy: 40 })], WORLD);
  fights.record([blow({ hx: 10, hy: 10 })], WORLD);
  return fights;
}

function setup(active: () => boolean) {
  const viewer = switchableViewerSeat(PLAYERS_SIGHT);
  let camera: Camera = { offsetX: 0, offsetY: 0 };
  const centred: HalfCellNode[] = [];
  uninstalls.push(
    installSpectatorKeys({
      bindings: DEFAULT_KEY_BINDINGS,
      seats: SEATS,
      active,
      watch: viewer.watch,
      fights: twoFights(),
      camera: () => camera,
      centreOn: (at) => {
        centred.push(at);
        camera = { offsetX: at.hx, offsetY: at.hy };
      },
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
  return {
    viewer,
    centred,
    reached,
    press,
    moveCamera: (offsetX: number) => {
      camera = { offsetX, offsetY: 0 };
    },
  };
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

  it('step through the fights while the camera stays put, and start over once it moved', () => {
    const { centred, press, moveCamera } = setup(() => true);
    press('KeyJ');
    press('KeyJ');
    press('KeyJ');
    moveCamera(500);
    press('KeyJ');
    expect(centred.map((at) => at.hx)).toEqual([10, 400, 10, 10]);
  });
});
