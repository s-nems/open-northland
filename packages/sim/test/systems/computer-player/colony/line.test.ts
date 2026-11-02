import { describe, expect, it } from 'vitest';
import { Rider, VehicleStock } from '../../../../src/components/index.js';
import type { Entity } from '../../../../src/ecs/world.js';
import {
  exportSaveGame,
  parseSaveGame,
  restoreSimulation,
  type Simulation,
  serializeSaveGame,
} from '../../../../src/index.js';
import { homeSettlers } from '../../../../src/systems/ai-shared/home-roster.js';
import { minutesToTicks } from '../../../../src/systems/computer-player/game-phase.js';
import { removeVehicle } from '../../../../src/systems/vehicles/index.js';
import {
  colonyContent,
  colonyIslands,
  colonyState,
  colonyWorld,
  FOOD,
  mooredShip,
  SMALL_SHIP,
  stepUntil,
} from '../../../fixtures/colony-islands.js';
import { ctxOf } from '../../../fixtures/context.js';
import { SEAT, WOOD } from '../support.js';

const SITE_DUE_TICKS = minutesToTicks(2);
const SCOUT_DUE_TICKS = minutesToTicks(12);
const LANDING_DUE_TICKS = minutesToTicks(16);
const LEG_DUE_TICKS = minutesToTicks(8);
const ROUND_DUE_TICKS = minutesToTicks(30);
const AFTER_SAVE_TICKS = minutesToTicks(3);
const SECOND_SHIP_AT = { x: 90, y: 100 };

/** A colony landed and its line under way. */
function linedWorld(): { readonly sim: Simulation; readonly ship: Entity } {
  const sim = colonyWorld();
  stepUntil(sim, SITE_DUE_TICKS, () => colonyState(sim) !== undefined);
  mooredShip(sim);
  stepUntil(sim, SCOUT_DUE_TICKS, () => colonyState(sim)?.phase === 'fittingOut');
  const ship = mooredShip(sim, SMALL_SHIP, SECOND_SHIP_AT);
  if (!stepUntil(sim, LANDING_DUE_TICKS, () => (colonyState(sim)?.line ?? null) !== null))
    throw new Error('setup: no line');
  sim.step();
  return { sim, ship };
}

const leg = (sim: Simulation): string | undefined => colonyState(sim)?.line?.leg;

function aboard(sim: Simulation, ship: Entity, good: number): number {
  return sim.world.tryGet(ship, VehicleStock)?.lines.get(good)?.current ?? 0;
}

describe('a colony line', () => {
  it('carries food out and wood home, holding its crew through the round trip', () => {
    const { sim, ship } = linedWorld();
    const crew = [...(colonyState(sim)?.line?.crew ?? [])];
    expect(crew.length).toBeGreaterThan(1);
    expect(stepUntil(sim, LEG_DUE_TICKS, () => leg(sim) === 'loadHome')).toBe(true);
    const ctx = ctxOf(sim);
    for (const e of crew) expect(homeSettlers(sim.world, ctx, SEAT)).not.toContain(e);
    expect(stepUntil(sim, LEG_DUE_TICKS, () => leg(sim) === 'sailOut')).toBe(true);
    expect(aboard(sim, ship, FOOD)).toBeGreaterThan(0);
    const wanted = sim.world.get(ship, VehicleStock).lines;
    for (const line of wanted.values()) expect(line.wanted).toBe(line.current);
    expect(stepUntil(sim, LEG_DUE_TICKS, () => leg(sim) === 'unloadColony')).toBe(true);
    let wood = 0;
    const home = stepUntil(sim, ROUND_DUE_TICKS, () => {
      if (leg(sim) === 'sailHome') wood = Math.max(wood, aboard(sim, ship, WOOD));
      return wood > 0 && leg(sim) === 'loadHome';
    });
    expect(home).toBe(true);
    expect(aboard(sim, ship, WOOD)).toBeLessThan(wood);
    expect(aboard(sim, ship, FOOD)).toBeGreaterThan(0);
    for (const e of crew) expect(sim.world.has(e, Rider)).toBe(true);
  });

  it('owes a ship once its own is sunk, and takes the next free one on', () => {
    const { sim, ship } = linedWorld();
    stepUntil(sim, LEG_DUE_TICKS, () => leg(sim) === 'sailOut');
    removeVehicle(sim.world, ctxOf(sim), ship, 'destroyed');
    sim.step();
    expect(stepUntil(sim, LEG_DUE_TICKS, () => (colonyState(sim)?.line?.ship ?? ship) !== ship)).toBe(true);
    expect(stepUntil(sim, LEG_DUE_TICKS, () => leg(sim) === 'sailOut')).toBe(true);
  });

  it('comes back from a save in mid-line exactly as it would have gone on', () => {
    const { sim } = linedWorld();
    stepUntil(sim, LEG_DUE_TICKS, () => leg(sim) === 'loadHome');
    const saved = parseSaveGame(JSON.parse(serializeSaveGame(exportSaveGame(sim))));
    const copy = restoreSimulation(saved, { content: colonyContent(), map: colonyIslands() });
    expect(leg(copy)).toBe('loadHome');
    expect(copy.hashState()).toBe(sim.hashState());
    for (let t = 0; t < AFTER_SAVE_TICKS; t++) {
      sim.step();
      copy.step();
    }
    expect(leg(copy)).toBe(leg(sim));
    expect(copy.hashState()).toBe(sim.hashState());
  });
});
