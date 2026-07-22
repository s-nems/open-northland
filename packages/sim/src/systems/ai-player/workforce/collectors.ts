import type { ContentSet } from '@open-northland/data';
import { Resource, Settler } from '../../../components/index.js';
import type { Command } from '../../../core/commands/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { HalfCellNode } from '../../../nav/halfcell.js';
import { nodeBoxOfCircles, withinNodeRadius } from '../../../nav/node-metric.js';
import type { TerrainGraph } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import { liveWorkFlag } from '../../economy/flags.js';
import { workFlagPlacementBlocks } from '../../footprint/index.js';
import { settlerMeetsNeed } from '../../progression/index.js';
import { resourcesNearNode } from '../../resource-index.js';
import { type BuildOrderEntry, collectorGoodsWanted } from '../build-order/index.js';
import { AI_DECISION_INTERVAL_TICKS, anchorNodeOf, firstRingNode, nearestLiveResource } from '../shared.js';
import type { SpareForce } from './pool.js';

/** The goods the gatherers collect from game start, by stable content id (user plan: clay, stone,
 *  wood). An id absent from the content set — or with no standing resource left on the map — is
 *  skipped. The build order adds its `collector` entries' goods (e.g. iron) once reached. */
export const COLLECTED_GOOD_IDS: readonly string[] = ['mud', 'stone', 'wood'];

/** Every how many of a seat's decisions the collector flags are re-aimed at the nearest live
 *  resource — the infrequent "nudge the flags after the patch drifted" upkeep (user rule
 *  2026-07-18). 30 decisions ≈ 60 s at the base clock. */
export const FLAG_RELOCATE_EVERY_DECISIONS = 30;

/** A collector's flag stands 2–3 tiles from its resource (user rule) — 4..6 half-cell nodes. */
export const FLAG_MIN_DISTANCE_NODES = 4;
export const FLAG_MAX_DISTANCE_NODES = 6;
/** When the whole 2–3-tile band is blocked, any legal node this close still serves. */
const FLAG_FALLBACK_MAX_DISTANCE_NODES = 12;

/** A wanted collector good with its resolved gatherer trade and harvest atomic. */
export interface WantedGood {
  readonly good: ContentSet['goods'][number];
  readonly harvestAtomic: number;
  readonly job: number;
}

/** The good definition with the given stable content id, or undefined. */
function goodByContentId(content: ContentSet, id: string) {
  return content.goods.find((g) => g.id === id);
}

/** The lowest gatherer trade whose grants include this harvest atomic, or null. */
function harvestJobFor(ctx: SystemContext, harvestAtomic: number): number | null {
  const index = contentIndex(ctx.content);
  let best: number | null = null;
  for (const job of index.harvestJobs) {
    if (!(index.atomicsByJob.get(job)?.has(harvestAtomic) ?? false)) continue;
    if (best === null || job < best) best = job;
  }
  return best;
}

/** The wanted collector goods — the base set plus the build order's reached `collector` entries — in
 *  plan order, each with its gatherer trade resolved. A good missing from the content set or with no
 *  harvest trade is skipped. */
export function wantedCollectorGoods(
  world: World,
  ctx: SystemContext,
  player: number,
  order: readonly BuildOrderEntry[],
): WantedGood[] {
  const goodIds = [...COLLECTED_GOOD_IDS];
  for (const goodId of collectorGoodsWanted(world, ctx, player, order)) {
    if (!goodIds.includes(goodId)) goodIds.push(goodId);
  }
  const wanted: WantedGood[] = [];
  for (const goodId of goodIds) {
    const good = goodByContentId(ctx.content, goodId);
    const harvestAtomic = good?.atomics?.harvest;
    if (good === undefined || harvestAtomic === undefined) continue; // not in this content set
    const job = harvestJobFor(ctx, harvestAtomic);
    if (job === null) continue;
    wanted.push({ good, harvestAtomic, job });
  }
  return wanted;
}

