import {
  CurrentAtomic,
  Marriage,
  Position,
  Residence,
  Settler,
  Sheltering,
  Wedding,
} from '../../components/index.js';
import { eventAt } from '../../core/events.js';
import type { Entity, World } from '../../ecs/world.js';
import { nodeOfPosition, nodesAdjacent } from '../../nav/halfcell.js';
import type { TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { atomicDuration } from '../readviews/animations.js';
import { approachPartner, driveMirroredPairs, startPairedAtomics } from '../rendezvous.js';

/** The paired kiss atomic ids - `logicdefines.inc` `KISS = 20` / `KISSED = 21`, bound per tribe in
 *  `tribetypes.ini` (`setatomic 5 20 "..._woman_kiss"` / `setatomic 6 21 "..._civilist_kissed"`). */
export const KISS_ATOMIC_ID = 20;
export const KISSED_ATOMIC_ID = 21;

/** Stamp a {@link Wedding} on both halves of a freshly-matched pair. */
export function startWedding(world: World, seeker: Entity, partner: Entity): void {
  world.add(seeker, Wedding, { partner, kissing: false });
  world.add(partner, Wedding, { partner: seeker, kissing: false });
}

/**
 * Move a freshly-wed pair into one home: a married couple is a single household, one `homeSize` family
 * slot, so two separately-housed singles consolidate into the pair's lower id's home. Without it a
 * settler married after being assigned a house stays a one-person household and `makeChild` never finds
 * the couple together (observed original behaviour: a married couple cohabits).
 */
function coHouseNewlyweds(world: World, a: Entity, b: Entity): void {
  const homeA = world.tryGet(a, Residence)?.home;
  const homeB = world.tryGet(b, Residence)?.home;
  if (homeA !== undefined && homeB === undefined) world.add(b, Residence, { home: homeA });
  else if (homeB !== undefined && homeA === undefined) world.add(a, Residence, { home: homeB });
  else if (homeA !== undefined && homeB !== undefined && homeA !== homeB)
    world.add(b, Residence, { home: homeA });
}

/** Cancel `e`'s wedding on both sides (partner death, unreachable partner). No marriage results. */
function cancelWedding(world: World, e: Entity): void {
  const w = world.tryGet(e, Wedding);
  if (w !== undefined && world.isAlive(w.partner)) world.remove(w.partner, Wedding);
  world.remove(e, Wedding);
}

/** Drive every wedding one tick. Pairs are processed once, from the lower entity id (canonical). */
export function driveWeddings(world: World, ctx: SystemContext, terrain: TerrainGraph | undefined): void {
  driveMirroredPairs(
    world,
    Wedding,
    (e, partner) => e < partner,
    (e) => cancelWedding(world, e),
    (a, b) => drivePair(world, ctx, terrain, a, b),
  );
}

function drivePair(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph | undefined,
  a: Entity,
  b: Entity,
): void {
  // A partner claimed by a shelter must not be walked back out to a wedding spot, and the ceremony is a
  // one-shot pairing, not a standing order to resume later.
  if (world.has(a, Sheltering) || world.has(b, Sheltering)) {
    cancelWedding(world, a);
    return;
  }
  const wa = world.mut(a, Wedding);
  const wb = world.mut(b, Wedding);
  const busyA = world.has(a, CurrentAtomic);
  const busyB = world.has(b, CurrentAtomic);
  if (wa.kissing) {
    // The planner leaves a Wedding settler alone, so the kiss atomics run to completion.
    if (busyA || busyB) return;
    world.remove(a, Wedding);
    world.remove(b, Wedding);
    world.add(a, Marriage, { spouse: b, child: null });
    world.add(b, Marriage, { spouse: a, child: null });
    coHouseNewlyweds(world, a, b);
    const p = world.get(a, Position);
    ctx.events.emit({ kind: 'settlersMarried', a, b, at: eventAt(p.x, p.y) });
    return;
  }
  if (busyA || busyB) return; // let a running action finish first
  const pa = world.tryGet(a, Position);
  const pb = world.tryGet(b, Position);
  if (pa === undefined || pb === undefined) {
    cancelWedding(world, a);
    return;
  }
  const na = nodeOfPosition(pa.x, pa.y);
  const nb = nodeOfPosition(pb.x, pb.y);
  if (nodesAdjacent(na, nb)) {
    // Both play the paired kiss on one clock: the longer of the two bound clips.
    const duration = Math.max(
      atomicDuration(ctx.content, world.get(a, Settler), KISS_ATOMIC_ID),
      atomicDuration(ctx.content, world.get(b, Settler), KISSED_ATOMIC_ID),
    );
    startPairedAtomics(world, a, KISS_ATOMIC_ID, b, KISSED_ATOMIC_ID, duration);
    wa.kissing = true;
    wb.kissing = true;
    return;
  }
  // Apart: the lower id walks and the higher waits, whoever issued `marry` (canonical).
  approachPartner(world, terrain, a, b, nb, () => cancelWedding(world, a));
}
