import { describe, expect, it } from 'vitest';
import type { ResourceFootprintCell } from '../../../../src/components/index.js';
import { HarvestedBy, Position, Resource } from '../../../../src/components/index.js';
import { contentIndex } from '../../../../src/core/content-index.js';
import type { Entity } from '../../../../src/ecs/world.js';
import { type NodeId, positionOfNode, Simulation } from '../../../../src/index.js';
import { hexDistanceBetween } from '../../../../src/nav/halfcell.js';
import { NO_WALK, type WalkLengths } from '../../../../src/nav/node-circle.js';
import { stampResourceFootprintData } from '../../../../src/systems/index.js';
import { dropGroundPile } from '../../../../src/systems/settlers/atomics/effects/goods/piles.js';
import type { PlannerContext } from '../../../../src/systems/settlers/planner/context.js';
import {
  collectTargets,
  nearestCollectablePileFor,
  nearestHarvestableFor,
  nearestOwnDropFor,
} from '../../../../src/systems/settlers/targets/index.js';
import { GossipCandidates } from '../../../../src/systems/social/index.js';
import { collectSupplyTally } from '../../../../src/systems/stores/index.js';
import { testContent } from '../../../fixtures/content.js';
import { ctxOf } from '../../../fixtures/context.js';
import { settlerAt } from '../../../fixtures/settler.js';
import { grassNodeMap } from '../../../fixtures/terrain.js';

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
const MINE = 25;
const CUT_CADAVER = 33;

/** The farthest winner the growing-box edge sweep places, past several doublings of the first box. */
const EDGE_SWEEP_MAX = 140;

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
    supply: collectSupplyTally(sim.world),
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
  work: readonly ResourceFootprintCell[] = [{ dx: 0, dy: 0 }],
): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, positionOfNode(hx, hy));
  sim.world.add(e, Resource, { goodType, remaining: 3, harvestAtomic });
  stampResourceFootprintData(sim.world, e, { walk: [], build: [], work: [...work] });
  return e;
}

describe('pile scan', () => {
  it('a trade takes the nearest pile of a good it harvests', () => {
    const sim = newSim();
    pileAt(sim, 6, 10, WOOD); // nearer, but not the miner's good
    const stone = pileAt(sim, 12, 10, STONE);
    const plan = planFor(sim, MINER, 4, 10);

    expect(nearestCollectablePileFor(plan)?.pile).toBe(stone);
  });

  it('two goods of one trade still tie-break a shared cell by the lower pile id', () => {
    const sim = newSim();
    // The meat list is walked first, so without the merged ascending order its higher-id pile would win.
    const leather = pileAt(sim, 10, 10, LEATHER);
    pileAt(sim, 10, 10, MEAT);
    const plan = planFor(sim, HUNTER, 4, 10);

    expect(nearestCollectablePileFor(plan)?.pile).toBe(leather);
  });

  it('takes a pile lying farther whose stance under a standing tree is nearer', () => {
    const sim = newSim();
    const offset = contentIndex(sim.content).maxResourceWorkOffset;
    const [hx, hy, out] = [4, 10, 12];
    pileAt(sim, hx + out, hy, WOOD); // stood on where it lies
    // Lies past the first pile, but the tree it lies under is worked `offset` nodes back towards the seeker.
    resourceAt(sim, hx + out - 1 + offset, hy, WOOD, CHOP, [{ dx: -offset, dy: 0 }]);
    const underTree = pileAt(sim, hx + out - 1 + offset, hy, WOOD);
    const plan = planFor(sim, WOODCUTTER, hx, hy);

    expect(nearestCollectablePileFor(plan)).toEqual({
      pile: underTree,
      goodType: WOOD,
      cell: node(sim, hx + out - 1, hy),
      dist: out - 1,
    });
  });

  it('a flag gatherer takes only the piles it dug itself', () => {
    const sim = newSim();
    const plan = planFor(sim, WOODCUTTER, 4, 10);
    const other = settlerAt(sim, { jobType: WOODCUTTER, tribe: VIKING, position: positionOfNode(8, 10) });
    const foreign = pileAt(sim, 6, 10, WOOD); // nearer, but another gatherer's
    sim.world.add(foreign, HarvestedBy, { by: other });
    const own = pileAt(sim, 12, 10, WOOD);
    sim.world.add(own, HarvestedBy, { by: plan.entity });
    const fresh = { ...plan, targets: collectTargets(sim.world, plan.ctx, plan.terrain) };

    expect(nearestOwnDropFor(fresh)?.pile).toBe(own);
  });
});

