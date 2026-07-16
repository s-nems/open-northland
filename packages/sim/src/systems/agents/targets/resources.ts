import { HarvestedBy, Position, Resource, Stockpile } from '../../../components/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import type { SpatialGate } from '../../node-metric.js';
import { settlerMeetsNeed } from '../../progression/index.js';
import { resourceHarvestAtomics, resourcesNearNode } from '../../resource-index.js';
import { manhattan } from '../../spatial.js';
import { lowestStockedGood } from '../../stores/index.js';
import { nearestByCell } from './cell-index.js';
import { interactionCell, jobAtomics } from './workplaces.js';

/**
 * The nearest harvestable {@link Resource} the given settler is allowed to harvest, by fixed-point Manhattan
 * distance from `here`, with ascending-cell-id as the deterministic tie-break. A resource is eligible only if
 * it has units remaining, is reachable (same static component as the settler — see the `componentOf` gate
 * below), and its harvest passes both data-driven gates:
 *
 *  - the job's `allowedAtomics` permits the resource good's harvest atomic (a woodcutter harvests trees, not
 *    ore — {@link jobAtomics});
 *  - the settler's accrued XP clears the harvested good's `needforgood` thresholds for its tribe
 *    ({@link settlerMeetsNeed}) — the who-may-do-it progression gate, the per-settler sibling of the
 *    production-side `jobEnablesGood` gate. A settler trains a good's track by harvesting it
 *    (`grantWorkExperience`), so a low-XP settler is held out of goods whose threshold it hasn't reached; an
 *    unthresholded good (no `needforgood`) is harvestable by any settler.
 *
 * Returns the winning resource with its interaction `cell` and `dist` (from the flag when bound, else from
 * the settler), or null if none qualifies. Scanned in canonical entity-id order so the result never depends
 * on store insertion history.
 *
 * `opts.area` bounds the scan to a gatherer's flag work-area ({@link WorkFlag}): only nodes whose work cell is
 * within `radius` (integer node-distance) of `center` qualify, and the winner is the one nearest the flag (so
 * a bound gatherer works outward from its flag, not wherever it stands). Omitted — the default for an unbound
 * roaming collector — measures from `here` with no radius. With `area` set, `candidates` is superseded by the
 * resource region index (`resourcesNearNode` — a provable superset of the in-radius nodes); pass the full
 * canonical resource list, never a pre-filtered one, or the two paths disagree on the winner.
 * `opts.goodFilter` restricts eligible goods to the given set (a building-employed gatherer foraging only
 * what its workplace stores); omitted = every good the job may harvest.
 *
 * Known limitation (like the bridge case): the reachability gate below reads static components only. A
 * same-component node whose anchor and every work cell are enclosed by dynamic resource footprints (a sealed
 * pocket deep in a dense forest) can still win the pick and then fail its path. Route-level dynamic
 * reachability is a follow-up (`docs/tickets/sim/dynamic-route-reachability.md`).
 */
