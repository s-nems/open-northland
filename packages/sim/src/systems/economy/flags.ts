import {
  Building,
  CurrentAtomic,
  DEFAULT_WORK_FLAG_RADIUS,
  DeliveryFlag,
  Position,
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
import { nearestWorkFlagPlacement } from '../footprint/index.js';
import { canonicalById, clearNavState, entityNode } from '../spatial.js';

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
export function liveWorkFlag(
  world: World,
  e: Entity,
): { flag: Entity; radius: number; goodType?: number } | undefined {
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
  world.remove(e, YardDeliveryRoute);
  const flag = world.create();
  world.add(flag, Position, { x: pos.x, y: pos.y });
  world.add(flag, DeliveryFlag, {});
  const wf = world.tryGet(e, WorkFlag);
  if (wf !== undefined)
    wf.flag = flag; // stale binding — re-point it, keeping the gatherer's radius
  else world.add(e, WorkFlag, { flag, radius: DEFAULT_WORK_FLAG_RADIUS });
}

/**
 * Move an existing flag marker to `pos` and re-plan its gatherer — the one relocate path, shared by the
 * player's `setWorkFlag` (Ctrl+Right-Click) and the placement push-out ({@link evictWorkFlagsFromFootprint}).
 * Only the marker moves: the goods already dropped are separate ground heaps pinned to their own tiles.
 *
 * The gatherer's delivery state caches the OLD position and must go with it — {@link YardDeliveryRoute}'s
 * `goal` is a sticky destination node `planDelivery` reuses verbatim, an in-flight `pileup` into this flag
 * drops the load at the settler's own feet (beside the abandoned marker), and the live nav goal aims at the
 * old yard cell. Dropping all three re-plans the gatherer against the new position on the next tick.
 *
 * `gatherer` is the binding to fix up; omitting it scans for the one {@link WorkFlag} that references `flag`
 * ({@link bindFreshFlag} mints one per gatherer), which the push-out needs since it starts from the marker.
 */
export function relocateWorkFlag(
  world: World,
  flag: Entity,
  pos: { x: Fixed; y: Fixed },
  gatherer?: Entity,
): void {
  const p = world.get(flag, Position);
  p.x = pos.x;
  p.y = pos.y;
  world.touch(flag);
  // Each match mutates only its own state, so the scan's store order is permitted — no chosen-entity pick.
  for (const e of gatherer !== undefined ? [gatherer] : world.query(WorkFlag)) {
    if (world.tryGet(e, WorkFlag)?.flag !== flag) continue;
    const atomic = world.tryGet(e, CurrentAtomic);
    if (atomic?.effect.kind === 'pileup' && atomic.effect.store === flag) world.remove(e, CurrentAtomic);
    world.remove(e, YardDeliveryRoute);
    clearNavState(world, e);
  }
}

/**
 * Push every work flag standing inside `building`'s family body out to the nearest legal field — the flag
 * twin of `evictSettlersFromFootprint`, run when a `placeBuilding` lands on ground a gatherer had already
 * flagged. {@link nearestWorkFlagPlacement}'s blocker set refuses to PLANT a flag on a building's body, so
 * without this the reverse order (flag first, house second) leaves one sealed inside the walls.
 *
 * The body is {@link buildingFlagBody} — the FAMILY body, not the walk-blocked `blocked` set the settler
 * twin uses: flag legality is family-body-wide, covering the growth cells a level-0 house already reserves
 * and (for the one real type whose door sits inside its body, `work_pottery_02`) the doorway the settler
 * twin spares. Evicting exactly that set leaves no flag on ground `canPlaceWorkFlag` now refuses.
 *
 * Only `placeBuilding` needs this, unlike the settler twin's three callers: `familyBody` is family-constant
 * (the extracted union of every tier's `blocked`), so a construction finish and a home tier upgrade enclose
 * no cell that was not already flag-blocked the moment the {@link Building} appeared.
 *
 * Approximated: the original's handling of a house placed over a standing flag is unobserved — push-out is
 * the player-reported behavior (2026-07-17), chosen over refusing the placement so the building rule keeps
 * ignoring markers. Two named divergences from the settler twin: no Owner gate (a walled-in flag is broken
 * whoever owns it), and no signpost-confinement check (the push is involuntary, and `plantWorkFlagAtFeet`
 * skips it too — refusing would leave the flag inside the walls).
 *
 * Determinism: flags relocate in canonical ascending-id order, and each search re-reads the live blocker set
 * — so an earlier evictee's new cell already blocks the next one's pick, with no claimed-set to thread. A
 * flag with no legal field anywhere stays put (the settler twin's boxed-in stance).
 */
export function evictWorkFlagsFromFootprint(world: World, ctx: SystemContext, building: Entity): void {
  const terrain = ctx.terrain;
  if (terrain === undefined) return; // mapless sim: no cells to plant a flag on
  const b = world.tryGet(building, Building);
  const p = world.tryGet(building, Position);
  if (b === undefined || p === undefined) return;
  const anchor = nodeOfPosition(p.x, p.y);
  const cells = buildingFlagBody(ctx.content, b.buildingType);
  const body = new Set<NodeId>(translatedCells(terrain, cells, anchor.hx, anchor.hy));
  if (body.size === 0) return;

  // The common case — no flag on the plot — early-outs before any nearest-field scan below.
  const enclosed = [...world.query(DeliveryFlag, Position)].filter((e) =>
    body.has(entityNode(world, terrain, e)),
  );
  if (enclosed.length === 0) return;
  for (const flag of canonicalById(enclosed)) {
    const node = nearestWorkFlagPlacement(world, ctx, terrain, entityNode(world, terrain, flag));
    if (node === null) continue; // no legal field anywhere — the flag stays
    const c = terrain.coordsOf(node);
    relocateWorkFlag(world, flag, positionOfNode(c.x, c.y));
  }
}

/**
 * Whether `jobType` may harvest `goodType` — the one validity test behind every gatherer resource pick
 * (`setGatherGood`, the spawn-time pick, and the profession-change revalidation below). The good must
 * have a harvest atomic the trade is granted; a field-farmed good (wheat) is never flag-harvested
 * ({@link jobCanHarvest}).
 */
export function jobCanHarvestGood(ctx: SystemContext, jobType: number, goodType: number): boolean {
  const good = contentIndex(ctx.content).goods.get(goodType);
  const harvest = good?.atomics.harvest;
  if (good === undefined || good.farming !== undefined || harvest === undefined) return false;
  return contentIndex(ctx.content).atomicsByJob.get(jobType)?.has(harvest) ?? false;
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
    const live = liveWorkFlag(world, e);
    if (live !== undefined) {
      const selected = live.goodType;
      if (selected !== undefined && !jobCanHarvestGood(ctx, jobType, selected)) {
        delete world.get(e, WorkFlag).goodType;
        world.touch(e);
      }
      return; // already carries a live flag — keep it, with a filter valid for the new trade
    }
    plantWorkFlagAtFeet(world, ctx, e); // becoming a gatherer with no live flag — plant one at its feet
  } else {
    removeWorkFlag(world, e); // leaving the gatherer trade — the flag has no gatherer, so it goes
  }
}

/**
 * Plant a fresh work flag on the nearest legal field to the gatherer's current node. Spawn/profession changes
 * can happen while the settler stands inside a resource or building body, so auto-placement applies the same
 * free-field rule as the manual command. No-op when mapless, positionless, or no legal node exists.
 */
function plantWorkFlagAtFeet(world: World, ctx: SystemContext, e: Entity): void {
  const terrain = ctx.terrain;
  if (terrain === undefined || !world.has(e, Position)) return; // mapless / positionless — no flag
  const p = world.get(e, Position);
  const n = nodeOfPosition(p.x, p.y);
  const node = nearestWorkFlagPlacement(world, ctx, terrain, terrain.nodeAtClamped(n.hx, n.hy));
  if (node === null) return;
  const c = terrain.coordsOf(node);
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
  world.remove(e, YardDeliveryRoute);
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
