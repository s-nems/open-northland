import type { BuildingType, ContentSet, GoodType } from '@open-northland/data';
import {
  type AiModuleId,
  ASSISTANT_COUNTER_MAX,
  ASSISTANT_COUNTER_MIN,
  type AssistantCounterKind,
  AssistantCounters,
  assistantCountersEntity,
  Building,
  Livestock,
  Owner,
  ownerOf,
  Position,
  Resource,
  Settler,
} from '../../components/index.js';
import type { Command } from '../../core/commands/index.js';
import type { ContentIndex } from '../../core/content-index.js';
import { ONE } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import { type HalfCellNode, nodeOfPosition } from '../../nav/halfcell.js';
import { canonicalById } from '../spatial/nodes.js';
import { anyResourceNear, canonicalResources, resourcesNearNode } from '../spatial/resources.js';

// Shared per-seat lookups the strategic modules recompute each decision (once per
// AI_DECISION_INTERVAL_TICKS per seat, so plain canonical scans stay within the RTS budget).

/**
 * Ticks between one seat's decision passes - 2 s at the 12 ticks/s base clock. A genre-convention
 * approximation (Widelands/KaM/Petra re-evaluate strategy on seconds-scale timers, not per tick);
 * per-tick cost scales with decisions, not ticks.
 */
export const AI_DECISION_INTERVAL_TICKS = 24;

/** The building definition carrying the stable content id, or undefined when this content set lacks
 *  it - a module skips such an entry instead of failing, so partial content stays safe. */
export function buildingTypeByContentId(content: ContentSet, id: string): BuildingType | undefined {
  return content.buildings.find((b) => b.id === id);
}

/** The good definition carrying the stable content id, or undefined (same skip contract as
 *  {@link buildingTypeByContentId}). */
export function goodTypeByContentId(content: ContentSet, id: string): GoodType | undefined {
  return content.goods.find((g) => g.id === id);
}

/** The typeIds at or above `target` on its `upgradeTarget` chain: `target` itself plus everything it
 *  upgrades into. The visited guard bounds a malformed cyclic chain. Shared by the build-order
 *  progress counting and the `outskirts` affinity's own-kind exclusion. */
export function tiersAtOrAbove(index: ContentIndex, target: BuildingType): Set<number> {
  const tiers = new Set<number>();
  let step: BuildingType | undefined = target;
  while (step !== undefined && !tiers.has(step.typeId)) {
    tiers.add(step.typeId);
    step = step.upgradeTarget === undefined ? undefined : index.buildings.get(step.upgradeTarget);
  }
  return tiers;
}

/** The first expanding-box reach of the live-resource searches below (Chebyshev half-cell nodes). */
const RESOURCE_BOX_REACH_START = 16;
/**
 * The largest box walked before the live-resource searches fall back to the whole-map reference
 * scan. The cap only bounds the cost of a hopeless neighbourhood - the fallback reproduces the
 * exact linear winner past it - so it is a pure performance knob, not a decoded distance (named
 * approximation; the `RING_MAX_RADIUS` convention).
 */
const RESOURCE_BOX_REACH_MAX = 512;

/** The best `(Manhattan distance, entity id)` live `goodType` resource inside the Chebyshev `reach`
 *  box around `from`, or null. Candidates arrive ascending-id, so the strict `<` keeps the lowest
 *  id among the minimum distance - the same winner the reference scan picks. */
function bestLiveResourceInBox(
  world: World,
  goodType: number,
  from: HalfCellNode,
  reach: number,
): { entity: Entity; distance: number } | null {
  let best: Entity | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const e of resourcesNearNode(world, from.hx, from.hy, reach)) {
    if (!isLiveResource(world, e, goodType)) continue;
    const node = anchorNodeOf(world, e);
    if (node === null) continue;
    const distance = Math.abs(node.hx - from.hx) + Math.abs(node.hy - from.hy);
    if (distance < bestDistance) {
      best = e;
      bestDistance = distance;
    }
  }
  return best === null ? null : { entity: best, distance: bestDistance };
}

/** Whether `e` is a standing not-yet-empty resource of `goodType`. */
function isLiveResource(world: World, e: Entity, goodType: number): boolean {
  const r = world.get(e, Resource);
  return r.goodType === goodType && r.remaining > 0;
}

