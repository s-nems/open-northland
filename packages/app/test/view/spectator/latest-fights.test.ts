import type { Entity, HalfCellNode, SimEvent } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { FIGHT_AREA_RADIUS_NODES } from '../../../src/hud/tool-panel/messages/fight-areas.js';
import {
  createLatestFights,
  FIGHT_SPOTS_KEPT,
  type FightSpot,
  type LatestFights,
} from '../../../src/view/spectator/latest-fights.js';
import { type Ent, snapshotOf } from '../../support/snapshot.js';

const e = (id: number): Entity => id as Entity;

const RED = 0;
const BLUE = 1;
const RED_MAN = 1;
const BLUE_MAN = 2;
const WOLF = 3;
const RED_WOMAN = 4;
const GONE = 99;

const owned = (id: number, player: number): Ent => ({ id, components: { Owner: { player } } });
const WORLD = snapshotOf([
  owned(RED_MAN, RED),
  owned(BLUE_MAN, BLUE),
  { id: WOLF, components: {} },
  owned(RED_WOMAN, RED),
]);

function melee(attackerPlayer: number | undefined, target: number, at: HalfCellNode): SimEvent {
  return {
    kind: 'combatHit',
    damage: 10,
    targetMaxHealth: 100,
    attacker: e(50),
    ...(attackerPlayer === undefined ? {} : { attackerPlayer }),
    target: e(target),
    at,
  };
}

function shot(shooterPlayer: number, target: number, at: HalfCellNode, collateral: boolean): SimEvent {
  return {
    kind: 'projectileHit',
    damage: 10,
    targetMaxHealth: 100,
    projectile: e(60),
    shooter: e(61),
    shooterPlayer,
    ...(collateral ? { collateral: true } : {}),
    target: e(target),
    munitionType: 1,
    at,
  };
}

/** Every kept spot, newest first, as repeated presses walk them. */
function cycle(fights: LatestFights): FightSpot[] {
  const out: FightSpot[] = [];
  let spot = fights.next(null);
  while (spot !== null && !out.some((seen) => seen.id === spot?.id)) {
    out.push(spot);
    spot = fights.next(spot.id);
  }
  return out;
}

/** Far enough apart along a row that no two count as one fight. */
const farSpot = (index: number): HalfCellNode => ({ hx: index * (FIGHT_AREA_RADIUS_NODES + 1) * 2, hy: 0 });

describe('latest fights', () => {
  it('keep only blows one seat lands on another seat', () => {
    const fights = createLatestFights();
    fights.record(
      [
        melee(RED, WOLF, { hx: 0, hy: 0 }), // a hunt
        melee(undefined, RED_MAN, { hx: 200, hy: 0 }), // a wolf's bite
        melee(RED, RED_WOMAN, { hx: 400, hy: 0 }), // the seat's own
        shot(RED, BLUE_MAN, { hx: 600, hy: 0 }, true), // a side not at war
        melee(BLUE, GONE, { hx: 800, hy: 0 }), // a victim already reaped
        shot(BLUE, RED_MAN, { hx: 1000, hy: 0 }, false),
      ],
      WORLD,
    );
    expect(cycle(fights).map((spot) => spot.at.hx)).toEqual([1000]);
  });

  it('move one battle to its latest blow and keep it one spot', () => {
    const fights = createLatestFights();
    fights.record([melee(RED, BLUE_MAN, { hx: 10, hy: 10 })], WORLD);
    fights.record([melee(RED, BLUE_MAN, { hx: 500, hy: 10 })], WORLD);
    fights.record([melee(BLUE, RED_MAN, { hx: 10 + FIGHT_AREA_RADIUS_NODES / 2, hy: 10 })], WORLD);
    expect(cycle(fights).map((spot) => spot.at.hx)).toEqual([10 + FIGHT_AREA_RADIUS_NODES / 2, 500]);
  });

  it('keep the newest distinct fights and start from the newest once the last one is gone', () => {
    const fights = createLatestFights();
    const first = farSpot(0);
    fights.record([melee(RED, BLUE_MAN, first)], WORLD);
    const oldest = fights.next(null);
    for (let index = 1; index <= FIGHT_SPOTS_KEPT; index++) {
      fights.record([melee(RED, BLUE_MAN, farSpot(index))], WORLD);
    }
    expect(cycle(fights).map((spot) => spot.at.hx)).toEqual(
      Array.from({ length: FIGHT_SPOTS_KEPT }, (_, i) => farSpot(FIGHT_SPOTS_KEPT - i).hx),
    );
    expect(fights.next(oldest?.id ?? null)?.at).toEqual(farSpot(FIGHT_SPOTS_KEPT));
  });
});
