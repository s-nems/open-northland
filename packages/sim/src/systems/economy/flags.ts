import { DEFAULT_WORK_FLAG_RADIUS, DeliveryFlag, Position, WorkFlag } from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Fixed } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import { nodeOfPosition, positionOfNode } from '../../nav/halfcell.js';
import type { SystemContext } from '../context.js';

/**
 * The **gatherer work-flag lifecycle** — the create / relocate / destroy of a gatherer's drop-off flag,
 * plus the "is this a gatherer trade" gate that governs it. Split out of the player-command handlers
 * (`orders/work.ts`, which owns `setWorkFlag`/`setJob`) so the flag ENTITY lifecycle has a
 * feature home the non-command callers can reach without importing the player-orders module: `setWorkFlag`
 * (the Ctrl+Right-Click command) plants / moves a flag, a profession change ({@link syncWorkFlagToJob},
 * run inside `reidleAsJob`) plants or drops one, and the death reap (`cleanupSystem`) drops a dead
 * gatherer's flag — all through the SAME {@link bindFreshFlag}/{@link removeWorkFlag} pair here, so "a
 * `DeliveryFlag` exists exactly while a live gatherer references it" holds in one place.
 *
 * A flag is a pure `Position + DeliveryFlag` MARKER (it stores no goods — the harvest piles on the ground
 * around it as separate heaps), referenced by its gatherer's {@link WorkFlag}. The work radius is the
 * named approximation {@link DEFAULT_WORK_FLAG_RADIUS} (the original's collector work-area size is not
 * decoded). Auto-planting a flag the moment a settler becomes a gatherer ({@link plantWorkFlagAtFeet}) is
 * a Vinland UX convention layered on that approximated flag model — not observed original behavior — so a
 * profession change hands the gatherer a movable flag at its feet instead of leaving it flagless.
 */

/**
 * The gatherer's LIVE work flag (its {@link WorkFlag} whose flag entity still exists), or undefined — it
 * carries no WorkFlag, or the referenced flag was destroyed (a stale binding). The ONE liveness test,
 * shared by the relocate branch of `setWorkFlag` and the keep-check of {@link syncWorkFlagToJob}, so the
 * definition of "has a live flag" lives in a single place.
 */
export function liveWorkFlag(world: World, e: Entity): { flag: Entity; radius: number } | undefined {
  const wf = world.tryGet(e, WorkFlag);
  return wf !== undefined && world.has(wf.flag, Position) ? wf : undefined;
}

/**
 * Mint a fresh {@link DeliveryFlag} marker at `pos` and bind gatherer `e` to it — the ONE place a work
 * flag is created, shared by `setWorkFlag` (the player planting it with Ctrl+Right-Click) and the
 * profession-change auto-plant ({@link plantWorkFlagAtFeet}). The flag is a pure `Position + DeliveryFlag`
 * marker (it stores NO goods — the harvest piles on the ground around it). Re-points a stale
 * {@link WorkFlag} (keeping the gatherer's radius) or adds a new one at the {@link DEFAULT_WORK_FLAG_RADIUS}.
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
 * `reidleAsJob` so every employment order (`setJob`, `assignWorker`) applies it identically. A job that
 * CAN harvest is a gatherer: it keeps a live flag, or gets a fresh one planted at its feet
 * ({@link plantWorkFlagAtFeet}) — so switching a settler INTO a gatherer trade immediately gives it a
 * movable drop-off flag, the profession-change twin of the player's first Ctrl+Right-Click (a Vinland UX
 * convention, not decoded original behavior). A job that CANNOT harvest (a builder, a soldier, idle) DROPS
 * the flag ({@link removeWorkFlag}): the marker is destroyed and the {@link WorkFlag} removed, so a former
 * gatherer never strands an owner-less flag on the map.
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
 * Plant a fresh work flag at the OWNED gatherer's CURRENT tile and bind it — the auto-plant a settler gets
 * the instant its profession becomes a gatherer. The flag snaps to the settler's half-cell node (so it
 * lands on a tile the player can then relocate with Ctrl+Right-Click), exactly as `setWorkFlag` snaps a
 * clicked point. No-op when mapless (no cells to plant on) or the settler carries no Position.
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
 * Drop a settler's work flag: destroy the flag marker entity (if still alive) and remove the
 * {@link WorkFlag} binding. The single un-bind point, shared by the profession-change path (a settler
 * leaving the gatherer trade — {@link syncWorkFlagToJob}) and the death reap (`cleanupSystem`), so the
 * "a flag exists only for a live gatherer" invariant holds through both. The goods already piled on the
 * ground are SEPARATE `Stockpile+Position` heaps pinned to their own tiles — they stay put. No-op if the
 * settler carries no WorkFlag.
 */
export function removeWorkFlag(world: World, e: Entity): void {
  const wf = world.tryGet(e, WorkFlag);
  if (wf === undefined) return;
  if (world.isAlive(wf.flag)) world.destroy(wf.flag); // reap the marker; a dead id is already gone
  world.remove(e, WorkFlag);
}

/**
 * Whether a job may harvest any FLAG-GATHERED good — i.e. its allowed atomics include some good's
 * harvest atomic. The gate for `setWorkFlag` and {@link syncWorkFlagToJob}: only a gatherer carries a
 * work flag. Mirrors the harvest-atomic knowledge the AI target scan uses (`atomicsByJob` ∩ the goods'
 * harvest atomics), read once per command (rare path). A FIELD-FARMED good (a `farming` block — wheat)
 * is deliberately excluded: its harvester is a FARMER, bound to its farm and banking the crop in the
 * farm's own store (`logicstock 4 25 0`; `agents/farming`), never a flag gatherer — a flag would
 * hijack every sheaf delivery to the flag (`deliveryTargetFor`'s flag rung outranks the bound store).
 */
export function jobCanHarvest(ctx: SystemContext, jobType: number): boolean {
  const allowed = contentIndex(ctx.content).atomicsByJob.get(jobType);
  if (allowed === undefined) return false;
  for (const g of ctx.content.goods) {
    if (g.farming !== undefined) continue; // field-farmed — farm-bound, not flag-gathered
    if (g.atomics.harvest !== undefined && allowed.has(g.atomics.harvest)) return true;
  }
  return false;
}
