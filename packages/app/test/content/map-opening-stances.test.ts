import { type Simulation, TICKS_PER_SECOND } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { hasRealIr } from './helpers.js';
import { realMapWorld } from './real-map-world.js';

/**
 * Two maps whose rosters leave most seat pairs without a `diplomacy` row. The original starts such a
 * pair neutral, so both open calmly; read as the sim's hostile default they opened in a brawl.
 */

/** A 15-seat CnMod map whose computer seats have rows toward player 0 only. Under the hostile default
 *  they fought each other, killed one of the named men its `HumansDied` goals guard, and the mission
 *  failed at 63 s. */
const STORY_MAP = 'cn_0';
const STORY_COMPUTER_SEATS = [1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12, 13, 14];
const STORY_SECONDS = 75;

/** A multiplayer map that seats all five humans' starting men together; its rows cover only the
 *  computer traders and pirates. Under the hostile default player 0 lost its last man at 14 s. */
const MULTIPLAYER_MAP = 'wielka_kolonizacja_ii_1_1';
const MULTIPLAYER_COMPUTER_SEATS = [5, 6, 7, 8, 9];
const MULTIPLAYER_SECONDS = 20;

const PLAYER = 0;

/** Building a real map world and running it past a minute takes several seconds. */
const REAL_MAP_TIMEOUT_MS = 60_000;

function blowsWithin(sim: Simulation, seconds: number): number {
  let blows = 0;
  for (let tick = 0; tick < seconds * TICKS_PER_SECOND; tick++) {
    sim.step();
    for (const ev of sim.events.current()) if (ev.kind === 'combatHit') blows++;
  }
  return blows;
}

describe.runIf(hasRealIr())('the opening of a map with unset seat pairs', () => {
  it(
    'keeps the story map at peace and its mission running',
    async () => {
      const { sim } = await realMapWorld({
        mapId: STORY_MAP,
        aiSeats: STORY_COMPUTER_SEATS,
        humanSeats: [PLAYER],
      });
      expect(sim.diplomacyStance(5, 9)).toBe('neutral');
      expect(blowsWithin(sim, STORY_SECONDS)).toBe(0);
      expect(sim.matchOutcome(PLAYER)).toBe('undecided');
    },
    REAL_MAP_TIMEOUT_MS,
  );

  it(
    'lets the multiplayer seats stand together without fighting',
    async () => {
      const { sim } = await realMapWorld({
        mapId: MULTIPLAYER_MAP,
        aiSeats: MULTIPLAYER_COMPUTER_SEATS,
        humanSeats: [PLAYER],
      });
      expect(sim.diplomacyStance(0, 1)).toBe('neutral');
      expect(sim.diplomacyStance(5, 6)).toBe('neutral');
      expect(sim.diplomacyStance(0, 9)).toBe('enemy'); // the pirates' authored row still stands
      expect(blowsWithin(sim, MULTIPLAYER_SECONDS)).toBe(0);
      expect(sim.matchOutcome(PLAYER)).toBe('undecided');
    },
    REAL_MAP_TIMEOUT_MS,
  );
});
