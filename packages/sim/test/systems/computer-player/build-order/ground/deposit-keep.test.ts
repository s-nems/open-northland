import { describe, expect, it } from 'vitest';
import type { EnemyFire } from '../../../../../src/systems/ai-shared/military/defence/index.js';
import { DEPOSIT_SCRAP_UNITS } from '../../../../../src/systems/computer-player/build-order/ground/deposit-keep.js';
import { seatSpotAcceptor } from '../../../../../src/systems/computer-player/build-order/ground/plots.js';
import {
  aiSim,
  collectModule,
  ctxOf,
  HOME_TYPE,
  makeAiSeat,
  placeHq,
  placeResources,
  RESOURCE_SPOTS,
  SEAT,
  spawnMen,
  VIKING,
} from '../../support.js';

const STONE_AT = { x: 40, y: 16 };
const NO_ENEMY_FIRE: EnemyFire = { reaches: () => false, around: () => NO_ENEMY_FIRE };
/** Men enough for the opening's gatherer posts. */
const MEN = 8;

/** Whether the seat may anchor a home right on a stone node of `remaining` units, its gatherers posted
 *  by the workforce when it has `men`. */
function homeOnStone(remaining: number, men: number): boolean {
  const sim = aiSim();
  placeHq(sim);
  placeResources(sim, [{ ...RESOURCE_SPOTS.stone, ...STONE_AT }], remaining);
  spawnMen(sim, men);
  makeAiSeat(sim, SEAT);
  sim.step();
  for (const command of collectModule.run(sim.world, ctxOf(sim), SEAT)) sim.enqueueSetup(command);
  sim.step();
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('setup: a map');
  const accept = seatSpotAcceptor(sim.world, ctxOf(sim, sim.tick), terrain, SEAT, HOME_TYPE, VIKING).around(
    NO_ENEMY_FIRE,
    { hx: STONE_AT.x, hy: STONE_AT.y },
    0,
  );
  return accept(STONE_AT.x, STONE_AT.y);
}

describe('deposit keep', () => {
  const PLENTY = DEPOSIT_SCRAP_UNITS + 3;

  it('keeps a seat off a deposit while its gatherers work the good', () => {
    expect(homeOnStone(PLENTY, MEN)).toBe(false);
  });

  it('builds over a deposit nobody works, or over a last scrap', () => {
    expect(homeOnStone(PLENTY, 0)).toBe(true);
    expect(homeOnStone(DEPOSIT_SCRAP_UNITS, MEN)).toBe(true);
  });
});