/** Whether any live resource of `goodType` remains inside the flag's work circle (the world-metric
 *  circle the gatherer harvests in) — the "patch ran dry, move the flag" probe. */
function patchAlive(world: World, goodType: number, flagNode: HalfCellNode, radius: number): boolean {
  // The region-index box must contain the anisotropic circle (±radius nodes E/W, wider in rows).
  const box = nodeBoxOfCircles([{ x: flagNode.hx, y: flagNode.hy, r: radius }]);
  const reach = Math.max(box.maxX - flagNode.hx, box.maxY - flagNode.hy);
  for (const e of resourcesNearNode(world, flagNode.hx, flagNode.hy, reach)) {
    const r = world.get(e, Resource);
    if (r.goodType !== goodType || r.remaining <= 0) continue;
    const node = anchorNodeOf(world, e);
    if (node === null) continue;
    if (withinNodeRadius(flagNode.hx, flagNode.hy, node.hx, node.hy, radius)) return true;
  }
  return false;
}

/** The closest legal work-flag node in the 2–3-tile band around a resource (falling back to any
 *  nearby legal node when the band is fully blocked), or null. One blocker scan per call. */
function flagSpotNear(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  resource: HalfCellNode,
): HalfCellNode | null {
  const blocked = workFlagPlacementBlocks(world, ctx.content, terrain);
  const legal = (x: number, y: number): boolean =>
    terrain.inBounds(x, y) && terrain.isWalkable(terrain.nodeAt(x, y)) && !blocked.has(terrain.nodeAt(x, y));
  const inBand = (x: number, y: number): boolean =>
    Math.abs(x - resource.hx) + Math.abs(y - resource.hy) >= FLAG_MIN_DISTANCE_NODES && legal(x, y);
  return (
    firstRingNode(resource.hx, resource.hy, FLAG_MAX_DISTANCE_NODES, inBand) ??
    firstRingNode(resource.hx, resource.hy, FLAG_FALLBACK_MAX_DISTANCE_NODES, legal)
  );
}

/**
 * Phase 1: keep one flag-bound gatherer per wanted good, its flag standing 2–3 tiles from the nearest
 * live resource (the per-good decisions are commented inline below). No-op on a mapless sim — no cells
 * to place flags over. Source basis: user rules 2026-07-17 / -18.
 */
