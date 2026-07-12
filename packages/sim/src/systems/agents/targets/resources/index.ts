import { HarvestedBy, Position, Resource, Stockpile } from '../../../../components/index.js';
import { contentIndex } from '../../../../core/content-index.js';
import type { Entity, World } from '../../../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../../../nav/terrain.js';
import type { SystemContext } from '../../../context.js';
import { settlerMeetsNeed } from '../../../progression.js';
import { resourceHarvestAtomics, resourcesNearNode } from '../../../resource-index.js';
import { manhattan } from '../../../spatial.js';
import { lowestStockedGood } from '../../../stores.js';
import { closer } from '../nearest.js';
import { interactionCell, jobAtomics } from '../workplaces.js';

/**
 * The nearest harvestable {@link Resource} the given settler is allowed to harvest, by fixed-point
 * Manhattan distance from `here`, with ascending-cell-id as the deterministic tie-break. A resource
 * is eligible only if it has units remaining, is REACHABLE (same static component as the settler —
 * see the `componentOf` gate below), AND its harvest passes **both** data-driven gates:
 *
 *  - the job's `allowedAtomics` permits the resource good's harvest atomic (a woodcutter harvests
 *    trees, not ore — {@link jobAtomics});
 *  - the settler's accrued XP clears the harvested good's `needforgood` thresholds for its tribe
 *    ({@link settlerMeetsNeed}) — the *who-may-do-it* progression gate, the per-settler sibling of the
 *    production-side tribe-presence `jobEnablesGood` gate. A settler trains a good's track by
 *    harvesting it (`grantWorkExperience`), so a low-XP settler is held out of the goods whose
 *    threshold it hasn't yet reached; an unthresholded good (no `needforgood`) is harvestable by any
 *    settler, so this gate is inert where no requirement exists.
 *
 * Returns the resource entity, or null if none qualifies. Scanned in canonical entity-id order so the
 * result never depends on store insertion history. Determinism: both gates are pure reads over content
 * + the settler's components (no RNG/wall-clock).
 *
 * `area` bounds the scan to a **gatherer's flag work-area** ({@link WorkFlag}): only nodes whose work cell
 * is within `radius` (integer node-distance) of `center` qualify, and the winner is the one NEAREST THE
 * FLAG (so a bound gatherer works outward from its flag, not wherever it happens to stand). Omitted — the
 * default for an unbound roaming collector — measures from `here` with no radius, the prior behaviour
 * byte-for-byte (so the golden slice is untouched). **With `area` set, `candidates` is superseded** by
 * the resource region index (`resourcesNearNode` — a provable superset of the in-radius nodes); pass the
 * full canonical resource list, never a pre-filtered one, or the two paths disagree on the winner.
 *
 * Known limitation (like the bridge case): the reachability gate below reads STATIC components only. A
 * same-component node whose anchor and every work cell are enclosed by DYNAMIC resource footprints (a
 * sealed pocket deep in a dense forest) can still win the pick and then fail its path. Route-level
 * dynamic reachability is a separate follow-up (`docs/tickets/sim/dynamic-route-reachability.md`).
 */
export function nearestHarvestableFor(
  candidates: readonly Entity[],
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  here: NodeId,
  settler: { jobType: number; tribe: number; experience: ReadonlyMap<number, number> },
  area?: { center: NodeId; radius: number },
): Entity | null {
  const allowed = jobAtomics(ctx, settler.jobType);
  // Dormancy gate: if the job's allowed atomics intersect NO harvest atomic present on any standing
  // resource, every candidate fails the `allowed.has` check below — the whole scan is provably null.
  // Skip it in O(distinct present atomics ≈ goods) instead of walking the entire resource list per such
  // settler per tick (with thousands of map-spawned nodes that per-settler full scan is the dominant sim
  // cost). This covers not just atomic-less jobs but every NON-HARVEST trade that still carries atomics —
  // an idle builder (build atomic only) used to fall through planBuilder into this scan every tick. The
  // probe set is derived from the ACTUAL resources (the region index), so a fixture node carrying an
  // out-of-content atomic still gates exactly. Same result — a non-harvester still gets null — so the
  // golden slice is byte-identical; only the wasted iteration is elided.
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
  // A radius-bounded (flag) scan reads only the resources whose ANCHOR lies within the radius box —
  // widened by the content's max work-cell offset, so every node whose WORK cell could pass the radius
  // test below is provably included (`resourcesNearNode`). Same filter/rank loop over an ascending-id
  // superset ⇒ the identical winner as the full scan, at O(nearby) instead of O(all resources) per
  // gatherer per tick (a decoded map holds ~17k standing nodes). A roaming (unbound) scan keeps the
  // full canonical list — the golden path, byte-for-byte.
  const scanned =
    area !== undefined
      ? resourcesNearNode(
          world,
          terrain.coordsOf(origin).x,
          terrain.coordsOf(origin).y,
          area.radius + contentIndex(ctx.content).maxResourceWorkOffset,
        )
      : candidates;
  let best: Entity | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  let bestCell = Number.POSITIVE_INFINITY;
  for (const e of scanned) {
    const res = world.tryGet(e, Resource);
    if (res === undefined || res.remaining <= 0) continue;
    if (!world.has(e, Position)) continue;
    if (!allowed.has(res.harvestAtomic)) continue; // data-driven gate: job must permit this atomic
    // XP gate: this settler must have cleared the harvested good's `needforgood` thresholds.
    if (!settlerMeetsNeed(ctx, settler.tribe, 'good', res.goodType, settler.experience)) continue;
    const cell = interactionCell(world, ctx, terrain, e, here); // work cell the settler walks to (from here)
    // Reachability gate: a resource walled off from the settler by static terrain — the far bank of a
    // river with no land crossing — sits in a DIFFERENT connected component, so `findPath` would reject
    // the route outright (nav/pathfinding.ts answers "no route" from the SAME `componentOf` verdict).
    // Without this, the nearest-by-Manhattan pick can latch onto such a tree and the flag-bound gatherer
    // stalls forever trying to path to it ("stoi bezczynnie obok flagi"), never falling through to a
    // reachable tree slightly farther. `componentOf` is an O(1) array read (a build-time flood-fill), and
    // a same-component candidate is unaffected — so a map with every tree reachable (the golden slice) is
    // byte-identical. Measured from `here`, the settler's actual route start (bridges are not yet walkable
    // in the collision join, so the two banks are genuinely separate components — a named limitation).
    if (terrain.componentOf(here) !== terrain.componentOf(cell)) continue;
    const dist = manhattan(terrain, origin, cell); // distance from the flag (bound) or the settler (roaming)
    if (dist > radius) continue; // outside the flag's work radius — a bound gatherer leaves it be
    if (closer(dist, cell, bestDist, bestCell)) {
      best = e;
      bestDist = dist;
      bestCell = cell;
    }
  }
  return best;
}