export function nearestHarvestableFor(
  candidates: readonly Entity[],
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  here: NodeId,
  settler: { jobType: number; tribe: number; experience: ReadonlyMap<number, number> },
  opts: {
    readonly area?: { center: NodeId; radius: number; goodType?: number };
    readonly goodFilter?: ReadonlySet<number>;
    /** The settler's signpost confinement ({@link SpatialGate}): membership rejects out-of-area work
     *  cells, and its bounds let a roaming scan read only the resources near the allowed box instead of
     *  the full canonical list — every gate-passing work cell provably lies inside the box (+ work-offset
     *  slack), so the winner is identical to the full scan. */
    readonly gate?: SpatialGate;
  } = {},
): { entity: Entity; cell: NodeId; dist: number } | null {
  const { area, goodFilter, gate } = opts;
  const allowed = jobAtomics(ctx, settler.jobType);
  // Dormancy gate: if the job's allowed atomics intersect no harvest atomic present on any standing resource,
  // every candidate fails the `allowed.has` check below — the whole scan is provably null. Skip it in
  // O(distinct present atomics ≈ goods) instead of walking the entire resource list per such settler per tick
  // (with thousands of map-spawned nodes that per-settler full scan is the dominant sim cost). This covers
  // every non-harvest trade that still carries atomics (an idle builder with only the build atomic). The probe
  // set is derived from the actual resources (the region index), so a fixture node carrying an out-of-content
  // atomic still gates exactly.
  const present = resourceHarvestAtomics(world);
  let anyHarvestable = false;
  for (const atomic of present) {
    if (allowed.has(atomic)) {
      anyHarvestable = true;
      break;
    }
  }
  if (!anyHarvestable) return null;
  // Rank + range from the flag when bound; from the settler when roaming (the unbound default is identical
  // to the prior nearest-to-`here` scan — same origin, no radius filter).
  const origin = area?.center ?? here;
  const radius = area?.radius ?? Number.POSITIVE_INFINITY;
  // A radius-bounded (flag) scan reads only the resources whose anchor lies within the radius box — widened
  // by the content's max work-cell offset, so every node whose work cell could pass the radius test below is
  // provably included (`resourcesNearNode`). Same filter/rank loop over an ascending-id superset ⇒ the
  // identical winner as the full scan, at O(nearby) instead of O(all resources) per gatherer per tick (a
  // decoded map holds ~17k standing nodes). A roaming (unbound) scan keeps the full canonical list.
  let scanned = candidates;
  if (area !== undefined) {
    scanned = resourcesNearNode(
      world,
      terrain.coordsOf(origin).x,
      terrain.coordsOf(origin).y,
      area.radius + contentIndex(ctx.content).maxResourceWorkOffset,
    );
  } else if (gate !== undefined) {
    // A confined roaming scan: the region box centred on the allowed area covers every anchor whose work
    // cell (≤ maxResourceWorkOffset off the anchor) could pass the gate — the same provable-superset
    // argument as the flag path, so the filter/rank loop below picks the identical winner at O(nearby).
    // Guarded: when the allowed box spans most of the map (a map-wide signpost network), the region query
    // would collect nearly every resource AND re-sort it per gatherer per tick — the pre-sorted canonical
    // list is then the cheaper identical superset, so keep it.
    const b = gate.bounds;
    const boxW = Math.min(b.maxX, terrain.width - 1) - Math.max(b.minX, 0) + 1;
    const boxH = Math.min(b.maxY, terrain.height - 1) - Math.max(b.minY, 0) + 1;
    if (boxW * boxH * 2 < terrain.width * terrain.height) {
      const cx = Math.floor((b.minX + b.maxX) / 2);
      const cy = Math.floor((b.minY + b.maxY) / 2);
      const half = Math.max(cx - b.minX, b.maxX - cx, cy - b.minY, b.maxY - cy);
      scanned = resourcesNearNode(world, cx, cy, half + contentIndex(ctx.content).maxResourceWorkOffset);
    }
  }
  // Ranked from `origin` (the flag when bound, the settler when roaming); the interaction cell still resolves
  // from `here`, the settler's actual route start. Same filter/rank the shared loop applies to every scan.
  const best = nearestByCell(terrain, scanned, origin, (e) => {
    const res = world.tryGet(e, Resource);
    if (res === undefined || res.remaining <= 0) return null;
    if (area?.goodType !== undefined && res.goodType !== area.goodType) return null;
    if (goodFilter !== undefined && !goodFilter.has(res.goodType)) return null; // not a good the caller forages for
    if (!world.has(e, Position)) return null;
    if (!allowed.has(res.harvestAtomic)) return null; // data-driven gate: job must permit this atomic
    // XP gate: this settler must have cleared the harvested good's `needforgood` thresholds.
    if (!settlerMeetsNeed(ctx, settler.tribe, 'good', res.goodType, settler.experience)) return null;
    const cell = interactionCell(world, ctx, terrain, e, here); // work cell the settler walks to (from here)
    // Reachability gate: a resource walled off from the settler by static terrain — the far bank of a river
    // with no land crossing — sits in a different connected component, so `findPath` would reject the route
    // (nav/pathfinding.ts answers "no route" from the same `componentOf` verdict). Without this the
    // nearest-by-Manhattan pick can latch onto such a tree and the flag-bound gatherer stalls forever trying
    // to path to it, never falling through to a reachable tree slightly farther. `componentOf` is an O(1)
    // array read (a build-time flood-fill). Measured from `here`, the settler's actual route start (bridges
    // are not yet walkable, so the two banks are genuinely separate components — a named limitation).
    if (terrain.componentOf(here) !== terrain.componentOf(cell)) return null;
    if (manhattan(terrain, origin, cell) > radius) return null; // outside the flag's work radius — leave it be
    if (gate !== undefined && !gate.allowsNode(cell)) return null; // outside the settler's signpost area
    return cell;
  });
  return best === null ? null : { entity: best.entity, cell: best.cell, dist: best.distance };
}

