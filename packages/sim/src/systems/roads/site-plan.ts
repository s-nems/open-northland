import { footprintCellDx } from '@open-northland/data';
import type { Entity, World } from '../../ecs/world.js';
import { HEX_NEIGHBOUR_OFFSETS } from '../../nav/halfcell.js';
import type { TerrainGraph } from '../../nav/terrain/index.js';
import { siteClaimHolder } from '../economy/site-claim.js';
import { ownedRoadSites, ownedRoadSitesKey } from './site-index.js';

/**
 * What a builder should make of an unclaimed road site:
 * - `build`: a site of the stone plan whose stone paves others too, or one whose stone already lies there;
 * - `filler`: a site of the plan whose stone paves one site still unpaved when planned, taken once no
 *   `build` site is left, so a short supply of stone paves the most road first;
 * - `paved`: a site a claimed neighbour's stone will pave for free;
 * - `spare`: a site the plan covers from a planned neighbour, worth building only when that one is not;
 * - `waiting`: a site an unclaimed neighbour's delivered stone will pave once that one is built, taken
 *   last, for a builder that cannot take the neighbour.
 */
export type RoadSiteRole = 'build' | 'filler' | 'paved' | 'spare' | 'waiting';

/** A stone plan's answer per site. */
export interface RoadSitePlan {
  /** The role of one of the plan owner's sites; undefined for one claimed when planned or another owner's. */
  roleOf(site: Entity): RoadSiteRole | undefined;
  /** Whether `roleOf(site)` is `role`, without the claim checks a site of another role needs. */
  is(site: Entity, role: RoadSiteRole): boolean;
  /** Whether any site was planned in `role`; a later claim only ever turns such a site `paved`. */
  has(role: RoadSiteRole): boolean;
}

interface OwnerPlan {
  readonly key: string;
  /** The last tick that asked for it. */
  tick: number;
  readonly plan: RoadSitePlan;
}

interface WorldPlans {
  readonly terrain: TerrainGraph;
  readonly byOwner: Map<number | undefined, OwnerPlan>;
}

const plans = new WeakMap<World, WorldPlans>();

/**
 * `owner`'s stone plan for its road sites. A finished site's stone also paves each unclaimed, unstocked
 * neighbour of its owner, so the plan picks a small set of sites whose stone paves every pending one: the
 * claimed and stocked sites first, as they are built anyway, then greedily, for the most hemmed-in unpaved
 * site, the site around it that paves the most still unpaved. Every builder works from the same plan, so a
 * crowd of builders spends no more stone than one. Project rule; the original takes the nearest site.
 *
 * A pure function of the owner's sites as the tick's first ask finds them, rebuilt at most once a tick and
 * only when one came, went, or changed what the plan reads. The builders of one tick share that plan, so a
 * crowd claiming its sites costs one pass; each one's own site checks see the claims made since.
 */
export function roadSitePlan(
  world: World,
  terrain: TerrainGraph,
  owner: number | undefined,
  tick: number,
): RoadSitePlan {
  let held = plans.get(world);
  if (held === undefined || held.terrain !== terrain) {
    held = { terrain, byOwner: new Map() };
    plans.set(world, held);
  }
  let entry = held.byOwner.get(owner);
  if (entry?.tick === tick) return entry.plan;
  const key = ownedRoadSitesKey(world, terrain, owner);
  if (entry === undefined || entry.key !== key) {
    entry = { key, tick, plan: planSites(world, terrain, owner) };
    held.byOwner.set(owner, entry);
  }
  entry.tick = tick;
  return entry.plan;
}

const NO_ROLE = 0;
const BUILD = 1;
const FILLER = 2;
const PAVED = 3;
const SPARE = 4;
const WAITING = 5;
const ROLE_NAMES: readonly (RoadSiteRole | undefined)[] = [
  undefined,
  'build',
  'filler',
  'paved',
  'spare',
  'waiting',
];
const ROLE_CODES: Readonly<Record<RoadSiteRole, number>> = {
  build: BUILD,
  filler: FILLER,
  paved: PAVED,
  spare: SPARE,
  waiting: WAITING,
};
/** A closed lattice neighbourhood: the site itself, then its six neighbours. */
const AROUND = HEX_NEIGHBOUR_OFFSETS.length + 1;
const NO_SITE = -1;
/** Priorities a closed neighbourhood gives: its unpaved and its pending site counts, each 0..AROUND. */
const PRIORITY_STRIDE = AROUND + 1;
const PRIORITIES = PRIORITY_STRIDE * PRIORITY_STRIDE;
/** A multiple of every unpaved count 1..AROUND, so a paver's summed share of the sites it paves is exact. */
const SHARE_WHOLE = 420;

