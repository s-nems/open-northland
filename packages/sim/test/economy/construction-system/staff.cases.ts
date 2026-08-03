import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  Building,
  CurrentAtomic,
  JobAssignment,
  MoveGoal,
  Owner,
  Position,
  Settler,
  Stockpile,
  UnderConstruction,
} from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import { fx, nodeOfPosition, ONE, Simulation } from '../../../src/index.js';
import type { NodeId } from '../../../src/nav/terrain/index.js';
import { forceFinishConstruction } from '../../../src/systems/economy/construction.js';
import { constructionWorkCells, dynamicBlockOverlay } from '../../../src/systems/footprint/index.js';
import { assignWorker } from '../../../src/systems/orders/index.js';
import { TEST_MANIFEST } from '../../fixtures/content.js';
import { ctxOf, grassMap } from './support.js';

/**
 * A building takes its workers from the moment its foundation is placed: the same slots and per-slot limits
 * a finished one offers, filled by the same `assignWorker` order. What that staff DOES while the building
 * goes up is `planSiteStaff` - a carrier hauls the site's construction bill, every other trade waits at the
 * site until its workhouse stands.
 *
 * An upgrade is the one asymmetry the player feels: the site reports the slots of the tier it currently IS
 * (the target tier is adopted only on completion), so the extra seats a higher tier brings cannot be filled
 * until the upgrade finishes.
 *
 * source-basis: user rule ("obowiązuje taki sam limit pracowników jak w budynku … limit
 * jest poziomu podstawowego a nie ulepszonego"). The original never staffs before completion, so there is
 * no oracle for the timing - only the slot counts and the tier chain behind it are extracted.
 */

const VIKING = 1;
const HUMAN = 0;
const STONE = 1;
const WOOD = 2;
const IDLE = 0;
const CARRIER = 36;
const MASON = 9;
const STORE = 1; // a passive store - where the site's material comes from
const SMITHY_L0 = 10; // 1 mason + 1 carrier, upgrades into SMITHY_L1
const SMITHY_L1 = 11; // 2 masons + 1 carrier - the seat an upgrade may not fill early
const GRASS = 0;
/** The half-cell lattice these cases play on: 20 tiles wide (a tile is 2 nodes), a few rows deep so a
 *  site has a perimeter to spread its crew over. */
const NODES_W = 40;
const NODES_H = 4;

function staffContent(): ContentSet {
  return parseContentSet({
    manifest: TEST_MANIFEST,
    goods: [
      { typeId: 0, id: 'none' },
      { typeId: STONE, id: 'stone' },
      { typeId: WOOD, id: 'wood' },
    ],
    jobs: [
      { typeId: IDLE, id: 'idle' },
      { typeId: CARRIER, id: 'carrier' },
      { typeId: MASON, id: 'mason' },
    ],
    landscape: [{ typeId: GRASS, id: 'grass', walkable: true, buildable: true }],
    buildings: [
      {
        typeId: STORE,
        id: 'headquarters',
        kind: 'storage',
        stock: [
          { goodType: STONE, capacity: 10 },
          { goodType: WOOD, capacity: 10 },
        ],
      },
      {
        typeId: SMITHY_L0,
        id: 'work_smithy_00',
        kind: 'workplace',
        produces: [STONE],
        recipes: [{ inputs: [{ goodType: WOOD, amount: 1 }], outputs: [{ goodType: STONE, amount: 1 }] }],
        stock: [
          { goodType: WOOD, capacity: 10 },
          { goodType: STONE, capacity: 10 },
        ],
        workers: [
          { jobType: MASON, count: 1 },
          { jobType: CARRIER, count: 1 },
        ],
        construction: [{ goodType: STONE, amount: 2 }],
        upgradeTarget: SMITHY_L1,
      },
      {
        typeId: SMITHY_L1,
        id: 'work_smithy_01',
        kind: 'workplace',
        produces: [STONE],
        recipes: [{ inputs: [{ goodType: WOOD, amount: 1 }], outputs: [{ goodType: STONE, amount: 1 }] }],
        stock: [
          { goodType: WOOD, capacity: 10 },
          { goodType: STONE, capacity: 10 },
        ],
        workers: [
          { jobType: MASON, count: 2 },
          { jobType: CARRIER, count: 1 },
        ],
        construction: [{ goodType: STONE, amount: 3 }],
      },
    ],
  });
}

function buildingAt(
  sim: Simulation,
  buildingType: number,
  x: number,
  y: number,
  opts: { readonly site?: boolean; readonly stock?: Array<[number, number]> } = {},
): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Building, {
    buildingType,
    tribe: VIKING,
    built: opts.site === true ? fx.fromInt(0) : ONE,
    level: 0,
  });
  sim.world.add(e, Stockpile, { amounts: new Map(opts.stock ?? []) });
  if (opts.site === true) sim.world.add(e, UnderConstruction, { labor: fx.fromInt(0) });
  sim.world.add(e, Owner, { player: HUMAN });
  return e;
}

/** An owned settler of `jobType` (idle when null) - the unit an `assignWorker` order may post. */
function settlerAt(sim: Simulation, x: number, y: number, jobType: number | null): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Settler, {
    tribe: VIKING,
    jobType,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
    experience: new Map(),
  });
  sim.world.add(e, Owner, { player: HUMAN });
  return e;
}

function post(sim: Simulation, settler: Entity, building: Entity, jobPriority: readonly number[]): void {
  assignWorker(sim.world, ctxOf(sim), { kind: 'assignWorker', entity: settler, building, jobPriority });
}

