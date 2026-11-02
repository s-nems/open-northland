import { describe, expect, it } from 'vitest';
import {
  aiControlEntity,
  Health,
  Rider,
  Settler,
  Vehicle,
  VehicleStock,
} from '../../../../src/components/index.js';
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
import { seatBaseOf } from '../../../../src/systems/computer-player/base.js';
import { colonySmallShips } from '../../../../src/systems/computer-player/colony/fleet.js';
import { minutesToTicks } from '../../../../src/systems/computer-player/game-phase.js';
import { freeShips } from '../../../../src/systems/computer-player/military/operations/landing.js';
import { strandedShip } from '../../../../src/systems/computer-player/sea-route.js';
import { interactionCell } from '../../../../src/systems/settlers/targets/index.js';
import { removeVehicle } from '../../../../src/systems/vehicles/index.js';
import {
  colonyContent,
  colonyIslands,
  colonyState,
  colonyWorld,
  editColony,
  FOOD,
  mooredShip,
  SMALL_SHIP,
  stepUntil,
} from '../../../fixtures/colony-islands.js';
import { ctxOf } from '../../../fixtures/context.js';
import { BUILDER, SEAT, UNARMED, VIKING, WOOD } from '../support.js';

const SITE_DUE_TICKS = minutesToTicks(2);
const SCOUT_DUE_TICKS = minutesToTicks(12);
const LANDING_DUE_TICKS = minutesToTicks(16);
const LEG_DUE_TICKS = minutesToTicks(8);
const ROUND_DUE_TICKS = minutesToTicks(30);
const AFTER_SAVE_TICKS = minutesToTicks(3);
const SECOND_SHIP_AT = { x: 90, y: 100 };
/** Off the colony's shore. */
const STRAY_AT = { x: 138, y: 60 };
const SITE_NEAR = 4;
const HULL_HIT = 100;
const LINE_CREW_LEAST = 2;
const STRAIT_MID_HX = 114;
const STRAIT_ACROSS = [30, 60, 90];
const ENEMY = 5;
const CHILD_MALE = 4;
const IDLE_MEN = 40;
const IDLE_STEP = 2;

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

/** The land under the seat's headquarters. */
function homeLandOfSeat(sim: Simulation): number {
  const ctx = ctxOf(sim);
  const terrain = ctx.terrain;
  const base = seatBaseOf(sim.world, ctx, SEAT);
  if (terrain === undefined || base === null) throw new Error('setup: no base');
  return terrain.componentOf(interactionCell(sim.world, ctx, terrain, base));
}

const leg = (sim: Simulation): string | undefined => colonyState(sim)?.line?.leg;

/** Who stands on the colony or rides for it. */
const colonyPeople = (sim: Simulation): number => {
  const home = new Set(homeSettlers(sim.world, ctxOf(sim), SEAT));
  return everySettlerOf(sim.world, SEAT).filter((e) => !home.has(e)).length;
};

function aboard(sim: Simulation, ship: Entity, good: number): number {
  return sim.world.tryGet(ship, VehicleStock)?.lines.get(good)?.current ?? 0;
}

describe('a ship left without a helm', () => {
  it('is brought home from the colony by a man of the colony, who steps off there', () => {
    const { sim } = linedWorld();
    expect(stepUntil(sim, ROUND_DUE_TICKS, () => colonyState(sim)?.phase === 'running')).toBe(true);
    const stray = mooredShip(sim, SMALL_SHIP, STRAY_AT);
    const land = colonyState(sim)?.land;
    const ctx = ctxOf(sim);
    const terrain = ctx.terrain;
    const mooring = sim.world.get(stray, Vehicle).mooring;
    if (land === undefined || terrain === undefined || mooring === null) throw new Error('setup: unmoored');
    expect(terrain.componentOf(terrain.nodeAt(mooring.hx, mooring.hy))).toBe(land);
    const env = { world: sim.world, ctx, terrain, seat: SEAT };
    const home = homeLandOfSeat(sim);
    expect(stepUntil(sim, ROUND_DUE_TICKS, () => freeShips(env, home).includes(stray))).toBe(true);
  });

  it('counts out of the fleet once it lies adrift with nobody aboard', () => {
    const sim = colonyWorld();
    sim.step();
    const ship = mooredShip(sim);
    expect(strandedShip(sim.world, ctxOf(sim), SEAT, ship)).toBe(false);
    sim.world.mut(ship, Vehicle).moored = false;
    expect(strandedShip(sim.world, ctxOf(sim), SEAT, ship)).toBe(true);
  });
});