/**
 * The standing not-yet-empty resource of `goodType` nearest to `from` (Manhattan node distance,
 * ties to the lower entity id), or null when the map holds none. Expanding boxes over the resource
 * region index, so a decision near a stocked neighbourhood never walks the whole canonical list;
 * the whole-map reference scan past the cap keeps the winner byte-identical on a sparse map.
 */
export function nearestLiveResource(world: World, goodType: number, from: HalfCellNode): Entity | null {
  for (let reach = RESOURCE_BOX_REACH_START; reach <= RESOURCE_BOX_REACH_MAX; reach *= 2) {
    const hit = bestLiveResourceInBox(world, goodType, from, reach);
    if (hit === null) continue;
    // A winner at Manhattan ≤ reach is global: every node outside the Chebyshev `reach` box lies at
    // Manhattan ≥ reach+1, so nothing outside can beat or tie it.
    if (hit.distance <= reach) return hit.entity;
    // Only a box-corner hit (Manhattan up to 2·reach): every node at Manhattan ≤ hit.distance lies
    // inside the Chebyshev `hit.distance` box, so one exact re-query settles the winner.
    const exact = bestLiveResourceInBox(world, goodType, from, hit.distance);
    return (exact ?? hit).entity;
  }
  // Nothing within the cap - the reference scan finds the same winner the uncapped search would.
  let best: Entity | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const e of canonicalResources(world)) {
    if (!isLiveResource(world, e, goodType)) continue;
    const node = anchorNodeOf(world, e);
    if (node === null) continue;
    const dist = Math.abs(node.hx - from.hx) + Math.abs(node.hy - from.hy);
    if (dist < bestDist) {
      best = e;
      bestDist = dist;
    }
  }
  return best;
}

/**
 * Whether any not-yet-empty resource of `goodType` stands on the map - existence only, so the first
 * box holding a live node answers without ranking it. `near` seeds the expanding-box search (the
 * seat's base - collector goods are gathered around it); a null seed or a within-cap miss falls back
 * to the early-exit canonical scan, which alone decides a truly dry map.
 */
export function anyLiveResource(world: World, goodType: number, near: HalfCellNode | null): boolean {
  if (near !== null) {
    // The existence-only index path: no collection, no sort, first hit returns - a map holding none of
    // the good (the gated iron entry on an iron-less map) pays box probes, not repeated full sorts.
    for (let reach = RESOURCE_BOX_REACH_START; reach <= RESOURCE_BOX_REACH_MAX; reach *= 2) {
      if (anyResourceNear(world, near.hx, near.hy, reach, (e) => isLiveResource(world, e, goodType))) {
        return true;
      }
    }
  }
  for (const e of canonicalResources(world)) {
    if (isLiveResource(world, e, goodType)) return true;
  }
  return false;
}

/**
 * The standing assistant counters the strategic modules publish, keyed by the module gates that must
 * ALL run for the kinds to stay published (the garrison rung lives inside the workforce module and
 * self-gates on `military`, so its counter needs both). `setPlayerAi`'s teardown (`orders/ai.ts`)
 * withdraws an entry's kinds the moment its conjunction breaks - a headless seat must stop breeding
 * and drafting when its AI does.
 */
export const AI_PUBLISHED_COUNTERS: ReadonlyArray<{
  readonly modules: readonly AiModuleId[];
  readonly kinds: readonly AssistantCounterKind[];
}> = [
  { modules: ['homeExpansion'], kinds: ['extraWomen', 'extraMen'] },
  {
    modules: ['collectResources', 'military'],
    kinds: ['trainSoldiers', 'trainSword', 'trainSpear', 'trainBow'],
  },
];

/**
 * The `setAssistantCounter` command moving `player`'s `kind` to exactly `{value, infinite}`, or null
 * when the counter already sits there - the modules' idempotence convention (a decision that changes
 * nothing issues nothing). `value` is clamped to the counter bounds here, so a want past the cap
 * settles instead of re-issuing an unsatisfiable set every decision. Accepted race: the absolute
 * value is a decision-tick snapshot applied through the command queue one tick later, so a counter
 * payment inside that window is transiently re-added and the next decision corrects it.
 */
