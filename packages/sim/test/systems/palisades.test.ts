import { describe, expect, it } from 'vitest';
import {
  addWildlife,
  Health,
  Palisade,
  PalisadeBlocking,
  Position,
  SiteAssignment,
  Stockpile,
  setStockAmount,
  UnderConstruction,
} from '../../src/components/index.js';
import {
  type Entity,
  exportSaveGame,
  fx,
  hexNeighboursOf,
  ONE,
  positionOfNode,
  restoreSimulation,
  type ScriptLandscapeType,
  Simulation,
} from '../../src/index.js';
import { damageVsTarget } from '../../src/systems/conflict/weapons.js';
import { advanceConstructionLabor, constructionSystem } from '../../src/systems/economy/construction.js';
import { dynamicBlockOverlay } from '../../src/systems/footprint/index.js';
import {
  claimPalisade,
  constructionSiteAvailableTo,
  palisadeReservedBy,
  plantPalisadeFlag,
  releasePalisadeReservation,
} from '../../src/systems/palisades/reservation.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
import { grassNodeMap } from '../fixtures/terrain.js';

/** Any animal tribe: the occupancy rule reads the component, never the tribe. */
const WOLF_TRIBE = 9;

const WALL: ScriptLandscapeType = {
  typeId: 691,
  walk: [{ dx: 0, dy: 0 }],
  build: [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
    { dx: -1, dy: 0 },
    { dx: -1, dy: -1 },
    { dx: 0, dy: -1 },
    { dx: -1, dy: 1 },
    { dx: 0, dy: 1 },
  ],
  groups: [],
  wall: {
    logicType: 82,
    maxHitpoints: 100,
    repairPerStrike: 3,
    construction: [{ goodType: 5, amount: 1 }],
  },
};

const CLOSED_GATE: ScriptLandscapeType = {
  typeId: 696,
  walk: [
    { dx: -2, dy: 0 },
    { dx: -1, dy: 0 },
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
    { dx: 2, dy: 0 },
  ],
  build: [
    { dx: -2, dy: 0 },
    { dx: -1, dy: 0 },
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
    { dx: 2, dy: 0 },
  ],
  groups: [],
  wall: {
    logicType: 83,
    maxHitpoints: 100,
    repairPerStrike: 1,
    construction: [{ goodType: 5, amount: 1 }],
    gate: { open: false, counterpartGfxIndex: 700 },
  },
};

const OPEN_GATE: ScriptLandscapeType = {
  typeId: 700,
  walk: [
    { dx: -2, dy: 0 },
    { dx: 2, dy: 0 },
  ],
  build: CLOSED_GATE.build,
  groups: [],
  wall: {
    logicType: 84,
    maxHitpoints: 100,
    repairPerStrike: 1,
    construction: [{ goodType: 5, amount: 1 }],
    gate: { open: true, counterpartGfxIndex: 696 },
  },
};

function palisadeMap() {
  const base = grassNodeMap(16, 16);
  return { ...base, landscapes: { types: [WALL, CLOSED_GATE, OPEN_GATE], placements: [] } };
}

function fresh(): Simulation {
  return new Simulation({
    seed: 1,
    content: testContent(),
    map: palisadeMap(),
  });
}

/** A segment takes strikes only from the one builder holding its planted flag, so a direct-labor test
 *  needs that claim stamped the way {@link planBuilder} stamps it. */
function flagBearer(sim: Simulation, site: Entity): Entity {
  const builder = sim.world.create();
  sim.world.add(builder, SiteAssignment, { site, pinned: false });
  claimPalisade(sim.world, site, builder);
  plantPalisadeFlag(sim.world, site, builder);
  return builder;
}

/** A stationary creature: only a mover blocks a closing gate, so a bare Position is not enough. */
function standingCreature(sim: Simulation, hx: number, hy: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, positionOfNode(hx, hy));
  addWildlife(sim.world, e, WOLF_TRIBE);
  return e;
}

function onlyPalisade(sim: Simulation): Entity {
  const walls = [...sim.world.query(Palisade)];
  const wall = walls[0];
  if (walls.length !== 1 || wall === undefined) throw new Error('expected exactly one palisade');
  return wall;
}