describe('a colony line', () => {
  it('carries food out and wood home, holding its crew through the round trip', () => {
    const { sim, ship } = linedWorld();
    const crew = [...(colonyState(sim)?.line?.crew ?? [])];
    expect(crew.length).toBeGreaterThan(1);
    expect(stepUntil(sim, LEG_DUE_TICKS, () => leg(sim) === 'loadHome')).toBe(true);
    const ctx = ctxOf(sim);
    for (const e of crew) expect(homeSettlers(sim.world, ctx, SEAT)).not.toContain(e);
    expect(stepUntil(sim, LEG_DUE_TICKS, () => leg(sim) === 'sailOut')).toBe(true);
    sim.step();
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

  it('brings the hands a colony lacks over the line', () => {
    const { sim } = linedWorld();
    const before = colonyPeople(sim);
    expect(stepUntil(sim, ROUND_DUE_TICKS, () => colonyPeople(sim) > before)).toBe(true);
  });

  it('sends men with no work left home by the next ship', () => {
    const { sim } = linedWorld();
    const site = colonyState(sim)?.site;
    if (site === undefined) throw new Error('no site');
    expect(stepUntil(sim, ROUND_DUE_TICKS, () => colonyState(sim)?.phase === 'running')).toBe(true);
    const idle: Entity[] = [];
    const before = new Set(everySettlerOf(sim.world, SEAT));
    for (let i = 0; i < IDLE_MEN; i++)
      sim.enqueueSetup({
        kind: 'spawnSettler',
        jobType: BUILDER,
        x: site.hx + IDLE_STEP * i,
        y: site.hy,
        tribe: VIKING,
        owner: SEAT,
      });
    sim.step();
    for (const e of everySettlerOf(sim.world, SEAT)) if (!before.has(e)) idle.push(e);
    expect(idle).toHaveLength(IDLE_MEN);
    const homeAgain = (): boolean => {
      const home = homeSettlers(sim.world, ctxOf(sim), SEAT);
      return idle.some((e) => home.includes(e));
    };
    expect(stepUntil(sim, ROUND_DUE_TICKS, homeAgain)).toBe(true);
  });

  it('owes a ship once its own is sunk, and takes the next free one on', () => {
    const { sim, ship } = linedWorld();
    stepUntil(sim, LEG_DUE_TICKS, () => leg(sim) === 'sailOut');
    removeVehicle(sim.world, ctxOf(sim), ship, 'destroyed');
    sim.step();
    expect(stepUntil(sim, LEG_DUE_TICKS, () => (colonyState(sim)?.line?.ship ?? ship) !== ship)).toBe(true);
    expect(stepUntil(sim, LEG_DUE_TICKS, () => leg(sim) === 'sailOut')).toBe(true);
  });

  it('owes a ship sunk before the line began', () => {
    const sim = colonyWorld();
    stepUntil(sim, SITE_DUE_TICKS, () => colonyState(sim) !== undefined);
    mooredShip(sim);
    stepUntil(sim, SCOUT_DUE_TICKS, () => colonyState(sim)?.phase === 'fittingOut');
    const ship = mooredShip(sim, SMALL_SHIP, SECOND_SHIP_AT);
    stepUntil(sim, LANDING_DUE_TICKS, () => colonyState(sim)?.phase === 'founding');
    removeVehicle(sim.world, ctxOf(sim), ship, 'destroyed');
    expect(stepUntil(sim, LEG_DUE_TICKS, () => (colonyState(sim)?.line ?? null) !== null)).toBe(true);
    expect(colonyState(sim)?.ship).toBeNull();
    expect(colonyState(sim)?.line?.ship).not.toBe(ship);
  });

  it('hands a listed settler no ship holds back to home at its next stop', () => {
    const { sim } = linedWorld();
    stepUntil(sim, LEG_DUE_TICKS, () => leg(sim) === 'unloadHome');
    const ctx = ctxOf(sim);
    const stray = homeSettlers(sim.world, ctx, SEAT)[0] as Entity;
    editColony(sim).rest.push(stray);
    expect(homeSettlers(sim.world, ctxOf(sim), SEAT)).not.toContain(stray);
    expect(stepUntil(sim, LEG_DUE_TICKS, () => leg(sim) === 'loadHome')).toBe(true);
    expect(colonyState(sim)?.rest).not.toContain(stray);
    expect(homeSettlers(sim.world, ctxOf(sim), SEAT)).toContain(stray);
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

describe('a line under fire', () => {
  it('marks where its hull fell, sails with the fewest hands and owes no ship once no way is clear', () => {
    const { sim, ship } = linedWorld();
    const _carrier = aiControlEntity(sim.world, SEAT) as Entity;
    sim.world.mut(ship, Health).hitpoints -= HULL_HIT;
    stepUntil(sim, ROUND_DUE_TICKS, () => (colonyState(sim)?.dangers.length ?? 0) > 0);
    expect(colonyState(sim)?.dangers).toHaveLength(1);
    expect(stepUntil(sim, ROUND_DUE_TICKS, () => leg(sim) === 'loadHome')).toBe(true);
    expect(colonyState(sim)?.line?.crew.length).toBeLessThanOrEqual(LINE_CREW_LEAST);
    // The strait runs the map's height: fire across all of it leaves no way round.
    editColony(sim).dangers = STRAIT_ACROSS.map((hy) => ({ hx: STRAIT_MID_HX, hy }));
    expect(colonySmallShips(sim.world, ctxOf(sim), SEAT)).toBe(0);
    removeVehicle(sim.world, ctxOf(sim), ship, 'destroyed');
    expect(stepUntil(sim, LEG_DUE_TICKS, () => colonyState(sim)?.line === null)).toBe(true);
    expect(colonySmallShips(sim.world, ctxOf(sim), SEAT)).toBe(0);
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

  it('lets the ship go though a child it cannot seat stays', () => {
    const { sim, ship } = linedWorld();
    const site = colonyState(sim)?.site;
    if (site === undefined) throw new Error('no site');
    const ctx = ctxOf(sim);
    const home = new Set(homeSettlers(sim.world, ctx, SEAT));
    const crew = colonyState(sim)?.line?.crew ?? [];
    for (const e of everySettlerOf(sim.world, SEAT))
      if (!home.has(e) && !crew.includes(e)) sim.world.destroy(e);
    sim.enqueueSetup({
      kind: 'spawnSettler',
      jobType: CHILD_MALE,
      x: site.hx,
      y: site.hy,
      tribe: VIKING,
      owner: SEAT,
    });
    sim.enqueueSetup({
      kind: 'spawnSettler',
      jobType: UNARMED,
      x: site.hx + SITE_NEAR,
      y: site.hy,
      tribe: VIKING,
      owner: ENEMY,
    });
    for (const e of everyBuildingOf(sim.world, SEAT))
      if (colonyMember(sim.world, ctx, SEAT, e)) sim.world.destroy(e);
    expect(stepUntil(sim, LEG_DUE_TICKS, () => colonyState(sim)?.phase === 'abandoned')).toBe(true);
    expect(stepUntil(sim, ROUND_DUE_TICKS, () => colonyState(sim)?.line === null)).toBe(true);
    sim.step();
    expect(sim.world.get(ship, Vehicle).passengers.every((seat) => seat === null)).toBe(true);
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