function boundTo(sim: Simulation, settler: Entity): Entity | undefined {
  return sim.world.tryGet(settler, JobAssignment)?.workplace;
}

/** The terrain node a settler currently stands on. */
function nodeOf(sim: Simulation, settler: Entity): NodeId | null {
  const terrain = sim.terrain;
  if (terrain === undefined) return null;
  const pos = sim.world.get(settler, Position);
  const node = nodeOfPosition(pos.x, pos.y);
  return terrain.nodeAtClamped(node.hx, node.hy);
}

/** The site's own work perimeter - the cells its crew (builders and posted staff alike) stands on. */
function perimeterOf(sim: Simulation, site: Entity): readonly NodeId[] {
  const terrain = sim.terrain;
  if (terrain === undefined) return [];
  const ctx = ctxOf(sim);
  return constructionWorkCells(sim.world, ctx, terrain, site, dynamicBlockOverlay(sim.world, ctx, terrain));
}

describe('construction site staffing - the slots a building offers while it is raised', () => {
  it('posts a worker to an unfinished building, up to the same per-slot limit a finished one holds', () => {
    const sim = new Simulation({ seed: 1, content: staffContent(), map: grassMap(NODES_W, NODES_H) });
    const site = buildingAt(sim, SMITHY_L0, 3, 0, { site: true });
    const first = settlerAt(sim, 0, 0, null);
    const second = settlerAt(sim, 1, 0, null);

    post(sim, first, site, [MASON]);
    post(sim, second, site, [MASON]);

    expect(boundTo(sim, first)).toBe(site);
    expect(sim.world.get(first, Settler).jobType).toBe(MASON);
    expect(boundTo(sim, second)).toBeUndefined(); // the one mason slot is taken
  });

  it('keeps an upgrade’s crew and takes new hires, but only to the CURRENT tier’s limit', () => {
    const sim = new Simulation({ seed: 1, content: staffContent(), map: grassMap(NODES_W, NODES_H) });
    // A built L0 smithy (one mason seat) with a mason already on it, re-opened as an upgrade site toward
    // L1 (two mason seats).
    const smithy = buildingAt(sim, SMITHY_L0, 3, 0, { stock: [[STONE, 3]] });
    const mason = settlerAt(sim, 0, 0, null);
    post(sim, mason, smithy, [MASON]);
    sim.enqueue({ kind: 'upgradeBuilding', building: smithy });
    sim.step();
    expect(sim.world.has(smithy, UnderConstruction)).toBe(true);
    expect(boundTo(sim, mason)).toBe(smithy); // the upgrade keeps its crew

    // Hiring stays open during the upgrade - the carrier seat L0 already offers is filled right now…
    const hauler = settlerAt(sim, 1, 0, null);
    post(sim, hauler, smithy, [CARRIER]);
    expect(boundTo(sim, hauler)).toBe(smithy);

    // …but the SECOND mason is a seat only L1 has, and the site is still an L0 smithy.
    const second = settlerAt(sim, 2, 0, null);
    post(sim, second, smithy, [MASON]);
    expect(boundTo(sim, second)).toBeUndefined();

    forceFinishConstruction(sim.world, ctxOf(sim), smithy);
    expect(sim.world.get(smithy, Building).buildingType).toBe(SMITHY_L1);
    post(sim, second, smithy, [MASON]);
    expect(boundTo(sim, second)).toBe(smithy); // L1's second seat, now that it exists
  });
});

describe('planSiteStaff - what a posted worker does while its building goes up', () => {
  it('walks a craft worker to the site it was posted to and holds it there', () => {
    const sim = new Simulation({ seed: 1, content: staffContent(), map: grassMap(NODES_W, NODES_H) });
    const site = buildingAt(sim, SMITHY_L0, 6, 0, { site: true });
    const mason = settlerAt(sim, 0, 0, null);
    post(sim, mason, site, [MASON]);

    sim.step();
    expect(sim.world.has(mason, MoveGoal)).toBe(true); // en route to its unfinished workplace

    // It ends up standing on the site's own work perimeter and stays there - no errand elsewhere.
    for (let i = 0; i < 400; i++) sim.step();
    expect(perimeterOf(sim, site)).toContain(nodeOf(sim, mason));
    expect(boundTo(sim, mason)).toBe(site); // the posting survives the build
  });

  it('sends a posted carrier for the site’s outstanding material, and the load lands on the site', () => {
    const sim = new Simulation({ seed: 1, content: staffContent(), map: grassMap(NODES_W, NODES_H) });
    const store = buildingAt(sim, STORE, 0, 0, { stock: [[STONE, 5]] });
    const site = buildingAt(sim, SMITHY_L0, 5, 0, { site: true }); // needs 2 stone
    const carrier = settlerAt(sim, 2, 0, CARRIER);
    post(sim, carrier, site, [CARRIER]);

    let lifted: Entity | null = null;
    for (let i = 0; i < 400 && lifted === null; i++) {
      sim.step();
      const effect = sim.world.tryGet(carrier, CurrentAtomic)?.effect;
      if (effect?.kind === 'pickup') lifted = effect.from;
    }
    expect(lifted).toBe(store); // it fetched the site's bill from the store that holds it

    let delivered = 0;
    for (let i = 0; i < 600 && delivered === 0; i++) {
      sim.step();
      delivered = sim.world.get(site, Stockpile).amounts.get(STONE) ?? 0;
    }
    expect(delivered).toBeGreaterThan(0); // and banked it into its own site, not back into the store
  });
});