describe('claimed piles', () => {
  it('a pile whose unit another settler walks to lift is passed over, an own drop included', () => {
    const sim = newSim();
    const near = pileAt(sim, 8, 10, STONE);
    const far = pileAt(sim, 14, 10, STONE);
    const plan = planFor(sim, MINER, 4, 10);
    sim.world.add(near, HarvestedBy, { by: plan.entity });
    const porter = settlerAt(sim, { jobType: CIVILIST, tribe: VIKING, position: positionOfNode(6, 10) });
    const fresh = { ...plan, targets: collectTargets(sim.world, plan.ctx, plan.terrain) };
    expect(nearestOwnDropFor(fresh)?.pile).toBe(near);

    fresh.supply.stampPickupClaim(porter, { source: near, goodType: STONE, amount: 1 });

    expect(nearestCollectablePileFor(fresh)?.pile).toBe(far);
    expect(nearestOwnDropFor(fresh)).toBeNull();
  });
});

describe('bounded harvest scan', () => {
  it("a hunter's ground scan finds the carcass past the trees", () => {
    const sim = newSim();
    const trees = [resourceAt(sim, 18, 10, WOOD, CHOP), resourceAt(sim, 20, 12, WOOD, CHOP)];
    const carcass = resourceAt(sim, 24, 10, MEAT, CUT_CADAVER);
    const plan = planFor(sim, HUNTER, 16, 10);
    // Caught up before the watch: the resource index reads every node it files, not the scan.
    expect(plan.targets.resources).toHaveLength(trees.length + 1);

    const found = nearestHarvestableFor(plan, { bound: { center: node(sim, 20, 10), radius: 8 } });
    expect(found?.entity).toBe(carcass);
  });

  it('the flag-radius scan keeps an anchor whose work cell reaches the radius', () => {
    const sim = newSim();
    const offset = contentIndex(sim.content).maxResourceWorkOffset;
    const radius = 4;
    const [cx, cy] = [20, 10];
    // Anchor exactly `radius + offset` out, worked from the cell `offset` nodes back towards the flag.
    const edge = resourceAt(sim, cx + radius + offset, cy, WOOD, CHOP, [{ dx: -offset, dy: 0 }]);
    // Inside the query box but beyond reach: a box corner, and an anchor one node past the edge.
    resourceAt(sim, cx + radius + offset, cy + radius + offset, WOOD, CHOP);
    resourceAt(sim, cx - radius - offset - 1, cy, WOOD, CHOP, [{ dx: offset, dy: 0 }]);
    const plan = planFor(sim, WOODCUTTER, cx, cy);

    const flag = node(sim, cx, cy);
    const found = nearestHarvestableFor(plan, { bound: { center: flag, radius }, rank: flag });
    expect(found).toEqual({ entity: edge, cell: node(sim, cx + radius, cy), dist: radius });
  });
});

