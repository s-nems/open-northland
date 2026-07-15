import { DEFAULT_WORK_FLAG_RADIUS, DeliveryFlag, Position, WorkFlag } from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Fixed } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import { nodeOfPosition, positionOfNode } from '../../nav/halfcell.js';
import type { SystemContext } from '../context.js';

/**
 * The gatherer work-flag lifecycle — create / relocate / destroy of a gatherer's drop-off flag, plus the "is
 * this a gatherer trade" gate that governs it. `setWorkFlag` (Ctrl+Right-Click) plants / moves a flag, a
 * profession change ({@link syncWorkFlagToJob}) plants or drops one, and the death reap (`cleanupSystem`) drops
 * a dead gatherer's flag — all through the {@link bindFreshFlag}/{@link removeWorkFlag} pair here, so "a
 * `DeliveryFlag` exists exactly while a live gatherer references it" holds in one place.
 *
 * A flag is a pure `Position + DeliveryFlag` marker (it stores no goods — the harvest piles on the ground
 * around it as separate heaps), referenced by its gatherer's {@link WorkFlag}. The work radius is the named
 * approximation {@link DEFAULT_WORK_FLAG_RADIUS} (the original's collector work-area size is not decoded).
 * Auto-planting a flag the moment a settler becomes a gatherer ({@link plantWorkFlagAtFeet}) is an OpenNorthland
 * UX convention layered on that model (not observed original behavior).
 */

/**
 * The gatherer's live work flag (its {@link WorkFlag} whose flag entity still exists), or undefined — it
 * carries no WorkFlag, or the referenced flag was destroyed (a stale binding). The one liveness test, shared by
 * the relocate branch of `setWorkFlag` and the keep-check of {@link syncWorkFlagToJob}.
 */
export function liveWorkFlag(world: World, e: Entity): { flag: Entity; radius: number } | undefined {
  const wf = world.tryGet(e, WorkFlag);
  return wf !== undefined && world.has(wf.flag, Position) ? wf : undefined;
}

/**
 * Mint a fresh {@link DeliveryFlag} marker at `pos` and bind gatherer `e` to it — the one place a work flag is
 * created, shared by `setWorkFlag` (the player's Ctrl+Right-Click) and the profession-change auto-plant
 * ({@link plantWorkFlagAtFeet}). Re-points a stale {@link WorkFlag} (keeping the gatherer's radius) or adds a
 * new one at the {@link DEFAULT_WORK_FLAG_RADIUS}.
 */
export function bindFreshFlag(world: World, e: Entity, pos: { x: Fixed; y: Fixed }): void {
  const flag = world.create();
  world.add(flag, Position, { x: pos.x, y: pos.y });
  world.add(flag, DeliveryFlag, {});
  const wf = world.tryGet(e, WorkFlag);
  if (wf !== undefined)
    wf.flag = flag; // stale binding — re-point it, keeping the gatherer's radius
  else world.add(e, WorkFlag, { flag, radius: DEFAULT_WORK_FLAG_RADIUS });
}

/**
 * Sync a settler's work flag to its (new) `jobType` — the flag half of a profession change, run inside
 * `reidleAsJob` so every employment order (`setJob`, `assignWorker`) applies it identically. A job that can
 * harvest is a gatherer: it keeps a live flag, or gets a fresh one planted at its feet
 * ({@link plantWorkFlagAtFeet}). A job that cannot (a builder, a soldier, idle) drops the flag
 * ({@link removeWorkFlag}), so a former gatherer never strands an owner-less flag on the map.
 */
export function syncWorkFlagToJob(world: World, ctx: SystemContext, e: Entity, jobType: number): void {
  if (jobCanHarvest(ctx, jobType)) {
    if (liveWorkFlag(world, e) !== undefined) return; // already carries a live flag — keep it
    plantWorkFlagAtFeet(world, ctx, e); // becoming a gatherer with no live flag — plant one at its feet
  } else {
    removeWorkFlag(world, e); // leaving the gatherer trade — the flag has no gatherer, so it goes
  }
}

/**
 * Plant a fresh work flag at the owned gatherer's current tile and bind it — the auto-plant a settler gets the
 * instant its profession becomes a gatherer. The flag snaps to the settler's half-cell node (so it lands on a
 * tile the player can then relocate), exactly as `setWorkFlag` snaps a clicked point. No-op when mapless or the
 * settler carries no Position.
 */
function plantWorkFlagAtFeet(world: World, ctx: SystemContext, e: Entity): void {
  const terrain = ctx.terrain;
  if (terrain === undefined || !world.has(e, Position)) return; // mapless / positionless — no flag
  const p = world.get(e, Position);
  const n = nodeOfPosition(p.x, p.y);
  const c = terrain.coordsOf(terrain.nodeAtClamped(n.hx, n.hy));
  bindFreshFlag(world, e, positionOfNode(c.x, c.y));
}

/**
 * Drop a settler's work flag: destroy the flag marker entity (if still alive) and remove the {@link WorkFlag}
 * binding. The single un-bind point, shared by the profession-change path ({@link syncWorkFlagToJob}) and the
 * death reap (`cleanupSystem`). The goods already piled on the ground are separate `Stockpile+Position` heaps
 * pinned to their own tiles — they stay put. No-op if the settler carries no WorkFlag.
 */
export function removeWorkFlag(world: World, e: Entity): void {
  const wf = world.tryGet(e, WorkFlag);
  if (wf === undefined) return;
  if (world.isAlive(wf.flag)) world.destroy(wf.flag); // reap the marker; a dead id is already gone
  world.remove(e, WorkFlag);
}

/**
 * Whether a job is a flag-gathering trade — its grants (`allowedAtomics`) include some good's harvest
 * atomic ({@link ContentIndex.harvestJobs}). The gate for `setWorkFlag` and {@link syncWorkFlagToJob}:
 * only a gatherer carries a work flag. Trade grants only, NOT the `jobAtomics` permission union the
 * planner runs on: a tribe-wide `baseAtomics` entry that coincides with a good's harvest atomic (real
 * soldier `baseAtomics=[31]` == herb's harvest 31) must not flag every soldier as a gatherer.
 * A field-farmed good (a `farming` block — wheat) is excluded from the harvest set: its harvester is a
 * farmer bound to its farm, banking the crop in the farm's own store (`logicstock 4 25 0`), never a flag
 * gatherer — a flag would hijack every sheaf delivery (`deliveryTargetFor`'s flag rung outranks the store).
 */
export function jobCanHarvest(ctx: SystemContext, jobType: number): boolean {
  return contentIndex(ctx.content).harvestJobs.has(jobType);
}