describe('palisades', () => {
  it('places connected segments through normal commands in all six neighbouring directions', () => {
    const sim = fresh();
    for (const at of [{ hx: 8, hy: 8 }, ...hexNeighboursOf(8, 8)]) {
      sim.enqueueSetup({
        kind: 'placePalisade',
        gfxIndex: WALL.typeId,
        x: at.hx,
        y: at.hy,
        tribe: 0,
        underConstruction: true,
      });
    }
    sim.step();
    expect([...sim.world.query(Palisade)]).toHaveLength(7);
    expect(sim.world.verifyCaches()).toEqual([]);
  });

  it('costs one wood, stays passable while reserved, then blocks after one wall-build strike', () => {
    const sim = fresh();
    sim.enqueueSetup({
      kind: 'placePalisade',
      gfxIndex: WALL.typeId,
      x: 6,
      y: 6,
      tribe: 0,
      owner: 0,
      underConstruction: true,
    });
    sim.step();
    const wall = onlyPalisade(sim);
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('expected mapped simulation');
    const node = terrain.nodeAt(6, 6);
    expect(sim.palisadeProbe(WALL.typeId)?.canPlace(6, 6)).toBe(false);
    expect(dynamicBlockOverlay(sim.world, ctxOf(sim), terrain).has(node)).toBe(false);
    expect(sim.world.has(wall, PalisadeBlocking)).toBe(false);

    setStockAmount(sim.world, wall, 5, 1);
    expect(advanceConstructionLabor(sim.world, ctxOf(sim), wall, flagBearer(sim, wall))).toBe(true);
    constructionSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(wall, UnderConstruction)).toBe(false);
    expect(sim.world.has(wall, PalisadeBlocking)).toBe(true);
    expect(sim.world.get(wall, Health)).toEqual({ hitpoints: 100, max: 100 });
    expect(sim.world.get(wall, Stockpile).amounts.get(5) ?? 0).toBe(0);
    expect(dynamicBlockOverlay(sim.world, ctxOf(sim), terrain).has(node)).toBe(true);
  });

  it('opens by swapping to the paired footprint and refuses to close onto an occupant', () => {
    const sim = fresh();
    sim.enqueueSetup({ kind: 'placePalisade', gfxIndex: CLOSED_GATE.typeId, x: 8, y: 8, tribe: 0 });
    sim.step();
    const gate = onlyPalisade(sim);
    sim.enqueueSetup({ kind: 'setPalisadeGate', palisade: gate, open: true });
    sim.step();
    expect(sim.world.get(gate, Palisade).gate).toEqual({ open: true, counterpartGfxIndex: 696 });
    expect(sim.world.get(gate, Palisade).gfxIndex).toBe(700);
    for (const x of [7, 8, 9]) {
      sim.enqueueSetup({
        kind: 'placePalisade',
        gfxIndex: WALL.typeId,
        x,
        y: 8,
        tribe: 0,
        underConstruction: true,
      });
    }
    sim.step();
    expect([...sim.world.query(Palisade)]).toHaveLength(1);
    for (const x of [5, 11]) {
      sim.enqueueSetup({
        kind: 'placePalisade',
        gfxIndex: WALL.typeId,
        x,
        y: 8,
        tribe: 0,
        underConstruction: true,
      });
    }
    sim.step();
    expect([...sim.world.query(Palisade)]).toHaveLength(3);

    const occupant = standingCreature(sim, 8, 8); // the gate's own anchor, inside its closed body
    sim.enqueueSetup({ kind: 'setPalisadeGate', palisade: gate, open: false });
    sim.step();
    expect(sim.world.get(gate, Palisade).gate?.open).toBe(true);
    sim.world.destroy(occupant);
    sim.enqueueSetup({ kind: 'setPalisadeGate', palisade: gate, open: false });
    sim.step();
    expect(sim.world.get(gate, Palisade).gate?.open).toBe(false);
  });

  it('closes a gate whose own body covers the outer posts of the run it was cut into', () => {
    const sim = fresh();
    sim.enqueueSetup({ kind: 'placePalisade', gfxIndex: OPEN_GATE.typeId, x: 8, y: 8, tribe: 0, owner: 0 });
    sim.step();
    const gate = onlyPalisade(sim);
    // The source's conversion clears only the two neighbours, so these two keep standing inside the gate.
    for (const x of [6, 10]) {
      sim.enqueueSetup({
        kind: 'placePalisade',
        gfxIndex: WALL.typeId,
        x,
        y: 8,
        tribe: 0,
        owner: 0,
        force: true,
      });
    }
    sim.step();
    expect([...sim.world.query(Palisade)]).toHaveLength(3);

    sim.enqueueSetup({ kind: 'setPalisadeGate', palisade: gate, open: false });
    sim.step();
    expect(sim.world.get(gate, Palisade).gate?.open).toBe(false);
  });

  it('defers completed collision while occupied and consumes its wood exactly once after clearing', () => {
    const sim = fresh();
    sim.enqueueSetup({
      kind: 'placePalisade',
      gfxIndex: CLOSED_GATE.typeId,
      x: 8,
      y: 8,
      tribe: 0,
      underConstruction: true,
    });
    sim.step();
    const gate = onlyPalisade(sim);
    setStockAmount(sim.world, gate, 5, 1);
    expect(advanceConstructionLabor(sim.world, ctxOf(sim), gate, flagBearer(sim, gate))).toBe(true);
    const occupant = standingCreature(sim, 9, 8);

    constructionSystem(sim.world, ctxOf(sim));
    constructionSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(gate, UnderConstruction)).toBe(true);
    expect(sim.world.has(gate, PalisadeBlocking)).toBe(false);
    expect(sim.world.get(gate, Stockpile).amounts.get(5)).toBe(1);

    sim.world.destroy(occupant);
    constructionSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(gate, UnderConstruction)).toBe(false);
    expect(sim.world.has(gate, PalisadeBlocking)).toBe(true);
    expect(sim.world.get(gate, Stockpile).amounts.get(5) ?? 0).toBe(0);
  });

  it('uses landscape damage hundreds and repairs by the source transition delta', () => {
    const sim = fresh();
    sim.enqueueSetup({ kind: 'placePalisade', gfxIndex: WALL.typeId, x: 4, y: 4, tribe: 0, owner: 0 });
    sim.step();
    const wall = onlyPalisade(sim);
    expect(damageVsTarget(sim.world, wall, 450)).toBe(4);
    expect(damageVsTarget(sim.world, wall, 99)).toBe(0);
    sim.world.mut(wall, Health).hitpoints = 90;
    sim.world.mut(wall, Palisade).built = fx.div(fx.fromInt(90), fx.fromInt(100));
    sim.enqueueSetup({ kind: 'repairPalisade', palisade: wall });
    sim.step();
    expect(advanceConstructionLabor(sim.world, ctxOf(sim), wall, flagBearer(sim, wall))).toBe(true);
    constructionSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(wall, Health).hitpoints).toBe(93);
    expect(sim.world.get(wall, Palisade).built).toBeLessThan(ONE);
  });

  it('restores a damaged owned gate with its pairing, collision, health, and fixed-point valency', () => {
    const sim = fresh();
    sim.enqueueSetup({
      kind: 'placePalisade',
      gfxIndex: CLOSED_GATE.typeId,
      x: 8,
      y: 8,
      tribe: 0,
      owner: 2,
      valency: 40,
    });
    sim.step();
    const gate = onlyPalisade(sim);
    expect(sim.world.get(gate, Health)).toEqual({ hitpoints: 40, max: 100 });
    expect(sim.world.get(gate, Palisade).built).toBe(fx.div(fx.fromInt(40), fx.fromInt(100)));
    expect(sim.world.has(gate, PalisadeBlocking)).toBe(true);

    const restored = restoreSimulation(exportSaveGame(sim), {
      content: testContent(),
      map: palisadeMap(),
    });
    expect(restored.world.get(gate, Palisade)).toEqual(sim.world.get(gate, Palisade));
    expect(restored.world.get(gate, Health)).toEqual({ hitpoints: 40, max: 100 });
    expect(restored.world.has(gate, PalisadeBlocking)).toBe(true);
  });

  it('admits one builder per unfinished segment and hands the claim on when it is released', () => {
    const sim = fresh();
    sim.enqueueSetup({
      kind: 'placePalisade',
      gfxIndex: WALL.typeId,
      x: 6,
      y: 6,
      tribe: 0,
      owner: 0,
      underConstruction: true,
    });
    sim.step();
    const wall = onlyPalisade(sim);
    const first = flagBearer(sim, wall);
    const second = sim.world.create();
    sim.world.add(second, SiteAssignment, { site: wall, pinned: false });

    expect(constructionSiteAvailableTo(sim.world, wall, first)).toBe(true);
    expect(constructionSiteAvailableTo(sim.world, wall, second)).toBe(false);
    expect(claimPalisade(sim.world, wall, second)).toBe(false);
    expect(palisadeReservedBy(sim.world, wall)).toBe(first);

    releasePalisadeReservation(sim.world, first);
    expect(palisadeReservedBy(sim.world, wall)).toBeNull();
    expect(claimPalisade(sim.world, wall, second)).toBe(true);
    expect(palisadeReservedBy(sim.world, wall)).toBe(second);
  });

  it('restores a planted claim so a reloaded builder keeps the segment it was raising', () => {
    const sim = fresh();
    sim.enqueueSetup({
      kind: 'placePalisade',
      gfxIndex: WALL.typeId,
      x: 6,
      y: 6,
      tribe: 0,
      owner: 0,
      underConstruction: true,
    });
    sim.step();
    const wall = onlyPalisade(sim);
    const builder = flagBearer(sim, wall);

    const restored = restoreSimulation(exportSaveGame(sim), {
      content: testContent(),
      map: palisadeMap(),
    });

    expect(restored.world.get(wall, Palisade).reservation).toEqual({ builder, planted: true });
    expect(palisadeReservedBy(restored.world, wall)).toBe(builder);
  });
});
