import {
  Building,
  CurrentAtomic,
  DEFAULT_WORK_FLAG_RADIUS,
  DeliveryFlag,
  HUNTER_WORK_FLAG_RADIUS,
  JobAssignment,
  Position,
  Settler,
  WorkFlag,
  YardDeliveryRoute,
} from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Fixed } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import { nodeOfPosition, positionOfNode } from '../../nav/halfcell.js';
import type { NodeId } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { buildingFlagBody, translatedCells } from '../footprint/geometry.js';
import { nearestWorkFlagPlacement, noteWorkFlagMove } from '../footprint/index.js';
import { isHunterJob } from '../readviews/index.js';
import { canonicalById, clearNavState, entityNode } from '../spatial/nodes.js';

/**
 * The gatherer work-flag lifecycle: create, relocate and destroy of a gatherer's drop-off flag. Minting and
 * removal go through {@link bindFreshFlag} and {@link removeWorkFlag}, so a `DeliveryFlag` exists exactly
 * while a live gatherer references it.
 *
 * A flag is a pure `Position + DeliveryFlag` marker storing no goods; the harvest piles on the ground around
 * it as separate heaps. The work radii are approximations, since the original's work-area sizes are not
 * decoded, and auto-planting a flag the moment a settler becomes a gatherer is an OpenNorthland convention
 * rather than observed behavior.
 */

/** The gatherer's work flag while its flag entity still exists; a stale binding reads as undefined. */
export function liveWorkFlag(
  world: World,
  e: Entity,
): { flag: Entity; radius: number; goodType?: number } | undefined {
  const wf = world.tryGet(e, WorkFlag);
  return wf !== undefined && world.has(wf.flag, Position) ? wf : undefined;
}

function workFlagRadiusFor(ctx: SystemContext, jobType: number | null): number {
  return isHunterJob(ctx.content, jobType) ? HUNTER_WORK_FLAG_RADIUS : DEFAULT_WORK_FLAG_RADIUS;
}

/**
 * The one place a work flag is created: mint a {@link DeliveryFlag} marker at `pos` and bind gatherer `e` to
 * it, re-pointing a stale {@link WorkFlag} or adding a new one.
 */
export function bindFreshFlag(
  world: World,
  ctx: SystemContext,
  e: Entity,
  pos: { x: Fixed; y: Fixed },
): void {
  world.remove(e, YardDeliveryRoute);
  const flag = world.create();
  world.add(flag, Position, { x: pos.x, y: pos.y });
  world.add(flag, DeliveryFlag, {});
  const radius = workFlagRadiusFor(ctx, world.tryGet(e, Settler)?.jobType ?? null);
  if (world.has(e, WorkFlag)) {
    world.write(e, WorkFlag, (wf) => {
      wf.flag = flag;
      wf.radius = radius;
    });
  } else world.add(e, WorkFlag, { flag, radius });
}

/**
 * Move an existing flag marker to `pos` and re-plan its gatherer. Only the marker moves: goods already
 * dropped are separate ground heaps pinned to their own tiles. Three pieces of delivery state cache the old
 * position - the sticky {@link YardDeliveryRoute} goal, an in-flight `pileup` into this flag, and the live
 * nav goal - so all three are dropped and the gatherer re-plans next tick. Omitting `gatherer` scans for the
 * one {@link WorkFlag} referencing `flag`, which the placement push-out needs since it starts from the marker.
 */
export function relocateWorkFlag(
  world: World,
  flag: Entity,
  pos: { x: Fixed; y: Fixed },
  gatherer?: Entity,
): void {
  world.write(flag, Position, (p) => {
    p.x = pos.x;
    p.y = pos.y;
  });
  noteWorkFlagMove(world); // the flag-block overlay keys on its own counter, not a component generation
  // Each match mutates only its own state, so the scan's store order is permitted.
  for (const e of gatherer !== undefined ? [gatherer] : world.query(WorkFlag)) {
    if (world.tryGet(e, WorkFlag)?.flag !== flag) continue;
    const atomic = world.tryGet(e, CurrentAtomic);
    if (atomic?.effect.kind === 'pileup' && atomic.effect.store === flag) world.remove(e, CurrentAtomic);
    world.remove(e, YardDeliveryRoute);
    clearNavState(world, e);
  }
}

/**
 * Push every work flag standing inside `building`'s family body out to the nearest legal field, so a
 * `placeBuilding` over already-flagged ground cannot seal one inside walls no flag may be planted on.
 *
 * The body is the family-wide {@link buildingFlagBody}, not the walk-blocked set the settler twin uses:
 * flag legality is family-body-wide, so a construction finish or a home tier upgrade encloses no cell that
 * was not already flag-blocked the moment the {@link Building} appeared, and only `placeBuilding` needs
 * this pass. Flags relocate in canonical ascending-id order and each search re-reads the live blocker set,
 * so an earlier evictee's new cell already blocks the next pick and no claimed-set has to be threaded.
 *
 * Authored: push-out, chosen over refusing the placement so the building rule keeps ignoring markers; the
 * original's handling of a house raised over a standing flag is unobserved.
 */