describe('harvest scan by work cell', () => {
  it('picks a farther anchor whose work cell reaches nearer, as the full scan does', () => {
    const sim = newSim();
    const offset = contentIndex(sim.content).maxResourceWorkOffset;
    const [cx, cy] = [20, 16];
    const farReach = 2 * offset + 2;
    // Lowest ids first, so an ascending-id scan would meet them before the winner.
    resourceAt(sim, cx + farReach + 1, cy, WOOD, CHOP);
    resourceAt(sim, cx, cy + farReach + 1, WOOD, CHOP);
    resourceAt(sim, cx - 3, cy, WOOD, CHOP); // the nearest anchor
    // Its anchor lies beyond the nearest one, but its work cell reaches back to two nodes out.
    const reaching = resourceAt(sim, cx + offset + 2, cy, WOOD, CHOP, [{ dx: -offset, dy: 0 }]);
    const plan = planFor(sim, WOODCUTTER, cx, cy);
    const area = { bound: { center: node(sim, cx, cy), radius: farReach + offset }, rank: node(sim, cx, cy) };

    const found = nearestHarvestableFor(plan, area);
    expect(found).toEqual({ entity: reaching, cell: node(sim, cx + 2, cy), dist: 2 });
    // A diagnostic walks every candidate the old way and lands on the same node.
    expect(nearestHarvestableFor(plan, { ...area, diagnostic: { eligibleInArea: false } })).toEqual(found);
  });
});

describe('collector signpost stance boundary', () => {
  it('uses an alternate allowed stance without drawing from the random stream', () => {
    const sim = newSim();
    const tree = resourceAt(sim, 7, 1, WOOD, CHOP, [
      { dx: -1, dy: 0 },
      { dx: 1, dy: 0 },
    ]);
    const plan = planFor(sim, WOODCUTTER, 1, 1);
    const far = node(sim, 8, 1);
    const confined = {
      ...plan,
      limit: { allowsNode: (cell: NodeId) => cell === far, bounds: { minX: 8, maxX: 8, minY: 1, maxY: 1 } },
    };
    const rng = sim.rng.getState();
    expect(nearestHarvestableFor(confined)).toEqual({ entity: tree, cell: far, dist: 7 });
    expect(sim.rng.getState()).toEqual(rng);
  });
});