export function allocateCollectors(
  world: World,
  ctx: SystemContext,
  hq: Entity,
  wanted: readonly WantedGood[],
  collectorByGood: Map<number, Entity>,
  force: SpareForce,
  builderJob: number | null,
): Command[] {
  const terrain = ctx.terrain;
  if (terrain === undefined) return [];
  const commands: Command[] = [];
  const index = contentIndex(ctx.content);

  // Whether this settler's accrued XP clears the good's `needforgood` thresholds — the same gate the
  // harvest pick applies (`nearestHarvestableFor`), so the allocator never posts a collector its own
  // target scan would refuse (iron/gold demand clay/stone-track XP in the base data).
  const meetsNeed = (e: Entity, goodType: number): boolean => {
    const s = world.get(e, Settler);
    return settlerMeetsNeed(ctx, s.tribe, 'good', goodType, s.experience);
  };
  // Whether ANY accrued-XP threshold gates the good for this tribe — a gated good needs a veteran, an
  // ungated one accepts any fresh hire.
  const needGated = (tribe: number, goodType: number): boolean => {
    const tribeType = index.tribes.get(tribe);
    if (tribeType === undefined) return false;
    return tribeType.jobRequirements.some(
      (r) => r.requirement === 'need' && r.target === 'good' && r.targetId === goodType,
    );
  };
  // The infrequent flag upkeep: on every FLAG_RELOCATE_EVERY_DECISIONS-th decision, a flag whose nearest
  // live resource has drifted out of the 2–3-tile band is re-planted beside it — a live-but-receding
  // patch otherwise keeps the flag parked at its original spot.
  const relocateDue = Math.floor(ctx.tick / AI_DECISION_INTERVAL_TICKS) % FLAG_RELOCATE_EVERY_DECISIONS === 0;

  const hqNode = anchorNodeOf(world, hq);
  for (const w of wanted) {
    const holder = collectorByGood.get(w.good.typeId);
    if (holder !== undefined) {
      const flag = liveWorkFlag(world, holder);
      const flagNode = flag === undefined ? null : anchorNodeOf(world, flag.flag);
      if (flag === undefined || flagNode === null) continue; // vanished mid-decision — next pass rehires
      if (patchAlive(world, w.good.typeId, flagNode, flag.radius)) {
        if (!relocateDue) continue;
        const near = nearestLiveResource(world, w.good.typeId, flagNode);
        const nearNode = near === null ? null : anchorNodeOf(world, near);
        if (nearNode === null) continue;
        const drift = Math.abs(nearNode.hx - flagNode.hx) + Math.abs(nearNode.hy - flagNode.hy);
        if (drift <= FLAG_MAX_DISTANCE_NODES) continue; // still in the band — leave the flag be
        const spot = flagSpotNear(world, ctx, terrain, nearNode);
        if (spot !== null && (spot.hx !== flagNode.hx || spot.hy !== flagNode.hy)) {
          commands.push({ kind: 'setWorkFlag', entity: holder, x: spot.hx, y: spot.hy });
        }
        continue;
      }
      const next = nearestLiveResource(world, w.good.typeId, flagNode);
      if (next === null) {
        // The map ran out of this good — the collector rejoins the builder pool.
        if (builderJob !== null) commands.push({ kind: 'setJob', entity: holder, jobType: builderJob });
        continue;
      }
      const node = anchorNodeOf(world, next);
      const spot = node === null ? null : flagSpotNear(world, ctx, terrain, node);
      if (spot !== null) commands.push({ kind: 'setWorkFlag', entity: holder, x: spot.hx, y: spot.hy });
      continue;
    }
    if (hqNode === null) continue;
    const resource = nearestLiveResource(world, w.good.typeId, hqNode);
    if (resource === null) continue; // nothing of this good on the map — no collector wanted
    const node = anchorNodeOf(world, resource);
    const spot = node === null ? null : flagSpotNear(world, ctx, terrain, node);
    if (spot === null) continue;
    const spare = force.take((e) => meetsNeed(e, w.good.typeId));
    if (spare !== null) {
      commands.push({ kind: 'setJob', entity: spare, jobType: w.job });
      commands.push({ kind: 'setWorkFlag', entity: spare, x: spot.hx, y: spot.hy });
      commands.push({ kind: 'setGatherGood', entity: spare, goodType: w.good.typeId });
      continue;
    }
    // No qualified spare. For an XP-gated good, re-post a veteran collector of an ungated good (a
    // clay/stone digger clears iron's threshold after one completed dig); its vacated good is rehired
    // from the pool on a later decision — the plan-order loop self-heals.
    for (const other of wanted) {
      if (other === w) continue;
      const veteran = collectorByGood.get(other.good.typeId);
      if (veteran === undefined) continue;
      const s = world.get(veteran, Settler);
      if (needGated(s.tribe, other.good.typeId)) continue; // its own post needs a veteran too — keep it
      if (!meetsNeed(veteran, w.good.typeId)) continue;
      if (s.jobType !== w.job) commands.push({ kind: 'setJob', entity: veteran, jobType: w.job });
      commands.push({ kind: 'setWorkFlag', entity: veteran, x: spot.hx, y: spot.hy });
      commands.push({ kind: 'setGatherGood', entity: veteran, goodType: w.good.typeId });
      collectorByGood.delete(other.good.typeId);
      break;
    }
  }
  return commands;
}
