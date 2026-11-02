import { type FootprintCell, footprintCellDx } from '@open-northland/data';
import {
  aiControlEntity,
  playerPlacementTribes,
  Resource,
  StalledPlacements,
} from '../../../../components/index.js';
import type { Entity, World } from '../../../../ecs/world.js';
import { type HalfCellNode, nodeManhattan } from '../../../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../../../nav/terrain/index.js';
import { buildingTypeByContentId, goodTypeByContentId } from '../../../ai-shared/content-lookup.js';
import { anchorNodeOf } from '../../../ai-shared/node-geometry.js';
import type { SystemContext } from '../../../context.js';
import { buildingFootprintOf } from '../../../footprint/geometry.js';
import { placementBlockerGrid } from '../../../footprint/placement/blocker-grid.js';
import { OBSTACLE, resourceBlockerCells } from '../../../footprint/placement/blockers.js';
import { forEachResourceNear } from '../../../spatial/resources.js';
import {
  type BuildLineId,
  type BuildOrder,
  linesByPriority,
  type StepKey,
  seatTuning,
  stepKey,
} from '../../build-order/index.js';
import { plottedNodes } from '../../build-order/plots.js';
import { CLEARING_GOOD_IDS } from './wanted-goods.js';

/** How far from a tree or rock's anchor its walk body may block ground, in Manhattan half-cell nodes
 *  (authored): the resources whose bodies may reach a chosen patch are all aimed at. */
const CLEARING_BODY_NODES = 2;

export const NO_AIM: ReadonlySet<Entity> = new Set();

/** A node's verdict for a building's zone: open ground, ground blocked only by what a post clears (one
 *  node of clearing each), or ground the building may never take. */
const FREE = 0;
const CLEARABLE = 1;
const NEVER = 2;
type Verdict = typeof FREE | typeof CLEARABLE | typeof NEVER;

/**
 * The trees and rocks the seat's generic posts clear first while a placement finds no spot: those standing
 * on the patch, within the build search's reach of the base, that the stalled building would take with the
 * fewest blocked nodes once cleared (the nearest to the base on a tie). The placement is the holding step of
 * the seat's highest-priority line, so a seat whose defence comes first clears for its barracks. Ground the
 * building may never take (unbuildable terrain, another building's zone, a road, a blocker no clearing
 * resource stands by) rules a patch out. Empty while nothing stalls, for a step that is no placement, when
 * some patch fits already, or when none would ever fit. Authored, from skirmish observation: nearest-first
 * posts never cleared a patch that would fit, and the aim does.
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
  if (type === undefined) return NO_AIM;
  const patch = clearingPatch(world, ctx, terrain, player, type.typeId, tribe, baseNode);
  // A patch that fits already: the search failed on something else.
  return patch === null || patch.cost === 0 ? NO_AIM : patch.resources();
}

/** The patch a building of `typeId` would take within the seat's build reach of its base with the fewest
 *  blocked nodes, the nearest to the base on a tie and the first found with none. */
interface ClearingPatch {
  readonly x: number;
  readonly y: number;
  readonly cost: number;
  /** The clearing resources on the patch. */
  resources(): ReadonlySet<Entity>;
}

/** {@link ClearingPatch} for the seat, off ground another building's plot keeps
 *  (`../../build-order/plots.ts`) and, on an archetype keeping to its own land, on the base's land; null
 *  when the type has no zone or no patch would ever take it. */
