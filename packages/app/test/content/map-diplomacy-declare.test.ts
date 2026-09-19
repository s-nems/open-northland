import { playerCommand, type Simulation, systems } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { hasRealIr } from './helpers.js';
import { realMapWorld } from './real-map-world.js';

/**
 * A seat changing its stance on real maps: a declared war on a multiplayer neighbour that the computer
 * answers, and a story map whose `[playermisc]` rows lock the player's stances.
 */

const PLAYER = 0;

/** Five humans' starting men stand together; player 1 takes the computer here. */
const MULTIPLAYER_MAP = 'wielka_kolonizacja_ii_1_1';
const NEIGHBOUR = 1;
const MULTIPLAYER_COMPUTER_SEATS = [NEIGHBOUR, 5, 6, 7, 8, 9];

/** `relationnotchangeable 0 1` and `relationhide 0 2` among its rows. */
const STORY_MAP = 'cn_0';
const STORY_COMPUTER_SEATS = [1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12, 13, 14];
const LOCKED = 1;
const HIDDEN = 2;

/** One whole sweep of a computer seat's cursor: the original's 20 slots, one per handler round. */
const CURSOR_SWEEP_TICKS = 20 * systems.AI_HANDLER_ROUND_TICKS;

/** Building a real map world and running it for a sweep takes several seconds. */
const REAL_MAP_TIMEOUT_MS = 60_000;

function declareWar(sim: Simulation, other: number): void {
  sim.enqueue(playerCommand(PLAYER, { kind: 'declareDiplomacy', player: PLAYER, other, state: 'enemy' }));
  sim.step();
}

describe.runIf(hasRealIr())('a seat declaring its stance on a real map', () => {
  it(
    'answers a declared war with the computer neighbour turning enemy',
    async () => {
      const { sim } = await realMapWorld({
        mapId: MULTIPLAYER_MAP,
        aiSeats: MULTIPLAYER_COMPUTER_SEATS,
        humanSeats: [PLAYER],
      });
      expect(sim.diplomacyStance(NEIGHBOUR, PLAYER)).toBe('neutral');
      expect(sim.diplomacyLocked(PLAYER, NEIGHBOUR)).toBe(false);
      declareWar(sim, NEIGHBOUR);
      expect(sim.diplomacyStance(PLAYER, NEIGHBOUR)).toBe('enemy');
      sim.run(CURSOR_SWEEP_TICKS);
      expect(sim.diplomacyStance(NEIGHBOUR, PLAYER)).toBe('enemy');
    },
    REAL_MAP_TIMEOUT_MS,
  );

  it(
    'keeps the stances a story map locks, a hidden pair included',
    async () => {
      const { sim } = await realMapWorld({
        mapId: STORY_MAP,
        aiSeats: STORY_COMPUTER_SEATS,
        humanSeats: [PLAYER],
      });
      const before = [sim.diplomacyStance(PLAYER, LOCKED), sim.diplomacyStance(PLAYER, HIDDEN)];
      expect(sim.diplomacyLocked(PLAYER, LOCKED)).toBe(true);
      expect(sim.diplomacyLocked(PLAYER, HIDDEN)).toBe(true);
      declareWar(sim, LOCKED);
      declareWar(sim, HIDDEN);
      expect([sim.diplomacyStance(PLAYER, LOCKED), sim.diplomacyStance(PLAYER, HIDDEN)]).toEqual(before);
    },
    REAL_MAP_TIMEOUT_MS,
  );
});