/** Per-call scratch fully reset after use, so it carries no state: each node's site slot, or none. */
let slotByNode = new Int32Array(0);

function planSites(world: World, terrain: TerrainGraph, owner: number | undefined): RoadSitePlan {
  const owned = ownedRoadSites(world, terrain, owner);
  // Slots in ascending id, so every tie below falls the same way however the sites were indexed.
  const sites = [...owned.keys()].sort((a, b) => a - b);
  const count = sites.length;
  const slotOf = new Map<Entity, number>();
  const pending = new Uint8Array(count);
  const open = new Uint8Array(count);
  if (slotByNode.length < terrain.nodeCount) slotByNode = new Int32Array(terrain.nodeCount).fill(NO_SITE);
  for (let slot = 0; slot < count; slot++) {
    const site = sites[slot];
    const entry = site === undefined ? undefined : owned.get(site);
    if (site === undefined || entry === undefined) continue;
    slotOf.set(site, slot);
    slotByNode[entry.node] = slot;
    open[slot] = entry.open ? 1 : 0;
    pending[slot] = entry.open && !entry.stocked ? 1 : 0;
  }
  // Each site's closed neighbourhood of the owner's pending sites, by slot, ended by NO_SITE when short.
  const around = new Int32Array(count * AROUND).fill(NO_SITE);
  for (const [site, entry] of owned) {
    const slot = slotOf.get(site) ?? NO_SITE;
    const hx = terrain.xOf(entry.node);
    const hy = terrain.yOf(entry.node);
    let n = slot * AROUND;
    if (pending[slot] === 1) around[n++] = slot;
    for (let i = 0; i < HEX_NEIGHBOUR_OFFSETS.length; i++) {
      const c = HEX_NEIGHBOUR_OFFSETS[i];
      if (c === undefined) continue;
      const nx = hx + footprintCellDx(hy, c);
      const ny = hy + c.dy;
      if (!terrain.inBounds(nx, ny)) continue;
      const other = slotByNode[terrain.nodeAt(nx, ny)] ?? NO_SITE;
      if (other !== NO_SITE && pending[other] === 1) around[n++] = other;
    }
  }
  for (const entry of owned.values()) slotByNode[entry.node] = NO_SITE;

  const roles = new Uint8Array(count);
  // A claim's stone paves for certain; an unclaimed site's delivered stone only once it is built.
  for (const claimed of [false, true]) {
    for (let slot = 0; slot < count; slot++) {
      if (pending[slot] === 1 || (open[slot] === 0) !== claimed) continue;
      if (!claimed) roles[slot] = BUILD;
      for (let n = slot * AROUND, end = n + AROUND; n < end && around[n] !== NO_SITE; n++) {
        roles[around[n] ?? 0] = claimed ? PAVED : WAITING;
      }
    }
  }
  const unpaved = new Uint8Array(count);
  for (let slot = 0; slot < count; slot++)
    unpaved[slot] = pending[slot] === 1 && roles[slot] === NO_ROLE ? 1 : 0;
  // Per pending site, the pending sites around it and how many of those are still unpaved.
  const pavers = new Uint8Array(count);
  const unpavedAround = new Uint8Array(count);
  for (let slot = 0; slot < count; slot++) {
    for (let n = slot * AROUND, end = n + AROUND; n < end && around[n] !== NO_SITE; n++) {
      pavers[slot] = (pavers[slot] ?? 0) + 1;
      unpavedAround[slot] = (unpavedAround[slot] ?? 0) + (unpaved[around[n] ?? 0] ?? 0);
    }
  }

  // The unpaved site with the fewest unpaved sites around it goes first, so the plan grows inward from
  // the edges of what is paved or claimed, leaving no lone gap; then the one fewer sites can pave. A
  // bucket per priority; an entry goes stale when its site's priority drops and is skipped when popped.
  const priority = (slot: number): number =>
    (unpavedAround[slot] ?? 0) * PRIORITY_STRIDE + (pavers[slot] ?? 0);
  const buckets: number[][] = Array.from({ length: PRIORITIES }, () => []);
  let lowest = PRIORITIES;
  const enqueue = (slot: number): void => {
    const p = priority(slot);
    buckets[p]?.push(slot);
    if (p < lowest) lowest = p;
  };
  // Pushed in descending slot order, so the first pops of a bucket go by lowest id.
  for (let slot = count - 1; slot >= 0; slot--) if (unpaved[slot] === 1) enqueue(slot);
  for (;;) {
    while (lowest < PRIORITIES && buckets[lowest]?.length === 0) lowest++;
    const slot = buckets[lowest]?.pop();
    if (slot === undefined) break;
    if (unpaved[slot] === 0 || priority(slot) !== lowest) continue;
    // The pending site around it that paves the most; on a tie, the one whose unpaved sites have the fewest
    // unpaved around them, as fewer other stones could pave those, then a site no stone already paves, so
    // a site a claim paves for free stays free.
    let best = NO_SITE;
    let bestGain = 0;
    let bestShare = 0;
    let bestFree = 0;
    for (let n = slot * AROUND, end = n + AROUND; n < end && around[n] !== NO_SITE; n++) {
      const paver = around[n] ?? 0;
      const gain = unpavedAround[paver] ?? 0;
      if (gain < bestGain) continue;
      let share = 0;
      for (let m = paver * AROUND, stop = m + AROUND; m < stop && around[m] !== NO_SITE; m++) {
        const site = around[m] ?? 0;
        if (unpaved[site] === 1) share += SHARE_WHOLE / (unpavedAround[site] ?? 1);
      }
      const free = roles[paver] === NO_ROLE ? 1 : 0;
      const better =
        gain > bestGain ||
        share > bestShare ||
        (share === bestShare && (free > bestFree || (free === bestFree && paver < best)));
      if (best === NO_SITE || better) {
        best = paver;
        bestGain = gain;
        bestShare = share;
        bestFree = free;
      }
    }
    if (best === NO_SITE) continue;
    roles[best] = (unpavedAround[best] ?? 0) > 1 ? BUILD : FILLER;
    for (let n = best * AROUND, end = n + AROUND; n < end && around[n] !== NO_SITE; n++) {
      const paved = around[n] ?? 0;
      if (unpaved[paved] === 0) continue;
      unpaved[paved] = 0;
      for (let m = paved * AROUND, stop = m + AROUND; m < stop && around[m] !== NO_SITE; m++) {
        const other = around[m] ?? 0;
        unpavedAround[other] = (unpavedAround[other] ?? 1) - 1;
        if (unpaved[other] === 1) enqueue(other);
      }
    }
  }
  for (let slot = 0; slot < count; slot++)
    if (pending[slot] === 1 && roles[slot] === NO_ROLE) roles[slot] = SPARE;

  // A site the plan holds back for want of a better one is paved by a neighbour claimed since.
  const claimedBeside = (slot: number): boolean => {
    for (let n = slot * AROUND, end = n + AROUND; n < end && around[n] !== NO_SITE; n++) {
      const other = around[n] ?? 0;
      const site = sites[other];
      if (other !== slot && site !== undefined && siteClaimHolder(world, site) !== null) return true;
    }
    return false;
  };
  const planned = new Set<number>(roles);
  const roleOf = (site: Entity): RoadSiteRole | undefined => {
    const slot = slotOf.get(site);
    if (slot === undefined) return undefined;
    const role = roles[slot] ?? NO_ROLE;
    return role !== BUILD && role !== PAVED && role !== NO_ROLE && claimedBeside(slot)
      ? 'paved'
      : ROLE_NAMES[role];
  };
  return {
    roleOf,
    is: (site, role) => {
      const slot = slotOf.get(site);
      if (slot === undefined || (role !== 'paved' && roles[slot] !== ROLE_CODES[role])) return false;
      return roleOf(site) === role;
    },
    has: (role) => planned.has(ROLE_CODES[role]),
  };
}
