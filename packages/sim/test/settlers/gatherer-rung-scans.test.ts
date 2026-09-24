import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ResourceFootprintCell } from '../../src/components/index.js';
import { HarvestedBy, Position, Resource } from '../../src/components/index.js';
import { contentIndex } from '../../src/core/content-index.js';
import type { Entity } from '../../src/ecs/world.js';
import { type NodeId, positionOfNode, Simulation } from '../../src/index.js';
import { anchorOnlyFootprint, stampResourceFootprintData } from '../../src/systems/index.js';
import { dropGroundPile } from '../../src/systems/settlers/atomics/effects/goods/piles.js';
import type { PlannerContext } from '../../src/systems/settlers/planner/context.js';
import {
  collectTargets,
  nearestCollectablePileFor,
  nearestHarvestableFor,
  nearestOwnDropFor,
} from '../../src/systems/settlers/targets/index.js';
import * as workplaces from '../../src/systems/settlers/targets/workplaces.js';
import { GossipCandidates } from '../../src/systems/social/index.js';
import { collectInboundSupply } from '../../src/systems/stores/index.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
import { settlerAt } from '../fixtures/settler.js';
import { grassNodeMap } from '../fixtures/terrain.js';

/**
 * The gatherer rung's scans visit only candidates the seeker's trade can take: pile scans by the goods
 * the trade harvests, a bounded harvest scan by the job's harvest atomics, and the flag-radius scan skips
 * the work-cell resolve of an anchor that cannot reach the radius. Each still returns the full scan's
 * winner; the goldens pin that on the long runs.
 */

const VIKING = 1;
const WOODCUTTER = 1; // harvest atomic 24
const MINER = 5; // harvest atomic 25
const CIVILIST = 6; // no harvest atomic
const HUNTER = 15; // harvest atomic 33
const WOOD = 1;
const STONE = 4;
const MEAT = 21;
const LEATHER = 22; // harvested with the same atomic as meat
const CHOP = 24;
const CUT_CADAVER = 33;

afterEach(() => vi.restoreAllMocks());

function newSim(): Simulation {
  return new Simulation({ seed: 1, content: testContent(), map: grassNodeMap(48, 32) });
}

function node(sim: Simulation, hx: number, hy: number): NodeId {
  if (sim.terrain === undefined) throw new Error('fixture map missing');
  return sim.terrain.nodeAt(hx, hy);
}

function planFor(sim: Simulation, jobType: number, hx: number, hy: number): PlannerContext {
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('fixture map missing');
  const ctx = ctxOf(sim);
  const entity = settlerAt(sim, { jobType, tribe: VIKING, position: positionOfNode(hx, hy) });
  return {
    world: sim.world,
    ctx,
    terrain,
    entity,
    here: terrain.nodeAt(hx, hy),
    tribe: VIKING,
    jobType,
    experience: new Map(),
    owner: undefined,
    limit: null,
    targets: collectTargets(sim.world, ctx, terrain),
    inbound: collectInboundSupply(sim.world),
    gossipCandidates: new GossipCandidates(sim.world, sim.content),
  };
}

function pileAt(sim: Simulation, hx: number, hy: number, goodType: number): Entity {
  const at = positionOfNode(hx, hy);
  return dropGroundPile(sim.world, at.x, at.y, goodType, 1);
}

function resourceAt(
  sim: Simulation,
  hx: number,
  hy: number,
  goodType: number,
  harvestAtomic: number,
  work: readonly ResourceFootprintCell[] = anchorOnlyFootprint().work,
): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, positionOfNode(hx, hy));
  sim.world.add(e, Resource, { goodType, remaining: 3, harvestAtomic });
  stampResourceFootprintData(sim.world, e, { walk: [], build: [], work: [...work] });
  return e;
}

/** The entities passed as the first argument of every call `spy` saw. */
function readEntities(spy: { mock: { calls: readonly (readonly unknown[])[] } }): Set<unknown> {
  return new Set(spy.mock.calls.map((args) => args[0]));
}

