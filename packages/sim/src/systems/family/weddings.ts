import {
  CurrentAtomic,
  Marriage,
  MoveGoal,
  PathRequest,
  Position,
  Settler,
  Wedding,
} from '../../components/index.js';
import { eventAt } from '../../core/events.js';
import type { Entity, World } from '../../ecs/world.js';
import { nodeOfPosition } from '../../nav/halfcell.js';
import type { TerrainGraph } from '../../nav/terrain/index.js';
import { startAtomic } from '../agents/actions.js';
import type { SystemContext } from '../context.js';
import { atomicDuration } from '../readviews/animations.js';
import { canonicalById, clearNavState, isTravelling } from '../spatial.js';

/**
 * The wedding half of the FamilySystem: drive each {@link Wedding} pair — the seeker walks to its
 * standing partner, both kiss (the paired atomics below), and on the kiss's completion both become
 * spouses ({@link Marriage}) for life; a `settlersMarried` event announces it (the original's marriage
 * jingle moment, `DM_MUSIC_TYPE_JINGLE_MARRIAGE`). A wedding whose partner died or whose walk failed is
 * cancelled on both sides.
 */

/** The paired kiss atomic ids — `logicdefines.inc` `KISS = 20` / `KISSED = 21`, bound per tribe in
 *  `tribetypes.ini` (`setatomic 5 20 "..._woman_kiss"` / `setatomic 6 21 "..._civilist_kissed"`). */
export const KISS_ATOMIC_ID = 20;
export const KISSED_ATOMIC_ID = 21;

/** How close (half-cell Manhattan nodes) the pair must stand to kiss — one tile apart, the "two settlers
 *  stand facing each other" beat (observed original behavior; the exact engine range is not readable). */
const KISS_RANGE_NODES = 2;

/** Stamp a {@link Wedding} on both halves of a freshly-matched pair (the `marry` command's accept path). */
export function startWedding(world: World, seeker: Entity, partner: Entity): void {
  world.add(seeker, Wedding, { partner, kissing: false });
  world.add(partner, Wedding, { partner: seeker, kissing: false });
}

/** Cancel `e`'s wedding on both sides (partner death, unreachable partner). No marriage results. */
function cancelWedding(world: World, e: Entity): void {
  const w = world.tryGet(e, Wedding);
  if (w !== undefined && world.isAlive(w.partner)) world.remove(w.partner, Wedding);
  world.remove(e, Wedding);
}

/** Drive every wedding one tick. Pairs are processed once, from the lower entity id (canonical). */
export function driveWeddings(world: World, ctx: SystemContext, terrain: TerrainGraph | undefined): void {
  for (const e of canonicalById(world.query(Wedding))) {
    const w = world.tryGet(e, Wedding);
    if (w === undefined) continue; // cancelled earlier this pass from the partner's side
    const mirrored = world.isAlive(w.partner) ? world.tryGet(w.partner, Wedding) : undefined;
    if (mirrored === undefined || mirrored.partner !== e) {
      cancelWedding(world, e);
      continue;
    }
    if (e > w.partner) continue; // the pair is driven once, from its lower id
    drivePair(world, ctx, terrain, e, w.partner);
  }
}

function drivePair(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph | undefined,
  a: Entity,
  b: Entity,
): void {
  const wa = world.get(a, Wedding);
  const wb = world.get(b, Wedding);
  const busyA = world.has(a, CurrentAtomic);
  const busyB = world.has(b, CurrentAtomic);
  if (wa.kissing) {
    // The kiss atomics run to completion (the planner leaves a Wedding settler alone); when both are
    // done the pair is married.
    if (busyA || busyB) return;
    world.remove(a, Wedding);
    world.remove(b, Wedding);
    world.add(a, Marriage, { spouse: b, child: null });
    world.add(b, Marriage, { spouse: a, child: null });
    const p = world.get(a, Position);
    ctx.events.emit({ kind: 'settlersMarried', a, b, at: eventAt(p.x, p.y) });
    return;
  }
  if (busyA || busyB) return; // let a running action (a meal, a swing in flight) finish first
  const pa = world.tryGet(a, Position);
  const pb = world.tryGet(b, Position);
  if (pa === undefined || pb === undefined) {
    cancelWedding(world, a);
    return;
  }
  const na = nodeOfPosition(pa.x, pa.y);
  const nb = nodeOfPosition(pb.x, pb.y);
  if (Math.abs(na.hx - nb.hx) + Math.abs(na.hy - nb.hy) <= KISS_RANGE_NODES) {
    // Standing together: both play the paired kiss (one clock — the longer of the two bound clips — so
    // they finish together; an unbound job falls back to the short default, the woman's binding carries
    // the real 50-tick length).
    clearNavState(world, a);
    clearNavState(world, b);
    const duration = Math.max(
      atomicDuration(ctx.content, world.get(a, Settler), KISS_ATOMIC_ID),
      atomicDuration(ctx.content, world.get(b, Settler), KISSED_ATOMIC_ID),
    );
    startAtomic(world, a, KISS_ATOMIC_ID, { kind: 'idle' }, duration, b);
    startAtomic(world, b, KISSED_ATOMIC_ID, { kind: 'idle' }, duration, a);
    wa.kissing = true;
    wb.kissing = true;
    return;
  }
  // Apart: the lower id (`a`) always does the walking — regardless of who issued `marry` — and the
  // higher id stands and waits (a canonical, symmetric convention: one walker, one waiter). A failed
  // route means the partner is unreachable — cancel.
  if (world.tryGet(a, PathRequest)?.failed === true || world.tryGet(b, PathRequest)?.failed === true) {
    clearNavState(world, a);
    clearNavState(world, b);
    cancelWedding(world, a);
    return;
  }
  if (terrain === undefined) return; // mapless fixture: no walking — the pair kisses only if adjacent
  if (isTravelling(world, b)) clearNavState(world, b); // the awaited half halts and waits
  if (!isTravelling(world, a)) {
    world.add(a, MoveGoal, { cell: terrain.nodeAtClamped(nb.hx, nb.hy) });
  }
}
