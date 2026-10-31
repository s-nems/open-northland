import { type FootprintCell, footprintCellDx } from '@open-northland/data';
import {
  aiControlEntity,
  playerPlacementTribes,
  Resource,
  StalledPlacements,
} from '../../../../components/index.js';
import type { Entity, World } from '../../../../ecs/world.js';
import { type HalfCellNode, nodeManhattan } from '../../../../nav/halfcell.js';
import type { TerrainGraph } from '../../../../nav/terrain/index.js';
import { buildingTypeByContentId, goodTypeByContentId } from '../../../ai-shared/content-lookup.js';
import { anchorNodeOf } from '../../../ai-shared/node-geometry.js';
import type { SystemContext } from '../../../context.js';
import { buildingFootprintOf } from '../../../footprint/geometry.js';
import { placementBlockerGrid } from '../../../footprint/placement/blocker-grid.js';
import { forEachResourceNear } from '../../../spatial/resources.js';
import {
  type BuildLineId,
  type BuildOrder,
  linesByPriority,
  type StepKey,
  seatTuning,
  stepKey,
} from '../../build-order/index.js';
import { CLEARING_GOOD_IDS } from './wanted-goods.js';

/** How far from a tree or rock's anchor its walk body may block ground, in Manhattan half-cell nodes
 *  (authored): a node blocked within this of a clearing resource is taken for that resource's body, one
 *  blocked farther from every one for ground no post can clear. */
const CLEARING_BODY_NODES = 2;

const NO_AIM: ReadonlySet<Entity> = new Set();

/**
 * The trees and rocks the seat's generic posts clear first while a placement finds no spot: those standing
 * on the patch, within the build search's reach of the base, that the stalled building would take with the
 * fewest blocked nodes once cleared (the nearest to the base on a tie). The placement is the holding step of
 * the seat's highest-priority line, so a seat whose defence comes first clears for its barracks. Ground the
 * building may never take (unbuildable terrain, another building's zone, a road, a blocker no clearing
 * resource stands by) rules a patch out. Empty while nothing stalls, for a step that is no placement, when
 * some patch fits already, or when none would ever fit. On smocza_kraina no barracks or home fitted
 * anywhere by game minute 9 on two seats while patches of 14 to 37 blocked nodes would, and the
 * nearest-first posts never cleared one; with the aim every seat placed its barracks by minute 28-54.
 * Costs the reach's nodes once and the building's zone per candidate anchor, only while a placement stalls.
 */
export function clearingAim(
  world: World,
  ctx: SystemContext,
  player: number,
  order: BuildOrder,
  baseNode: HalfCellNode,
): ReadonlySet<Entity> {
  const terrain = ctx.terrain;
  const carrier = aiControlEntity(world, player);
  const holding = carrier === null ? undefined : world.tryGet(carrier, StalledPlacements)?.holding;
  const tribe = playerPlacementTribes(world, player)?.[0];
  if (terrain === undefined || holding === undefined || holding.size === 0 || tribe === undefined)
    return NO_AIM;
  const building = stalledBuilding(order, holding);
  const type = building === null ? undefined : buildingTypeByContentId(ctx.content, building);
  const zone =
    type === undefined ? undefined : buildingFootprintOf(ctx.content, type.typeId, tribe)?.reserved;
  if (zone === undefined || zone.length === 0) return NO_AIM;
  const reach = seatTuning(world, player).reachNodes;
  const ground = ClearingGround.around(world, ctx, terrain, baseNode, reach + zoneSpan(zone));
  let best: { x: number; y: number; cost: number; distance: number } | null = null;
  for (let dy = -reach; dy <= reach; dy++) {
    const span = reach - Math.abs(dy);
    for (let dx = -span; dx <= span; dx++) {
      const x = baseNode.hx + dx;
      const y = baseNode.hy + dy;
      const cost = ground.cost(zone, x, y);
      if (cost === null) continue;
      if (cost === 0) return NO_AIM; // the ground fits already: the search failed on something else
      const distance = Math.abs(dx) + Math.abs(dy);
      if (best === null || cost < best.cost || (cost === best.cost && distance < best.distance))
        best = { x, y, cost, distance };
    }
  }
  return best === null ? NO_AIM : ground.resourcesOn(zone, best.x, best.y);
}

/** The building of the first holding step, in line priority, that places one. */
function stalledBuilding(order: BuildOrder, holding: ReadonlyMap<BuildLineId, StepKey>): string | null {
  for (const line of linesByPriority(order)) {
    const key = holding.get(line.id);
    if (key === undefined) continue;
    for (const [step, entry] of line.steps.entries()) {
      if (stepKey(line.id, step) !== key) continue;
      if (entry.kind === 'place') return entry.building;
    }
  }
  return null;
}

/** How far a zone reaches from its anchor, in Manhattan nodes. */
function zoneSpan(zone: readonly FootprintCell[]): number {
  let span = 0;
  for (const c of zone) span = Math.max(span, Math.abs(c.dx) + 1 + Math.abs(c.dy));
  return span;
}

/** Node verdicts over a box around the base: ground a building may never take, ground blocked by a
 *  clearing resource or its body, and the clearing resources by anchor node. */