describe('pile scan', () => {
  it('a trade that harvests no piled good reads no pile', () => {
    const sim = newSim();
    const wood = pileAt(sim, 10, 10, WOOD);
    const plan = planFor(sim, CIVILIST, 4, 10);
    void plan.targets.groundDropsByGood; // the tick's shared grouping, paid once for every seeker
    const get = vi.spyOn(sim.world, 'get');
    const tryGet = vi.spyOn(sim.world, 'tryGet');

    expect(nearestCollectablePileFor(plan)).toBeNull();
    expect(readEntities(get).has(wood)).toBe(false);
    expect(readEntities(tryGet).has(wood)).toBe(false);
  });

  it('a trade reads only the piles of the goods it harvests and takes the nearest of them', () => {
    const sim = newSim();
    const nearWood = pileAt(sim, 6, 10, WOOD); // nearer, but not the miner's good
    const stone = pileAt(sim, 12, 10, STONE);
    const plan = planFor(sim, MINER, 4, 10);
    void plan.targets.groundDropsByGood;
    const get = vi.spyOn(sim.world, 'get');
    const tryGet = vi.spyOn(sim.world, 'tryGet');

    expect(nearestCollectablePileFor(plan)?.pile).toBe(stone);
    expect(readEntities(get).has(nearWood)).toBe(false);
    expect(readEntities(tryGet).has(nearWood)).toBe(false);
  });

  it('two goods of one trade still tie-break a shared cell by the lower pile id', () => {
    const sim = newSim();
    // The meat list is walked first, so without the merged ascending order its higher-id pile would win.
    const leather = pileAt(sim, 10, 10, LEATHER);
    pileAt(sim, 10, 10, MEAT);
    const plan = planFor(sim, HUNTER, 4, 10);

    expect(nearestCollectablePileFor(plan)?.pile).toBe(leather);
  });

  it('a flag gatherer reads only the piles it dug itself', () => {
    const sim = newSim();
    const plan = planFor(sim, WOODCUTTER, 4, 10);
    const other = settlerAt(sim, { jobType: WOODCUTTER, tribe: VIKING, position: positionOfNode(8, 10) });
    const foreign = pileAt(sim, 6, 10, WOOD); // nearer, but another gatherer's
    sim.world.add(foreign, HarvestedBy, { by: other });
    const own = pileAt(sim, 12, 10, WOOD);
    sim.world.add(own, HarvestedBy, { by: plan.entity });
    const fresh = { ...plan, targets: collectTargets(sim.world, plan.ctx, plan.terrain) };
    void fresh.targets.groundDropsByHarvester;
    const get = vi.spyOn(sim.world, 'get');
    const tryGet = vi.spyOn(sim.world, 'tryGet');

    expect(nearestOwnDropFor(fresh)?.pile).toBe(own);
    expect(readEntities(get).has(foreign)).toBe(false);
    expect(readEntities(tryGet).has(foreign)).toBe(false);
  });
});

describe('bounded harvest scan', () => {
  it("a hunter's ground scan never resolves a tree", () => {
    const sim = newSim();
    const trees = [resourceAt(sim, 18, 10, WOOD, CHOP), resourceAt(sim, 20, 12, WOOD, CHOP)];
    const carcass = resourceAt(sim, 24, 10, MEAT, CUT_CADAVER);
    const plan = planFor(sim, HUNTER, 16, 10);
    const tryGet = vi.spyOn(sim.world, 'tryGet');

    const found = nearestHarvestableFor(plan, { within: { center: node(sim, 20, 10), radius: 8 } });
    expect(found?.entity).toBe(carcass);
    const read = readEntities(tryGet);
    for (const tree of trees) expect(read.has(tree)).toBe(false);
  });

  it('the flag-radius scan keeps an anchor whose work cell reaches the radius and skips the rest', () => {
    const sim = newSim();
    const offset = contentIndex(sim.content).maxResourceWorkOffset;
    const radius = 4;
    const [cx, cy] = [20, 10];
    // Anchor exactly `radius + offset` out, worked from the cell `offset` nodes back towards the flag.
    const edge = resourceAt(sim, cx + radius + offset, cy, WOOD, CHOP, [{ dx: -offset, dy: 0 }]);
    // Inside the query box but beyond reach: a box corner, and an anchor one node past the edge.
    const corner = resourceAt(sim, cx + radius + offset, cy + radius + offset, WOOD, CHOP);
    const past = resourceAt(sim, cx - radius - offset - 1, cy, WOOD, CHOP, [{ dx: offset, dy: 0 }]);
    const plan = planFor(sim, WOODCUTTER, cx, cy);
    const resolve = vi.spyOn(workplaces, 'interactionCell');

    const found = nearestHarvestableFor(plan, { area: { center: node(sim, cx, cy), radius } });
    expect(found).toEqual({ entity: edge, cell: node(sim, cx + radius, cy), dist: radius });
    const resolved = new Set(resolve.mock.calls.map((args) => args[3]));
    expect(resolved.has(edge)).toBe(true);
    expect(resolved.has(corner)).toBe(false);
    expect(resolved.has(past)).toBe(false);
  });
});