export function evictWorkFlagsFromFootprint(world: World, ctx: SystemContext, building: Entity): void {
  const terrain = ctx.terrain;
  if (terrain === undefined) return;
  const b = world.tryGet(building, Building);
  const p = world.tryGet(building, Position);
  if (b === undefined || p === undefined) return;
  const anchor = nodeOfPosition(p.x, p.y);
  const cells = buildingFlagBody(ctx.content, b.buildingType);
  const body = new Set<NodeId>(translatedCells(terrain, cells, anchor.hx, anchor.hy));
  if (body.size === 0) return;

  // The common case, no flag on the plot, early-outs before any nearest-field scan.
  const enclosed = [...world.query(DeliveryFlag, Position)].filter((e) =>
    body.has(entityNode(world, terrain, e)),
  );
  if (enclosed.length === 0) return;
  for (const flag of canonicalById(enclosed)) {
    const node = nearestWorkFlagPlacement(world, ctx, terrain, entityNode(world, terrain, flag));
    if (node === null) continue; // no legal field anywhere - the flag stays put
    const c = terrain.coordsOf(node);
    relocateWorkFlag(world, flag, positionOfNode(c.x, c.y));
  }
}

/**
 * Whether `jobType` may harvest `goodType`: the good needs a harvest atomic the trade is granted, and a
 * field-farmed good is never flag-harvested.
 */
export function jobCanHarvestGood(ctx: SystemContext, jobType: number, goodType: number): boolean {
  const index = contentIndex(ctx.content);
  const good = index.goods.get(goodType);
  const harvest = good?.atomics.harvest;
  if (harvest === undefined || good?.farming !== undefined) return false;
  return index.atomicsByJob.get(jobType)?.has(harvest) ?? false;
}

/**
 * Sync a settler's work flag to its new `jobType`: a job that can harvest keeps its live flag or gets a
 * fresh one at its feet, and any other job drops the flag rather than stranding an owner-less one on the
 * map. A settler already bound to a workplace takes no flag, since a bound gatherer harvests its building's
 * stored goods, so a caller that binds employment must bind before calling here.
 */
export function syncWorkFlagToJob(world: World, ctx: SystemContext, e: Entity, jobType: number): void {
  if (jobCanHarvest(ctx, jobType) && !world.has(e, JobAssignment)) {
    const live = liveWorkFlag(world, e);
    if (live !== undefined) {
      // Keep the flag, re-fitting the binding to the new trade.
      world.write(e, WorkFlag, (binding) => {
        binding.radius = workFlagRadiusFor(ctx, jobType);
        if (binding.goodType !== undefined && !jobCanHarvestGood(ctx, jobType, binding.goodType)) {
          delete binding.goodType;
        }
      });
      return;
    }
    plantWorkFlagAtFeet(world, ctx, e);
  } else {
    removeWorkFlag(world, e);
  }
}

/**
 * Plant a fresh work flag on the nearest legal field to the gatherer's current node. A spawn or profession
 * change can happen while the settler stands inside a resource or building body, so auto-placement applies
 * the same free-field rule as the manual command.
 */
function plantWorkFlagAtFeet(world: World, ctx: SystemContext, e: Entity): void {
  const terrain = ctx.terrain;
  if (terrain === undefined || !world.has(e, Position)) return;
  const p = world.get(e, Position);
  const n = nodeOfPosition(p.x, p.y);
  const node = nearestWorkFlagPlacement(world, ctx, terrain, terrain.nodeAtClamped(n.hx, n.hy));
  if (node === null) return;
  const c = terrain.coordsOf(node);
  bindFreshFlag(world, ctx, e, positionOfNode(c.x, c.y));
}

/**
 * The single un-bind point: destroy the flag marker and remove the {@link WorkFlag} binding. Goods already
 * piled on the ground are separate `Stockpile+Position` heaps pinned to their own tiles and stay put.
 */
export function removeWorkFlag(world: World, e: Entity): void {
  const wf = world.tryGet(e, WorkFlag);
  if (wf === undefined) return;
  if (world.isAlive(wf.flag)) world.destroy(wf.flag);
  world.remove(e, WorkFlag);
  world.remove(e, YardDeliveryRoute);
}

/**
 * Whether a job is a flag-gathering trade: only a gatherer carries a work flag. A field-farmed good is
 * excluded from the harvest set, since its harvester is a farmer banking the crop in the farm's own store
 * (`logicstock 4 25 0`) and a flag would hijack every sheaf delivery - the flag rung outranks the store.
 */
export function jobCanHarvest(ctx: SystemContext, jobType: number): boolean {
  return contentIndex(ctx.content).harvestJobs.has(jobType);
}