class ClearingGround {
  private constructor(
    private readonly terrain: TerrainGraph,
    private readonly minX: number,
    private readonly minY: number,
    private readonly side: number,
    /** 0 free, 1 blocked by something a post clears, 2 never buildable. */
    private readonly verdict: Uint8Array,
    private readonly resources: ReadonlyMap<number, readonly Entity[]>,
  ) {}

  static around(
    world: World,
    ctx: SystemContext,
    terrain: TerrainGraph,
    centre: HalfCellNode,
    radius: number,
  ): ClearingGround {
    const side = 2 * radius + 1;
    const minX = centre.hx - radius;
    const minY = centre.hy - radius;
    const clearing = new Set<number>();
    for (const id of CLEARING_GOOD_IDS) {
      const good = goodTypeByContentId(ctx.content, id);
      if (good !== undefined) clearing.add(good.typeId);
    }
    const resources = new Map<number, Entity[]>();
    const near = new Uint8Array(side * side);
    forEachResourceNear(world, centre.hx, centre.hy, radius, (e, hx, hy) => {
      const r = world.get(e, Resource);
      if (r.remaining <= 0 || !clearing.has(r.goodType)) return;
      const i = (hy - minY) * side + (hx - minX);
      if (i < 0 || i >= side * side || hx < minX || hx >= minX + side) return;
      const at = resources.get(i);
      if (at === undefined) resources.set(i, [e]);
      else at.push(e);
      for (let dy = -CLEARING_BODY_NODES; dy <= CLEARING_BODY_NODES; dy++) {
        const span = CLEARING_BODY_NODES - Math.abs(dy);
        for (let dx = -span; dx <= span; dx++) {
          const x = hx + dx - minX;
          const y = hy + dy - minY;
          if (x >= 0 && x < side && y >= 0 && y < side) near[y * side + x] = 1;
        }
      }
    });
    const grid = placementBlockerGrid(world, ctx.content, terrain);
    const verdict = new Uint8Array(side * side);
    for (let y = 0; y < side; y++) {
      for (let x = 0; x < side; x++) {
        const hx = minX + x;
        const hy = minY + y;
        const i = y * side + x;
        if (!terrain.inBounds(hx, hy)) {
          verdict[i] = 2;
          continue;
        }
        const node = terrain.nodeAt(hx, hy);
        const slot = hy * terrain.width + hx;
        if (!terrain.isBuildable(node) || terrain.isRoad(node) || (grid.buildingZone[slot] ?? 0) > 0) {
          verdict[i] = 2;
        } else if (resources.has(i) || (grid.obstacle[slot] ?? 0) > 0) {
          verdict[i] = near[i] === 1 ? 1 : 2;
        }
      }
    }
    return new ClearingGround(terrain, minX, minY, side, verdict, resources);
  }

  /** The blocked nodes of `zone` anchored at `(x, y)`, or null when it covers ground never buildable. */
  cost(zone: readonly FootprintCell[], x: number, y: number): number | null {
    let cost = 0;
    for (const c of zone) {
      const v = this.verdictAt(x + footprintCellDx(y, c), y + c.dy);
      if (v === 2) return null;
      cost += v;
    }
    return cost;
  }

  /** The clearing resources anchored under `zone` at `(x, y)` or close enough that their bodies reach it. */
  resourcesOn(zone: readonly FootprintCell[], x: number, y: number): ReadonlySet<Entity> {
    const covered = new Set<number>();
    for (const c of zone) {
      const cx = x + footprintCellDx(y, c) - this.minX;
      const cy = y + c.dy - this.minY;
      for (let dy = -CLEARING_BODY_NODES; dy <= CLEARING_BODY_NODES; dy++) {
        const span = CLEARING_BODY_NODES - Math.abs(dy);
        for (let dx = -span; dx <= span; dx++) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx >= 0 && nx < this.side && ny >= 0 && ny < this.side) covered.add(ny * this.side + nx);
        }
      }
    }
    const aim = new Set<Entity>();
    for (const i of covered) for (const e of this.resources.get(i) ?? []) aim.add(e);
    return aim;
  }

  private verdictAt(hx: number, hy: number): number {
    const x = hx - this.minX;
    const y = hy - this.minY;
    if (x < 0 || x >= this.side || y < 0 || y >= this.side || !this.terrain.inBounds(hx, hy)) return 2;
    return this.verdict[y * this.side + x] ?? 2;
  }
}

/** The aimed resource nearest `from` that `workable` accepts, or null. */
export function nearestAimed(
  world: World,
  aim: ReadonlySet<Entity>,
  from: HalfCellNode,
  workable: (e: Entity) => boolean,
): Entity | null {
  let best: Entity | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const e of aim) {
    if (!world.isAlive(e) || !workable(e)) continue;
    const r = world.tryGet(e, Resource);
    const at = r === undefined || r.remaining <= 0 ? null : anchorNodeOf(world, e);
    if (at === null) continue;
    const distance = nodeManhattan(at, from);
    if (distance < bestDistance || (distance === bestDistance && best !== null && e < best)) {
      best = e;
      bestDistance = distance;
    }
  }
  return best;
}