export function assistantCounterCommand(
  world: World,
  player: number,
  kind: AssistantCounterKind,
  value: number,
  infinite: boolean,
): Command | null {
  const wanted = Math.min(ASSISTANT_COUNTER_MAX, Math.max(ASSISTANT_COUNTER_MIN, value));
  const carrier = assistantCountersEntity(world, player);
  const current =
    carrier === null ? { value: 0, infinite: false } : world.get(carrier, AssistantCounters).counters[kind];
  if (current.value === wanted && current.infinite === infinite) return null;
  return { kind: 'setAssistantCounter', player, counter: kind, value: wanted, infinite };
}

/** The seat's buildings (any construction state) in canonical ascending-id order. */
export function ownedBuildings(world: World, player: number): Entity[] {
  return canonicalById(world.query(Building, Owner)).filter((e) => ownerOf(world, e) === player);
}

/** The seat's PEOPLE, canonical ascending-id order. Claimed livestock is an owned `Settler` too (the
 *  entity model is shared) and reads as an adult with no trade, so without the exclusion every module
 *  here would treat the herd as manpower: the round-up would hand the pool a cow, `setJob` would make
 *  it a builder (which also poisons the tribe's alive-trade set), and it would count as a bachelor the
 *  garrison may draft against ({@link ownedSettlers} is that count's source for the same reason). */
export function ownedSettlers(world: World, player: number): Entity[] {
  return canonicalById(world.query(Settler, Owner)).filter(
    (e) => ownerOf(world, e) === player && !world.has(e, Livestock),
  );
}

/** Whether the building's construction (or its latest upgrade) is complete. */
export function isBuilt(world: World, e: Entity): boolean {
  return world.get(e, Building).built >= ONE;
}

/** The half-cell node under an entity's Position, or null for an unpositioned entity. */
export function anchorNodeOf(world: World, e: Entity): HalfCellNode | null {
  const pos = world.tryGet(e, Position);
  return pos === undefined ? null : nodeOfPosition(pos.x, pos.y);
}

/** The integer-mean node of the entities' anchors (the settlement centroid when fed the seat's
 *  buildings), or null when none has a Position. Commutative sums - no canonical order needed. */
export function anchorCentroid(world: World, entities: readonly Entity[]): HalfCellNode | null {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (const e of entities) {
    const node = anchorNodeOf(world, e);
    if (node === null) continue;
    sx += node.hx;
    sy += node.hy;
    n++;
  }
  return n === 0 ? null : { hx: Math.floor(sx / n), hy: Math.floor(sy / n) };
}

/**
 * `from` pushed `push` nodes further away from `origin` along the straight `origin → from` ray - the
 * outskirts bias shared by the tower spot and the `outskirts` placement affinity. Integer-trunc ray
 * projection (the `searchCentre` idiom): plain `/` on integer operands is IEEE-exact-rounded, hence
 * byte-identical across engines. Coincident points have no direction - `from` is returned as-is.
 */
export function outwardNode(origin: HalfCellNode, from: HalfCellNode, push: number): HalfCellNode {
  const dx = from.hx - origin.hx;
  const dy = from.hy - origin.hy;
  const dist = Math.abs(dx) + Math.abs(dy);
  if (dist === 0) return from;
  return {
    hx: from.hx + Math.trunc((dx * push) / dist),
    hy: from.hy + Math.trunc((dy * push) / dist),
  };
}

/**
 * The first node accepted while walking expanding Manhattan rings around `(cx, cy)` - the modules'
 * "closest legal spot" pick. Deterministic: ascending radius, then ascending dx, north (y−) before
 * south (y+), so the winner never depends on iteration state. `accept` must reject out-of-bounds
 * nodes itself. Cost is O(maxRadius²) accepts at worst - bounded, never a whole-map scan.
 */
export function firstRingNode(
  cx: number,
  cy: number,
  maxRadius: number,
  accept: (x: number, y: number) => boolean,
): HalfCellNode | null {
  for (let r = 0; r <= maxRadius; r++) {
    for (let dx = -r; dx <= r; dx++) {
      const dy = r - Math.abs(dx);
      if (accept(cx + dx, cy - dy)) return { hx: cx + dx, hy: cy - dy };
      if (dy !== 0 && accept(cx + dx, cy + dy)) return { hx: cx + dx, hy: cy + dy };
    }
  }
  return null;
}
