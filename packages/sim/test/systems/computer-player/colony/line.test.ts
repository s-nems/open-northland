import { describe, expect, it } from 'vitest';
import { Rider, Settler, Vehicle, VehicleStock } from '../../../../src/components/index.js';
import type { Entity } from '../../../../src/ecs/world.js';
import {
  exportSaveGame,
  parseSaveGame,
  restoreSimulation,
  type Simulation,
  serializeSaveGame,
} from '../../../../src/index.js';
import {
  colonyMember,
  everyBuildingOf,
  everySettlerOf,
  homeSettlers,
} from '../../../../src/systems/ai-shared/home-roster.js';
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
import { SEAT, UNARMED, VIKING, WOOD } from '../support.js';

const SITE_DUE_TICKS = minutesToTicks(2);
const SCOUT_DUE_TICKS = minutesToTicks(12);
const LANDING_DUE_TICKS = minutesToTicks(16);
const LEG_DUE_TICKS = minutesToTicks(8);
const ROUND_DUE_TICKS = minutesToTicks(30);
const AFTER_SAVE_TICKS = minutesToTicks(3);
const SECOND_SHIP_AT = { x: 90, y: 100 };
const SITE_NEAR = 4;
const ENEMY = 5;

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

describe('an overrun colony', () => {
  it('is abandoned with no store standing and an enemy in sight, and its survivors sail home', () => {
    const { sim, ship } = linedWorld();
    const site = colonyState(sim)?.site;
    if (site === undefined) throw new Error('no site');
    const ctx = ctxOf(sim);
    const home = new Set(homeSettlers(sim.world, ctx, SEAT));
    const crew = colonyState(sim)?.line?.crew ?? [];
    const settlers = everySettlerOf(sim.world, SEAT).filter((e) => !home.has(e) && !crew.includes(e));
    for (const e of everyBuildingOf(sim.world, SEAT))
      if (colonyMember(sim.world, ctx, SEAT, e)) sim.world.destroy(e);
    sim.enqueueSetup({
      kind: 'spawnSettler',
      jobType: UNARMED,
      x: site.hx + SITE_NEAR,
      y: site.hy,
      tribe: VIKING,
      owner: ENEMY,
    });
    expect(stepUntil(sim, LEG_DUE_TICKS, () => colonyState(sim)?.phase === 'abandoned')).toBe(true);
    expect(colonyState(sim)?.people).toEqual([]);
    expect(stepUntil(sim, ROUND_DUE_TICKS, () => colonyState(sim)?.line === null)).toBe(true);
    sim.step();
    const back = homeSettlers(sim.world, ctxOf(sim), SEAT).filter((e) => settlers.includes(e));
    expect(back.length).toBeGreaterThan(0);
    expect(sim.world.get(ship, Vehicle).passengers.every((seat) => seat === null)).toBe(true);
    const placed = colonyState(sim)?.builds.filter((b) => b.placed).length;
    stepUntil(sim, AFTER_SAVE_TICKS, () => false);
    expect(colonyState(sim)?.builds.filter((b) => b.placed).length).toBe(placed);
  });

  it('with nobody left is given up, and the ship goes free at home', () => {
    const { sim, ship } = linedWorld();
    const crew = colonyState(sim)?.line?.crew ?? [];
    const ctx = ctxOf(sim);
    const home = new Set(homeSettlers(sim.world, ctx, SEAT));
    for (const e of everySettlerOf(sim.world, SEAT))
      if (!home.has(e) && !crew.includes(e)) sim.world.destroy(e);
    expect(stepUntil(sim, LEG_DUE_TICKS, () => colonyState(sim)?.phase === 'abandoned')).toBe(true);
    expect(stepUntil(sim, ROUND_DUE_TICKS, () => colonyState(sim)?.line === null)).toBe(true);
    sim.step();
    expect(sim.world.get(ship, Vehicle).passengers.every((seat) => seat === null)).toBe(true);
    expect(sim.world.tryGet(crew[0] as Entity, Settler)).toBeDefined();
    expect(homeSettlers(sim.world, ctxOf(sim), SEAT)).toContain(crew[0]);
  });
});
