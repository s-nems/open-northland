import { GROUND_LAND } from '@open-northland/data';
import { DeliveryFlag, Felling, Position, Resource, TreeRegrow } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { BlockOverlay } from '../../nav/block-overlay.js';
import { hexRingHx, hexRingHy, hexRingLength, nodeOfPosition } from '../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { System, SystemContext } from '../context.js';
import { dynamicBlockOverlay } from '../footprint/blocked.js';
import { createResourceNode } from '../footprint/index.js';
import { type PlacementGrid, placementBlockerGrid } from '../footprint/placement/blocker-grid.js';
import { landscapesWithin } from '../landscape/view.js';
import { bushesAtNode } from '../spatial/bushes.js';
import { entityNode } from '../spatial/nodes.js';
import { resourcesAtNode } from '../spatial/resources.js';
import { stockpilesAtNode } from '../spatial/stockpiles.js';
import { stumpsAtNode } from '../spatial/stumps.js';
import { settleClosedTree, startTreeGrowth } from './tree-growth.js';

// Original behavior throughout: a felled tree may seed one sapling nearby, after a delay, inside a forest.

/** A felled tree's regrowth comes due this many ticks after the fall plus a random share of the spread:
 *  5 to 20 minutes at 12 ticks a second. */
export const TREE_REGROW_DELAY_MIN_TICKS = 3600;
export const TREE_REGROW_DELAY_SPREAD_TICKS = 10800;
/** One regrowth in ten seeds nothing. */
export const TREE_REGROW_FAIL_PERCENT = 10;
const PERCENT = 100;
/** The steps the search walks out from the felled tree along the ground's edges. */
const SEARCH_STEPS = 11;
/** The search stops at this many sapling spots and picks one of them at random. */
const MAX_SPOTS = 20;
/** No road may run on a spot or this many rings around it. */
const ROAD_FREE_RINGS = 2;
/** Neither the spot nor its first ring may be walk- or build-blocked. */
const BLOCK_FREE_RINGS = 1;
/** A spot is in the forest with more than five trees, saplings counted, in these rings around it. */
const FOREST_RINGS = 5;
export const TREE_REGROW_FOREST_TREES = 6;
/** The valency a sapling sprouts at. */
const SAPLING_LEVEL = 1;
/** At most this many regrowths wait at once; a tree felled while they all do schedules none. */
export const TREE_REGROW_MAX_PENDING = 300;

/** Schedule the regrowth a `tree` felled now may bring, before its node is removed. */
export function scheduleTreeRegrow(world: World, ctx: SystemContext, tree: Entity): void {
  if (regrowthsPending(world) >= TREE_REGROW_MAX_PENDING) return;
  const res = world.get(tree, Resource);
  const pos = world.get(tree, Position);
  const { hx, hy } = nodeOfPosition(pos.x, pos.y);
  const e = world.create();
  world.add(e, TreeRegrow, {
    dueAtTick: ctx.tick + TREE_REGROW_DELAY_MIN_TICKS + ctx.rng.int(TREE_REGROW_DELAY_SPREAD_TICKS),
    hx,
    hy,
    goodType: res.goodType,
    harvestAtomic: res.harvestAtomic,
    wood: res.remaining,
    gfxIndex: res.gfxIndex,
  });
}

function regrowthsPending(world: World): number {
  let pending = 0;
  for (const _ of world.query(TreeRegrow)) if (++pending >= TREE_REGROW_MAX_PENDING) break;
  return pending;
}

/** Run every regrowth that has come due, in the order the trees fell. */
export const treeRegrowSystem: System = (world, ctx) => {
  const due: Entity[] = [];
  for (const e of world.query(TreeRegrow)) if (world.get(e, TreeRegrow).dueAtTick <= ctx.tick) due.push(e);
  for (const e of due) {
    const regrow = { ...world.get(e, TreeRegrow) };
    world.destroy(e);
    regrowTree(world, ctx, regrow);
  }
};

function regrowTree(
  world: World,
  ctx: SystemContext,
  regrow: Readonly<{
    hx: number;
    hy: number;
    goodType: number;
    harvestAtomic: number;
    wood: number;
    gfxIndex?: number | undefined;
  }>,
): void {
  if (ctx.rng.int(PERCENT) < TREE_REGROW_FAIL_PERCENT) return;
  const terrain = ctx.terrain;
  if (terrain === undefined || !terrain.inBounds(regrow.hx, regrow.hy)) return;
  const start = terrain.nodeAt(regrow.hx, regrow.hy);
  if (terrain.groundKinds !== undefined && terrain.groundKinds[start] !== GROUND_LAND) return;
  const test = new SpotTest(world, ctx, terrain);
  const spots = saplingSpots(test, terrain, start);
  if (spots.length === 0) return;
  const spot = spots[ctx.rng.int(spots.length)];
  // The draw of a marked spot seeds nothing: no landscape is ever set on a signpost.
  if (spot === undefined || test.holdsMarker(spot)) return;
  const sapling = createResourceNode(world, ctx.content, {
    good: regrow.goodType,
    x: terrain.xOf(spot),
    y: terrain.yOf(spot),
    remaining: regrow.wood,
    harvestAtomic: regrow.harvestAtomic,
    felling: true,
    blockLevel: SAPLING_LEVEL,
    ...(regrow.gfxIndex !== undefined ? { gfxIndex: regrow.gfxIndex } : {}),
  });
  if (sapling === null) return;
  startTreeGrowth(world, ctx.content, sapling, SAPLING_LEVEL);
  // A record whose sapling already blocks its anchor closes the node under whoever stands there.
  settleClosedTree(world, ctx, sapling);
}

/** The first {@link MAX_SPOTS} spots a sapling may take, in breadth-first order from `start` over the
 *  ground's edges, whatever stands on them. */
