import { describe, expect, it } from 'vitest';
import { Settler } from '../../../../src/components/index.js';
import { everySettlerOf, homeSettlers } from '../../../../src/systems/ai-shared/home-roster.js';
import { minutesToTicks } from '../../../../src/systems/computer-player/game-phase.js';
import { colonyBuildingsOf, colonyState, stepUntil } from '../../../fixtures/colony-islands.js';
import { routedWorld, standingTrader } from '../../../fixtures/colony-scenarios.js';
import { ctxOf } from '../../../fixtures/context.js';
import { CIVILIST, SEAT, UNARMED, VIKING } from '../support.js';

const SITE_NEAR = 4;
const ENEMY = 5;
/** Several of the colony's workforce beats. */
const HELD_TICKS = minutesToTicks(2);
const LEG_DUE_TICKS = minutesToTicks(8);
const ROUND_DUE_TICKS = minutesToTicks(30);
const AFTER_SAVE_TICKS = minutesToTicks(3);

describe('an overrun colony', () => {
  it('is abandoned with no store standing once the enemy in sight outnumbers its men, lets its route go and its survivors sail home', () => {
    const { sim } = routedWorld();
    const site = colonyState(sim)?.site;
    if (site === undefined) throw new Error('no site');
    const trader = standingTrader(sim);
    const ctx = ctxOf(sim);
    const home = new Set(homeSettlers(sim.world, ctx, SEAT));
    const settlers = everySettlerOf(sim.world, SEAT).filter((e) => !home.has(e) && e !== trader);
    for (const e of [...colonyBuildingsOf(sim)]) sim.world.destroy(e);
    const enemies = (count: number): void => {
      for (let i = 0; i < count; i++)
        sim.enqueueSetup({
          kind: 'spawnSettler',
          jobType: UNARMED,
          x: site.hx + SITE_NEAR,
          y: site.hy + i,
          tribe: VIKING,
          owner: ENEMY,
        });
    };
    enemies(1);
    expect(stepUntil(sim, HELD_TICKS, () => colonyState(sim)?.phase === 'abandoned')).toBe(false);
    enemies(settlers.length);
    expect(stepUntil(sim, LEG_DUE_TICKS, () => colonyState(sim)?.phase === 'abandoned')).toBe(true);
    expect(colonyState(sim)?.people).toEqual([]);
    expect(stepUntil(sim, LEG_DUE_TICKS, () => sim.world.get(trader, Settler).jobType === CIVILIST)).toBe(
      true,
    );
    expect(colonyState(sim)?.route).toBeNull();
    const back = (): boolean =>
      homeSettlers(sim.world, ctxOf(sim), SEAT).some((e) => settlers.includes(e) && e !== trader);
    expect(stepUntil(sim, ROUND_DUE_TICKS, back)).toBe(true);
    const placed = colonyState(sim)?.builds.filter((b) => b.placed).length;
    stepUntil(sim, AFTER_SAVE_TICKS, () => false);
    expect(colonyState(sim)?.builds.filter((b) => b.placed).length).toBe(placed);
  });
});
