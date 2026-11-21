import { describe, expect, it } from 'vitest';
import { spotAcceptor } from '../../../src/systems/ai-shared/building-spot.js';
import type { EnemyFire } from '../../../src/systems/ai-shared/military/defence/index.js';
import {
  aiSim,
  ctxOf,
  HOME_TYPE,
  placeHq,
  placeResources,
  RESOURCE_SPOTS,
  SEAT,
  VIKING,
} from '../computer-player/support.js';

const STONE_AT = { x: 40, y: 16 };
const STONE_UNITS = 10;
const NO_ENEMY_FIRE: EnemyFire = { reaches: () => false, around: () => NO_ENEMY_FIRE };

describe('spot acceptor', () => {
  it('keeps each acceptor to its own remembered verdicts on a shared terrain', () => {
    const sim = aiSim();
    placeHq(sim);
    placeResources(sim, [{ ...RESOURCE_SPOTS.stone, ...STONE_AT }], STONE_UNITS);
    sim.step();
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('setup: a map');
    const ctx = ctxOf(sim, sim.tick);
    const centre = { hx: STONE_AT.x, hy: STONE_AT.y };
    const acceptorFor = (keepsDeposits: boolean) =>
      spotAcceptor(sim.world, ctx, terrain, SEAT, HOME_TYPE, VIKING, () => keepsDeposits);
    const keeping = acceptorFor(true);
    const covering = acceptorFor(false);
    const keeps = keeping.around(NO_ENEMY_FIRE, centre, 0);
    const covers = covering.around(NO_ENEMY_FIRE, centre, 0);

    // Asked in turn, twice: the second answers come from what each acceptor remembered.
    expect(keeps(STONE_AT.x, STONE_AT.y)).toBe(false);
    expect(covers(STONE_AT.x, STONE_AT.y)).toBe(true);
    expect(keeps(STONE_AT.x, STONE_AT.y)).toBe(false);
    // The shared cell holds the last judge's verdict: its own refusal, never the other acceptor's.
    expect(keeping.refused(STONE_AT.x, STONE_AT.y)).toBe(true);
    expect(covering.refused(STONE_AT.x, STONE_AT.y)).toBe(false);
    expect(covers(STONE_AT.x, STONE_AT.y)).toBe(true);
    expect(keeping.refused(STONE_AT.x, STONE_AT.y)).toBe(false);
  });
});