function saplingSpots(test: SpotTest, terrain: TerrainGraph, start: NodeId): NodeId[] {
  const spots: NodeId[] = [];
  if (test.takesSapling(start)) spots.push(start);
  const seen = new Set<NodeId>([start]);
  let frontier = [start];
  for (let step = 0; step < SEARCH_STEPS && frontier.length > 0 && spots.length < MAX_SPOTS; step++) {
    const next: NodeId[] = [];
    for (const node of frontier) {
      for (const neighbour of terrain.neighbours(node)) {
        if (seen.has(neighbour) || !terrain.joined(node, neighbour)) continue;
        seen.add(neighbour);
        next.push(neighbour);
        if (test.takesSapling(neighbour)) spots.push(neighbour);
        if (spots.length === MAX_SPOTS) return spots;
      }
    }
    frontier = next;
  }
  return spots;
}

/**
 * Whether a sapling may sprout on a node. Approximations: the node's plantable ground stands for its six
 * triangles' `biocangrowon` and `biocanplanton`, the dynamic walk overlay and ground no walker crosses
 * for the walk-blocked points, and the placement grid's exclusion and building zones, a wall site's body
 * and ground no building takes for the build-blocked ones.
 */
class SpotTest {
  private overlay: BlockOverlay | undefined;
  private grid: PlacementGrid | undefined;
  private flags: ReadonlySet<NodeId> | undefined;
  private readonly trees = new Map<NodeId, number>();

  constructor(
    private readonly world: World,
    private readonly ctx: SystemContext,
    private readonly terrain: TerrainGraph,
  ) {}

  takesSapling(node: NodeId): boolean {
    const terrain = this.terrain;
    const hx = terrain.xOf(node);
    const hy = terrain.yOf(node);
    return (
      !this.holdsLandscape(hx, hy) &&
      terrain.isPlantable(node) &&
      // The block test first: in a forest it turns down most nodes, at a third of the road test's rings.
      this.ringsHold(hx, hy, 0, BLOCK_FREE_RINGS, (n) => !this.blocked(n)) &&
      this.ringsHold(hx, hy, 0, ROAD_FREE_RINGS, (n) => !terrain.isRoad(n)) &&
      this.inForest(hx, hy)
    );
  }

  /** A signpost on the node, which stays a spot. Project rule: a parked vehicle, which shares the
   *  signposts' grid channel, and a work flag count as one. */
  holdsMarker(node: NodeId): boolean {
    if ((this.placementGrid().movableBody[node] ?? 0) > 0) return true;
    this.flags ??= new Set(
      [...this.world.query(DeliveryFlag, Position)].map((e) => entityNode(this.world, this.terrain, e)),
    );
    return this.flags.has(node);
  }

  /** Any landscape object on the node: a resource, a heap, a stump, a bush or a map or script placement. */
  private holdsLandscape(hx: number, hy: number): boolean {
    const world = this.world;
    return (
      resourcesAtNode(world, hx, hy).length > 0 ||
      stockpilesAtNode(world, hx, hy).length > 0 ||
      stumpsAtNode(world, hx, hy).length > 0 ||
      bushesAtNode(world, hx, hy).length > 0 ||
      landscapesWithin(world, this.terrain, { hx, hy }, 0).length > 0
    );
  }

  private blocked(node: NodeId): boolean {
    const terrain = this.terrain;
    if (!terrain.isWalkable(node) || !terrain.isBuildable(node)) return true;
    this.overlay ??= dynamicBlockOverlay(this.world, this.ctx, terrain);
    if (this.overlay.has(node)) return true;
    const grid = this.placementGrid();
    return (
      (grid.exclusion[node] ?? 0) > 0 ||
      (grid.buildingZone[node] ?? 0) > 0 ||
      (grid.palisadeBody[node] ?? 0) > 0
    );
  }

  private placementGrid(): PlacementGrid {
    this.grid ??= placementBlockerGrid(this.world, this.ctx.content, this.terrain);
    return this.grid;
  }

  /** Off-map rings reject the spot, so they are checked first; the count stops at a forest. */
  private inForest(hx: number, hy: number): boolean {
    const terrain = this.terrain;
    if (!this.ringsHold(hx, hy, 1, FOREST_RINGS, () => true)) return false;
    let trees = 0;
    for (let ring = 1; ring <= FOREST_RINGS; ring++) {
      for (let i = 0; i < hexRingLength(ring); i++) {
        trees += this.treesOn(terrain.nodeAt(hexRingHx(hx, hy, ring, i), hexRingHy(hy, ring, i)));
        if (trees >= TREE_REGROW_FOREST_TREES) return true;
      }
    }
    return false;
  }

  /** The trees anchored on a node, counted once per search: neighbouring spots share most of their rings. */
  private treesOn(node: NodeId): number {
    const known = this.trees.get(node);
    if (known !== undefined) return known;
    let trees = 0;
    for (const e of resourcesAtNode(this.world, this.terrain.xOf(node), this.terrain.yOf(node))) {
      if (this.world.has(e, Felling)) trees++;
    }
    this.trees.set(node, trees);
    return trees;
  }

  /** Whether `test` holds on every node of rings `from` to `to` around `(hx, hy)`, all on the map. */
  private ringsHold(
    hx: number,
    hy: number,
    from: number,
    to: number,
    test: (node: NodeId) => boolean,
  ): boolean {
    const terrain = this.terrain;
    for (let ring = from; ring <= to; ring++) {
      for (let i = 0; i < hexRingLength(ring); i++) {
        const x = hexRingHx(hx, hy, ring, i);
        const y = hexRingHy(hy, ring, i);
        if (!terrain.inBounds(x, y) || !test(terrain.nodeAt(x, y))) return false;
      }
    }
    return true;
  }
}