export function clearingPatch(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
  typeId: number,
  tribe: number,
  baseNode: HalfCellNode,
): ClearingPatch | null {
  const zone = buildingFootprintOf(ctx.content, typeId, tribe)?.reserved;
  if (zone === undefined || zone.length === 0) return null;
  const tuning = seatTuning(world, player);
  const reach = tuning.reachNodes;
  const plotted = plottedNodes(world, ctx, terrain, player, typeId);
  const home = tuning.homeLandOnly ? terrain.componentOf(terrain.nodeAt(baseNode.hx, baseNode.hy)) : null;
  const refused = (node: NodeId): boolean =>
    plotted?.has(node) === true || (home !== null && terrain.componentOf(node) !== home);
  const ground = ClearingGround.around(world, ctx, terrain, baseNode, reach + zoneSpan(zone), refused);
  let best: { x: number; y: number; cost: number; distance: number } | null = null;
  scan: for (let dy = -reach; dy <= reach; dy++) {
    const span = reach - Math.abs(dy);
    for (let dx = -span; dx <= span; dx++) {
      const x = baseNode.hx + dx;
      const y = baseNode.hy + dy;
      const cost = ground.cost(zone, x, y);
      if (cost === null) continue;
      const distance = Math.abs(dx) + Math.abs(dy);
      if (best === null || cost < best.cost || (cost === best.cost && distance < best.distance))
        best = { x, y, cost, distance };
      if (cost === 0) break scan;
    }
  }
  if (best === null) return null;
  const { x, y, cost } = best;
  return { x, y, cost, resources: () => ground.resourcesOn(zone, x, y) };
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

/** Node verdicts over a box around the base ({@link Verdict}), and the clearing resources by anchor node.
 *  A blocked node is clearable only while every obstacle on it is a clearing resource's walk body. */
class ClearingGround {
  private constructor(
    private readonly terrain: TerrainGraph,
    private readonly minX: number,
    private readonly minY: number,
    private readonly side: number,
    private readonly verdict: Uint8Array,
    private readonly resources: ReadonlyMap<number, readonly Entity[]>,
  ) {}

  static around(
    world: World,
    ctx: SystemContext,
    terrain: TerrainGraph,
    centre: HalfCellNode,
    radius: number,
    refused: (node: NodeId) => boolean,
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
    // Per node, the obstacle stamps of clearing resources' walk bodies, the grid's own contributions.
    const clearable = new Uint16Array(side * side);
    forEachResourceNear(world, centre.hx, centre.hy, radius, (e, hx, hy) => {
      const r = world.get(e, Resource);
      if (r.remaining <= 0 || !clearing.has(r.goodType)) return;
      const i = (hy - minY) * side + (hx - minX);
      if (i < 0 || i >= side * side || hx < minX || hx >= minX + side) return;
      const at = resources.get(i);
      if (at === undefined) resources.set(i, [e]);
      else at.push(e);
      resourceBlockerCells(world, e, (cx, cy, channel) => {
        const x = cx - minX;
        const y = cy - minY;
        if (channel !== OBSTACLE || x < 0 || x >= side || y < 0 || y >= side) return;
        const j = y * side + x;
        clearable[j] = (clearable[j] ?? 0) + 1;
      });
    });
    const grid = placementBlockerGrid(world, ctx.content, terrain);
    const verdict = new Uint8Array(side * side);
    for (let y = 0; y < side; y++) {
      for (let x = 0; x < side; x++) {
        const hx = minX + x;
        const hy = minY + y;
        const i = y * side + x;
        if (!terrain.inBounds(hx, hy)) {
          verdict[i] = NEVER;
          continue;
        }
        const node = terrain.nodeAt(hx, hy);
        const slot = hy * terrain.width + hx;
        const obstacles = grid.obstacle[slot] ?? 0;
        if (
          !terrain.isBuildable(node) ||
          terrain.isRoad(node) ||
          (grid.buildingZone[slot] ?? 0) > 0 ||
          refused(node)
        ) {
          verdict[i] = NEVER;
        } else if (resources.has(i) || obstacles > 0) {
          verdict[i] = obstacles <= (clearable[i] ?? 0) ? CLEARABLE : NEVER;
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
      if (v === NEVER) return null;
      if (v === CLEARABLE) cost++;
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

  private verdictAt(hx: number, hy: number): Verdict {
    const x = hx - this.minX;
    const y = hy - this.minY;
    if (x < 0 || x >= this.side || y < 0 || y >= this.side || !this.terrain.inBounds(hx, hy)) return NEVER;
    const v = this.verdict[y * this.side + x];
    return v === FREE || v === CLEARABLE ? v : NEVER;
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