describe('harvest scan sources', () => {
  /** A deterministic LCG, so a failure replays. */
  function rng(seed: number): (n: number) => number {
    let s = seed >>> 0;
    return (n) => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s % n;
    };
  }

  const WIDE_W = 400;
  const WIDE_H = 300;
  const TREES = 260;
  const QUERIES = 300;
  /** Gate half-widths: a small gate is searched in its region box, a wide one in growing boxes. */
  const SMALL_GATE = { min: 20, span: 40 };
  const WIDE_GATE = { min: 150, span: 100 };
  const AREA_RADIUS = { min: 10, span: 60 };
  /** The made-up walk's longest length, and the share of nodes it leaves unreached or sends on a detour. */
  const WALK_MAX_STEPS = 94;
  const WALK_UNREACHED_ONE_IN = 6;
  const WALK_DETOUR_SPAN = 30;

  /** A walk from `from` whose lengths scatter over the hex distance, the least a walk can take, so a
   *  search that prunes by distance where the walk decides misses the full scan's winner. A length past
   *  the asked cap is not told, as the real walk's is not. */
  function walkFrom(from: NodeId): WalkLengths {
    const [hx, hy] = [from % WIDE_W, Math.floor(from / WIDE_W)];
    return {
      from,
      maxSteps: WALK_MAX_STEPS,
      stepsTo: (n, within = WALK_MAX_STEPS) => {
        if (n % WALK_UNREACHED_ONE_IN === 0) return NO_WALK;
        const direct = hexDistanceBetween(hx, hy, n % WIDE_W, Math.floor(n / WIDE_W));
        const steps = direct + ((n * 7919) % WALK_DETOUR_SPAN);
        return steps > Math.min(within, WALK_MAX_STEPS) ? NO_WALK : steps;
      },
    };
  }

  it.each([1])(
    'the growing-box, region-box and list searches pick the full scan winner (seed %i)',
    (seed) => {
      const sim = new Simulation({ seed: 1, content: testContent(), map: grassNodeMap(WIDE_W, WIDE_H) });
      const roll = rng(seed);
      const offset = contentIndex(sim.content).maxResourceWorkOffset;
      const trees: Entity[] = [];
      for (let i = 0; i < TREES; i++) {
        const dx = roll(2 * offset + 1) - offset;
        const dy = (roll(2) === 0 ? 1 : -1) * roll(offset - Math.abs(dx) + 1);
        const x = offset + roll(WIDE_W - 2 * offset);
        const y = offset + roll(WIDE_H - 2 * offset);
        // Clusters and lone trees alike, so some searches end in the first box and some cross the map.
        const work = roll(3) === 0 ? [{ dx: 0, dy: 0 }] : [{ dx, dy }];
        trees.push(resourceAt(sim, x, y, roll(5) === 0 ? STONE : WOOD, roll(5) === 0 ? MINE : CHOP, work));
      }
      const base = planFor(sim, WOODCUTTER, 0, 0);
      for (let q = 0; q < QUERIES; q++) {
        const here = node(sim, roll(WIDE_W), roll(WIDE_H));
        // Sparse on odd queries, so their searches run past the first boxes.
        const exclude = new Set(trees.filter(() => (q % 2 === 0 ? roll(4) === 0 : roll(16) !== 0)));
        let plan: PlannerContext = { ...base, here };
        if (roll(3) === 0) {
          const [cx, cy] = [roll(WIDE_W), roll(WIDE_H)];
          const size = roll(2) === 0 ? SMALL_GATE : WIDE_GATE;
          const half = size.min + roll(size.span);
          const bounds = { minX: cx - half, maxX: cx + half, minY: cy - half, maxY: cy + half };
          const allowsNode = (cell: NodeId): boolean => {
            const x = cell % WIDE_W;
            const y = Math.floor(cell / WIDE_W);
            return x >= bounds.minX && x <= bounds.maxX && y >= bounds.minY && y <= bounds.maxY;
          };
          plan = { ...plan, limit: { bounds, allowsNode } };
        }
        const area =
          roll(4) === 0
            ? {
                center: node(sim, roll(WIDE_W), roll(WIDE_H)),
                radius: AREA_RADIUS.min + roll(AREA_RADIUS.span),
              }
            : undefined;
        // Ranked from the seeker or from the area's centre, as a flag is, and every third query by a walk
        // from there, so the same searches also run under the walk's order.
        const origin = area !== undefined && roll(2) === 0 ? area.center : here;
        const opts = { exclude, bound: area, rank: q % 3 === 0 ? walkFrom(origin) : origin };
        const full = nearestHarvestableFor(plan, { ...opts, diagnostic: { eligibleInArea: false } });
        expect(nearestHarvestableFor(plan, opts), `query ${q}`).toEqual(full);
        expect(
          nearestHarvestableFor(plan, { ...opts, candidates: plan.targets.resources }),
          `listed query ${q}`,
        ).toEqual(full);
      }
    },
  );
});

describe('growing-box harvest search edges', () => {
  it('reaches past a box for a work cell nearer than the winner inside it', () => {
    const offset = contentIndex(testContent()).maxResourceWorkOffset;
    const [ox, oy] = [2, 2];
    const missed: number[] = [];
    // Every distance across the first box edges: the winner inside a box sits `k` out, and a node anchored
    // just past it is worked from a cell one node nearer.
    for (let k = offset + 1; k <= EDGE_SWEEP_MAX; k++) {
      const sim = new Simulation({
        seed: 1,
        content: testContent(),
        map: grassNodeMap(EDGE_SWEEP_MAX + 2 * offset + 4, 6),
      });
      resourceAt(sim, ox + k, oy, WOOD, CHOP);
      const nearer = resourceAt(sim, ox + k - 1 + offset, oy, WOOD, CHOP, [{ dx: -offset, dy: 0 }]);
      if (nearestHarvestableFor(planFor(sim, WOODCUTTER, ox, oy))?.entity !== nearer) missed.push(k);
    }
    expect(missed).toEqual([]);
  });
});