/**
 * The nearest collectable ground drop a felling collector should carry off — a bare {@link GroundDrop} trunk
 * pile (a felled tree's dropped wood) whose good this settler's job may harvest — with its Manhattan distance,
 * or null if none is in reach. Scoped two ways so it stays the collector's own-trade loop, not a general
 * porter drive: (1) to `GroundDrop` piles only (a felled trunk / dropped good), never a designated delivery
 * flag or a boat hull — both equally-bare `Stockpile`s; (2) to a good the settler harvests, via the same
 * {@link jobAtomics} gate {@link nearestHarvestableFor} uses (a woodcutter collects wood, not stone).
 *
 * Nearest by Manhattan + ascending-cell-id (canonical scan); the pile's good is its lowest-id stocked good
 * ({@link stockpileEntries}, never raw Map order). The planner weighs the returned `dist` against
 * {@link nearestHarvestableFor}'s node so, standing on its fresh trunk (distance 0), the collector picks the
 * wood up before wandering to the next tree — the original's fell-then-carry cadence. Unlike harvesting,
 * collecting an already-dropped good applies no `needforgood` XP gate (carrying a trunk is hauling, not
 * harvesting).
 */
export function nearestCollectablePileFor(
  candidates: readonly Entity[],
  harvestAtomicByGood: ReadonlyMap<number, number>,
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  here: NodeId,
  jobType: number,
  goodFilter?: ReadonlySet<number>,
  gate?: SpatialGate,
): { pile: Entity; goodType: number; dist: number } | null {
  const allowed = jobAtomics(ctx, jobType);
  // `candidates` is the GroundDrop candidate list, so every entry already has GroundDrop+Stockpile+Position
  // (built by collectTargets) — no per-pile marker re-check, and the scan is O(drops), ~0 when none exist.
  const best = nearestByCell(terrain, candidates, here, (e) => {
    const good = lowestStockedGood(world.get(e, Stockpile));
    if (good === null) return null; // an emptied drop (about to be reaped) — nothing to collect
    if (goodFilter !== undefined && !goodFilter.has(good)) return null; // not a good the caller forages for
    const harvestAtomic = harvestAtomicByGood.get(good);
    if (harvestAtomic === undefined || !allowed.has(harvestAtomic)) return null; // not this job's trade
    const cell = interactionCell(world, ctx, terrain, e, here);
    return gate === undefined || gate.allowsNode(cell) ? cell : null; // signpost confinement
  });
  if (best === null) return null;
  const good = lowestStockedGood(world.get(best.entity, Stockpile)); // the winner's good (accept required one)
  return good === null ? null : { pile: best.entity, goodType: good, dist: best.distance };
}

/**
 * The nearest ground drop this gatherer harvested into being — a {@link GroundDrop} whose {@link HarvestedBy}
 * owner is `owner` — with its Manhattan distance from `here`, or null if it holds none. The flag-bound
 * gatherer's collect drive: it reclaims the trunk/ore it felled or mined and delivers it to its flag, and —
 * unlike {@link nearestCollectablePileFor}'s trade-wide scan — it ignores every pile it did not make (another
 * gatherer's trunk, a player-dropped heap), the "carry only what you dug" rule. Nearest by Manhattan +
 * ascending-cell-id (canonical scan); the pile's good is its lowest-id stocked good. A fully-collected drop
 * empties and is reaped, so it drops out of the scan naturally.
 */
export function nearestOwnDropFor(
  candidates: readonly Entity[],
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  here: NodeId,
  owner: Entity,
  gate?: SpatialGate,
): { pile: Entity; goodType: number; dist: number } | null {
  const best = nearestByCell(terrain, candidates, here, (e) => {
    const mark = world.tryGet(e, HarvestedBy);
    if (mark === undefined || mark.by !== owner) return null; // not this gatherer's own drop — leave it be
    if (lowestStockedGood(world.get(e, Stockpile)) === null) return null; // emptied (about to be reaped)
    const cell = interactionCell(world, ctx, terrain, e, here);
    return gate === undefined || gate.allowsNode(cell) ? cell : null; // signpost confinement
  });
  if (best === null) return null;
  const good = lowestStockedGood(world.get(best.entity, Stockpile)); // the winner's good (accept required one)
  return good === null ? null : { pile: best.entity, goodType: good, dist: best.distance };
}