/**
 * The nearest **collectable ground drop** a felling collector should carry off — a bare
 * {@link GroundDrop} trunk pile (a felled tree's dropped wood) whose good THIS settler's job may
 * harvest — with its Manhattan distance, or null if none is in reach. Scoped two ways so it stays the
 * collector's *own-trade* loop, not a general porter drive: (1) to `GroundDrop` piles only (a felled
 * trunk / dropped good), never a designated delivery flag or a boat hull — both equally-bare
 * `Stockpile`s; (2) to a good the settler harvests, via the SAME {@link jobAtomics} gate
 * {@link nearestHarvestableFor} uses (a woodcutter collects wood, not a stonecutter's dropped stone).
 *
 * Nearest by Manhattan + ascending-cell-id (canonical scan); the pile's good is its lowest-id stocked
 * good ({@link stockpileEntries}, never raw Map order). The planner weighs the returned `dist` against
 * {@link nearestHarvestableFor}'s node so, standing on its fresh trunk (distance 0), the collector
 * picks the wood up before wandering to the next tree — the original's fell-then-carry cadence.
 * Unlike harvesting, collecting an already-dropped good applies no `needforgood` XP gate (carrying a
 * trunk is hauling, not harvesting). Determinism: pure reads over content + components, no RNG.
 */
export function nearestCollectablePileFor(
  candidates: readonly Entity[],
  harvestAtomicByGood: ReadonlyMap<number, number>,
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  here: NodeId,
  jobType: number,
): { pile: Entity; goodType: number; dist: number } | null {
  const allowed = jobAtomics(ctx, jobType);
  let best: { pile: Entity; goodType: number } | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  let bestCell = Number.POSITIVE_INFINITY;
  // `candidates` is the GroundDrop candidate list, so every entry already has GroundDrop+Stockpile+Position
  // (built by collectTargets) — no per-pile marker re-check, and the scan is O(drops), ~0 when none exist.
  for (const e of candidates) {
    const good = lowestStockedGood(world.get(e, Stockpile));
    if (good === null) continue; // an emptied drop (about to be reaped) — nothing to collect
    const harvestAtomic = harvestAtomicByGood.get(good);
    if (harvestAtomic === undefined || !allowed.has(harvestAtomic)) continue; // not this job's trade
    const cell = interactionCell(world, ctx, terrain, e, here);
    const dist = manhattan(terrain, here, cell);
    if (closer(dist, cell, bestDist, bestCell)) {
      best = { pile: e, goodType: good };
      bestDist = dist;
      bestCell = cell;
    }
  }
  return best === null ? null : { ...best, dist: bestDist };
}

/**
 * The nearest ground drop THIS gatherer harvested into being — a {@link GroundDrop} whose {@link HarvestedBy}
 * owner is `owner` — with its Manhattan distance from `here`, or null if it holds none. This is the
 * flag-bound gatherer's collect drive: it reclaims the trunk/ore IT felled or mined and delivers it to its
 * flag, and — unlike {@link nearestCollectablePileFor}'s trade-wide scan — it ignores every pile it did not
 * make (another gatherer's trunk, a player-dropped heap), the "carry only what you dug" rule. Nearest by
 * Manhattan + ascending-cell-id (canonical scan); the pile's good is its lowest-id stocked good. A
 * fully-collected drop empties and is reaped, so it drops out of the scan naturally. Determinism: pure reads
 * over components, no RNG; a stored owner id is stable (entity ids are monotonic, never reused).
 */
export function nearestOwnDropFor(
  candidates: readonly Entity[],
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  here: NodeId,
  owner: Entity,
): { pile: Entity; goodType: number; dist: number } | null {
  let best: { pile: Entity; goodType: number } | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  let bestCell = Number.POSITIVE_INFINITY;
  for (const e of candidates) {
    const mark = world.tryGet(e, HarvestedBy);
    if (mark === undefined || mark.by !== owner) continue; // not this gatherer's own drop — leave it be
    const good = lowestStockedGood(world.get(e, Stockpile));
    if (good === null) continue; // an emptied drop (about to be reaped) — nothing to collect
    const cell = interactionCell(world, ctx, terrain, e, here);
    const dist = manhattan(terrain, here, cell);
    if (closer(dist, cell, bestDist, bestCell)) {
      best = { pile: e, goodType: good };
      bestDist = dist;
      bestCell = cell;
    }
  }
  return best === null ? null : { ...best, dist: bestDist };
}
