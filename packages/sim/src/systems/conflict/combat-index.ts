import {
  combatHostileMasks,
  EVERY_PLAYER,
  Health,
  hostileMaskOf,
  Owner,
  Position,
  Vehicle,
} from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { hexDistanceBetween } from '../../nav/halfcell.js';
import type { TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { forEachVehicleFootprintNode } from '../footprint/index.js';
import {
  type BandScan,
  type CoarseCell,
  type CombatGrid,
  coarseOf,
  combatGridOf,
  type MemberList,
  playerBit,
  playerOfBit,
  type SearchMetric,
} from './combat-grid.js';
import { type MannedPosts, mannedPostsOf } from './manned-posts.js';
import { HeldFiringBuildings } from './targeting.js';
import { mannedPostOf } from './tower-post.js';

/** A candidate packs as `distance * CANDIDATE_ID_SPAN + entity`, so a numeric sort orders by distance and then
 *  id. Entity ids stay below 2^32 and distances below 2^21, so the key is an exact double. */
const CANDIDATE_ID_SPAN = 2 ** 32;

/** The index each world's latest combat pass built, which the shots landing after it read. */
const passIndexes = new WeakMap<World, CombatIndex>();

export function holdPassIndex(world: World, index: CombatIndex): void {
  passIndexes.set(world, index);
}

/** The index this tick's combat pass built, or null on a tick it did not run because no fight was
 *  possible. Positions do not change between the pass and the landing shots. */
export function passIndexOf(world: World, tick: number): CombatIndex | null {
  const index = passIndexes.get(world);
  return index !== undefined && index.tick === tick ? index : null;
}

/** The firing set of an index built for presence queries alone. */
const NO_FIRING: ReadonlySet<Entity> = new Set();

/** Each world's firing set, refreshed in place by every pass index built for it. */
const heldFiring = new WeakMap<World, HeldFiringBuildings>();

function heldFiringOf(world: World): HeldFiringBuildings {
  let held = heldFiring.get(world);
  if (held === undefined) {
    held = new HeldFiringBuildings();
    heldFiring.set(world, held);
  }
  return held;
}

/** The tick each world's combat system last found no fight possible on. */
const dormantTicks = new WeakMap<World, number>();

export function holdDormantTick(world: World, tick: number): void {
  dormantTicks.set(world, tick);
}

/** Whether the combat system's dormancy gate found no fight possible on `tick`, so no pass ran: among
 *  its tests, the map held no hunter and huntable prey alive together, wherever they stood. */
export function combatDormantOn(world: World, tick: number): boolean {
  return dormantTicks.get(world) === tick;
}

/**
 * The combat tick's target index over every combatant (a Settler with a Health pool and a Position), every
 * vehicle and every building with a Health pool, a felled one included until cleanup reaps it: the coarse
 * cells of the world's {@link CombatGrid}, each holding its early-out tallies and its members. Buildings and
 * combatants are the grid's held layers and vehicles are appended per build, so an index answers until the
 * next one is built for the same world. Derived state, never hashed.
 *
 * The coarse queries over-approximate (Chebyshev box ⊇ Manhattan diamond and map-point disc, cell
 * granularity, and "owned by a player at war with the seeker either way, or unowned and not passive
 * wildlife" ⊇ every gated accept filter), so a `false` proves the nearest search would find nothing; a
 * seeker whose filter breaks that superset is ungated via a null `EngageSpec.player`.
 *
 * A nearest query scans the members of the coarse cells its box overlaps rather than walking every node of
 * every ring: a search band of radius 20 holds 840 nodes but rarely more than a few dozen members. The
 * winner is still the canonical (min distance, then min id) one, because candidates are sorted on exactly
 * that key before `accept` sees them.
 */
export class CombatIndex {
  private readonly grid: CombatGrid;
  /** The tick this index was built on. */
  readonly tick: number;
  /** Per player slot, the {@link playerBit}s of the players it fights either way ({@link combatHostileMasks}),
   *  resolved once at build: every stance writer ahead of `combat` in the tick schedule has run by then and
   *  none runs inside it, so a stance flipped or a peace ended earlier this tick is already seen. */
  private readonly hostileMasks: readonly number[];
  /** The buildings able to shoot this build, the only ones a struck civilian runs from. The next index
   *  built for the same world refreshes this set in place. */
  readonly firing: ReadonlySet<Entity>;
  /** Which garrison holds its post, synced at this build; null for a `presence` index. */
  private readonly posts: MannedPosts | null;
  /** {@link firing} as the getter `strikeRank` reads. */
  readonly firingNow = (): ReadonlySet<Entity> => this.firing;
  /** How many queries are iterating their band: an `accept` that re-enters a query scans on the next
   *  depth's buffer, leaving the outer band intact. */
  private depth = 0;

  /** Every building holding a Health pool joins at every wall node, and every vehicle at every node of its
   *  disc, so a search finds a body at the distance to its nearest face. A `presence` index answers the
   *  target queries alone and holds no {@link firing} set, so no shot, flee or strike rank may read it. */
  constructor(world: World, ctx: SystemContext, terrain: TerrainGraph, use: 'pass' | 'presence' = 'pass') {
    this.tick = ctx.tick;
    this.hostileMasks = combatHostileMasks(world);
    this.grid = combatGridOf(world, ctx, terrain);
    this.grid.startBuild(world, ctx);
    if (use === 'pass') {
      this.posts = mannedPostsOf(world, ctx.content);
      this.posts.sync(ctx);
      this.firing = heldFiringOf(world).refresh(world, ctx, this.posts);
    } else {
      this.posts = null;
      this.firing = NO_FIRING;
    }
    // A vehicle moves, so it joins per build rather than in a held layer.
    for (const v of world.query(Vehicle, Health, Position)) {
      const owner = world.tryGet(v, Owner);
      const admit = this.grid.bodyAdmitter(v, owner === undefined ? 0 : playerBit(owner.player));
      forEachVehicleFootprintNode(world, ctx.content, terrain, v, admit);
    }
  }

  /** The post `e` is holding (`mannedPostOf`), or null. */
  mannedPost(world: World, ctx: SystemContext, e: Entity): Entity | null {
    return this.posts === null ? mannedPostOf(world, ctx, e) : this.posts.mannedPost(ctx, e);
  }

  /** Whether member `e` is a plain building - the siege tier a warrior turns on only when nothing better is
   *  in sight. False for a settler, a headquarters, a tower and anything not indexed. */
  isLowPriorityBuilding(e: Entity): boolean {
    return this.grid.isLowPriorityBuilding(e);
  }

  /**
   * The nearest indexed target to node (fromX, fromY) satisfying `accept`, over `minDist..maxDist` by `metric`:
   * the min-distance, then min-id acceptor, `accept` asked in that order and stopped at the first yes.
   * `accept` must be total and pure over any indexed entity: a rejection is remembered for the call.
   * Members owned by `seeker` or by a player at peace with it both ways are never offered: every gated
   * target filter rejects them, so skipping them here saves the filter's reads without changing the winner.
   * `accept` may re-enter this method: a nested query scans into its own depth's buffer.
   */
  nearest(
    fromX: number,
    fromY: number,
    minDist: number,
    maxDist: number,
    accept: (e: Entity) => boolean,
    seeker: number | null,
    metric: SearchMetric = 'manhattan',
  ): { entity: Entity; distance: number } | null {
    const scan = this.bandScan(fromX, fromY, minDist, maxDist, seeker, metric);
    const { keys, count } = scan;
    // A member admitted at several nodes recurs at a larger distance; a rejection holds for all of them.
    scan.met.begin();
    this.depth++;
    try {
      for (let i = 0; i < count; i++) {
        const key = keys[i] ?? 0;
        const distance = Math.floor(key / CANDIDATE_ID_SPAN);
        const entity = (key - distance * CANDIDATE_ID_SPAN) as Entity;
        if (!scan.met.firstMark(entity)) continue;
        if (accept(entity)) return { entity, distance };
      }
      return null;
    } finally {
      this.depth--;
    }
  }

  /**
   * The `limit` nearest indexed targets satisfying `accept`, in the same (distance, then id) order
   * {@link nearest} picks its winner from, so `[0]` is exactly what `nearest` returns. A member indexed at
   * several nodes is listed once, at its nearest, and `accept` is asked once per member, so it must be
   * total and pure over any indexed entity. The take stops at `limit` acceptors, `maxDist`, or `tailRings`
   * past the first ring that hit, so a band holding fewer acceptors than asked for does not cost every
   * candidate out to `maxDist`.
   */
  nearestFew(
    fromX: number,
    fromY: number,
    minDist: number,
    maxDist: number,
    accept: (e: Entity) => boolean,
    limit: number,
    seeker: number | null,
    tailRings: number,
    metric: SearchMetric = 'manhattan',
  ): readonly { entity: Entity; distance: number }[] {
    const scan = this.bandScan(fromX, fromY, minDist, maxDist, seeker, metric);
    const { keys, count } = scan;
    const found: { entity: Entity; distance: number }[] = [];
    let lastRing = maxDist;
    scan.met.begin();
    this.depth++;
    try {
      for (let i = 0; i < count && found.length < limit; i++) {
        const key = keys[i] ?? 0;
        const distance = Math.floor(key / CANDIDATE_ID_SPAN);
        if (distance > lastRing) break;
        const entity = (key - distance * CANDIDATE_ID_SPAN) as Entity;
        if (!scan.met.firstMark(entity)) continue;
        if (!accept(entity)) continue;
        found.push({ entity, distance });
        lastRing = Math.min(lastRing, distance + tailRings);
      }
      return found;
    } finally {
      this.depth--;
    }
  }

  /**
   * Uncounted {@link nearestFew} for each of several disjoint kinds in one scan: per kind, the acceptors of
   * that kind out to `tailRings` past its own first hit, exactly what asking kind by kind returns, in
   * (distance, id) order. `kindOf(e)` names `e`'s kind below `kinds`, or -1 for none; it and `accept` must
   * be total and pure, and each is asked at most once per member.
   */
  nearestOfEachKind(
    fromX: number,
    fromY: number,
    minDist: number,
    maxDist: number,
    kindOf: (e: Entity) => number,
    kinds: number,
    accept: (e: Entity) => boolean,
    seeker: number | null,
    tailRings: number,
    metric: SearchMetric = 'manhattan',
  ): readonly (readonly Entity[])[] {
    const scan = this.bandScan(fromX, fromY, minDist, maxDist, seeker, metric);
    const { keys, count } = scan;
    const found: Entity[][] = [];
    const lastRings: number[] = [];
    for (let k = 0; k < kinds; k++) {
      found.push([]);
      lastRings.push(maxDist);
    }
    // The farthest ring any kind still takes.
    let open = maxDist;
    scan.met.begin();
    this.depth++;
    try {
      for (let i = 0; i < count; i++) {
        const key = keys[i] ?? 0;
        const distance = Math.floor(key / CANDIDATE_ID_SPAN);
        if (distance > open) break;
        const entity = (key - distance * CANDIDATE_ID_SPAN) as Entity;
        if (!scan.met.firstMark(entity)) continue;
        const kind = kindOf(entity);
        const take = found[kind];
        const lastRing = lastRings[kind];
        if (take === undefined || lastRing === undefined || distance > lastRing || !accept(entity)) continue;
        take.push(entity);
        lastRings[kind] = Math.min(lastRing, distance + tailRings);
        open = 0;
        for (const ring of lastRings) open = Math.max(open, ring);
      }
      return found;
    } finally {
      this.depth--;
    }
  }

  /**
   * {@link nearestFew} over the best of several kinds in one scan: the take of the lowest `rank` any
   * acceptor holds, exactly what asking `nearestFew` kind by kind returns at the first kind with an
   * acceptor. `rank(e, bound)` names the first kind below `bound` that `e` is of, or `bound` for none, and
   * `accept` must be total and pure; both are asked at most once per member.
   */
  nearestFewOfBestRank(
    fromX: number,
    fromY: number,
    minDist: number,
    maxDist: number,
    rank: (e: Entity, bound: number) => number,
    ranks: number,
    accept: (e: Entity) => boolean,
    limit: number,
    seeker: number | null,
    tailRings: number,
    metric: SearchMetric = 'manhattan',
  ): readonly { entity: Entity; distance: number }[] {
    const scan = this.bandScan(fromX, fromY, minDist, maxDist, seeker, metric);
    const { keys, count } = scan;
    let found: { entity: Entity; distance: number }[] = [];
    let best = ranks;
    let lastRing = maxDist;
    scan.met.begin();
    this.depth++;
    try {
      for (let i = 0; i < count; i++) {
        const key = keys[i] ?? 0;
        const distance = Math.floor(key / CANDIDATE_ID_SPAN);
        // Once the best kind's take is full or past its tail, only a better kind can still change it.
        const closed = found.length >= limit || distance > lastRing;
        const bound = closed ? best : best + 1;
        if (bound === 0) break;
        const entity = (key - distance * CANDIDATE_ID_SPAN) as Entity;
        if (!scan.met.firstMark(entity)) continue;
        const kind = rank(entity, Math.min(bound, ranks));
        if (kind >= bound || kind >= ranks || !accept(entity)) continue;
        if (kind < best) {
          best = kind;
          found = [];
          lastRing = maxDist;
        }
        found.push({ entity, distance });
        lastRing = Math.min(lastRing, distance + tailRings);
      }
      return found;
    } finally {
      this.depth--;
    }
  }

  /**
   * Every unit or building owned by `player` within `maxDist` of node (fromX, fromY) by `metric`, each once at
   * its nearest admitted node, in ascending (distance, id) order. Only the owner's own members are measured,
   * so the cost is the owner's members in the box, however crowded the box is with anyone else.
   */
  ownedWithin(
    player: number,
    fromX: number,
    fromY: number,
    maxDist: number,
    metric: SearchMetric,
  ): readonly { entity: Entity; distance: number }[] {
    const bit = playerBit(player);
    if (bit === 0) return [];
    // This depth's band scan holds the keys, so the next band query here scans afresh.
    const scan = this.grid.bandScanAt(this.depth);
    scan.valid = false;
    let count = 0;
    const { cx0, cx1, cy0, cy1 } = boxCellRange(fromX, fromY, maxDist);
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cy = cy0; cy <= cy1; cy++) {
        const cell = this.grid.cellAt(cx, cy);
        if (cell === undefined) continue;
        if (((cell.baseOwnerMask | cell.buildOwnerMask) & bit) !== 0)
          count = appendOwned(scan, count, cell.bodies, bit, fromX, fromY, maxDist, metric);
        if ((cell.unitOwnerMask & bit) !== 0)
          count = appendOwned(scan, count, cell.units, bit, fromX, fromY, maxDist, metric);
      }
    }
    sortKeys(scan.keys, count);
    const { keys } = scan;
    scan.met.begin();
    const found: { entity: Entity; distance: number }[] = [];
    for (let i = 0; i < count; i++) {
      const key = keys[i] ?? 0;
      const distance = Math.floor(key / CANDIDATE_ID_SPAN);
      const entity = (key - distance * CANDIDATE_ID_SPAN) as Entity;
      if (scan.met.firstMark(entity)) found.push({ entity, distance });
    }
    return found;
  }

  /**
   * Whether any member `player` might fight or flee from lies within `radius` map points of node (hx, hy): one
   * owned by a player holding `enemy` toward or from it, or an unowned one other than passive wildlife.
   * `false` is a proof of absence; `true` only means "run the real search".
   */
  othersWithin(player: number, hx: number, hy: number, radius: number): boolean {
    return this.someCell(hx, hy, radius, 'others', hostileMaskOf(this.hostileMasks, player));
  }

  /**
   * Whether the stranger neighbourhood {@link unitsNearStrangers} derived this pass already proves
   * {@link othersWithin} false for unit `e` at every radius up to `radius`, with no cell walked. False
   * proves nothing.
   */
  clearOfStrangers(e: Entity, radius: number): boolean {
    return this.grid.unitClearOfStrangers(e, radius, this.hostileMasks);
  }

  /**
   * Whether any civilization combatant - everything not classified wildlife - might lie within `radius` map
   * points of node (hx, hy). The hostile-animal seeker's early-out twin of {@link othersWithin}, since a
   * wild animal's only valid targets are civilization settlers.
   */
  civsWithin(hx: number, hy: number, radius: number): boolean {
    return this.someCell(hx, hy, radius, 'civs', 0);
  }

  /**
   * Write to `out` from index `at` every owned unit in a slot whose {@link othersWithin} is true at `radius`
   * map points from its node. Only a cell whose neighbourhood of that reach holds an undiscounted member or
   * a player at war with one of its owners is walked. Unordered; returns the new count.
   */
  unitsNearStrangers(radius: number, out: Entity[], at: number): number {
    let count = at;
    for (const cell of this.grid.strangerCellsWithin(radius)) {
      const { units, nearMask, nearUndiscounted } = cell;
      // Decided once per owner here: `listed` when the neighbourhood may hold a stranger for it, `sure` when
      // its own cell does, which lies inside every one of its units' boxes.
      let listed = 0;
      let sure = 0;
      for (let owners = cell.unitOwnerMask; owners !== 0; owners &= owners - 1) {
        const bit = owners & -owners;
        const hostile = hostileMaskOf(this.hostileMasks, playerOfBit(bit));
        if (passes(cell, 'others', hostile)) sure |= bit;
        if (nearUndiscounted || (nearMask & hostile) !== 0) listed |= bit;
      }
      if (listed === 0) continue;
      for (let i = 0; i < units.count; i++) {
        const unit = units.members[i];
        const bit = units.bit[i] ?? 0;
        if (unit === undefined || (bit & listed) === 0) continue;
        if (
          (bit & sure) !== 0 ||
          this.someCell(
            units.x[i] ?? 0,
            units.y[i] ?? 0,
            radius,
            'others',
            hostileMaskOf(this.hostileMasks, playerOfBit(bit)),
          )
        ) {
          out[count++] = unit;
        }
      }
    }
    return count;
  }

  /** Every (member, admitted node) pair within the band as sorted candidate keys, in this depth's scan. A
   *  seeker asks the same band once per target tier, so the second tier reuses the first tier's scan. */
  private bandScan(
    fromX: number,
    fromY: number,
    minDist: number,
    maxDist: number,
    seeker: number | null,
    metric: SearchMetric,
  ): BandScan {
    const scan = this.grid.bandScanAt(this.depth);
    if (
      scan.valid &&
      scan.x === fromX &&
      scan.y === fromY &&
      scan.minDist === minDist &&
      scan.maxDist === maxDist &&
      scan.metric === metric &&
      scan.seeker === seeker
    ) {
      return scan;
    }
    const hostile = seeker === null ? EVERY_PLAYER : hostileMaskOf(this.hostileMasks, seeker);
    let count = 0;
    const { cx0, cx1, cy0, cy1 } = boxCellRange(fromX, fromY, maxDist);
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cy = cy0; cy <= cy1; cy++) {
        const cell = this.grid.cellAt(cx, cy);
        if (cell === undefined) continue;
        if (bodiesHoldBandCandidate(cell, hostile))
          count = appendBand(scan, count, cell.bodies, fromX, fromY, minDist, maxDist, hostile, metric);
        if (unitsHoldBandCandidate(cell, hostile))
          count = appendBand(scan, count, cell.units, fromX, fromY, minDist, maxDist, hostile, metric);
      }
    }
    sortKeys(scan.keys, count);
    scan.valid = true;
    scan.x = fromX;
    scan.y = fromY;
    scan.minDist = minDist;
    scan.maxDist = maxDist;
    scan.metric = metric;
    scan.seeker = seeker;
    scan.count = count;
    return scan;
  }

  /** Whether any coarse cell overlapping the box `radius` nodes around (hx, hy) passes `test` against the
   *  asking player's `hostile` mask. */
  private someCell(hx: number, hy: number, radius: number, test: CellTest, hostile: number): boolean {
    const { cx0, cx1, cy0, cy1 } = boxCellRange(hx, hy, radius);
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cy = cy0; cy <= cy1; cy++) {
        const cell = this.grid.cellAt(cx, cy);
        if (cell !== undefined && passes(cell, test, hostile)) return true;
      }
    }
    return false;
  }
}

/** The presence tests {@link CombatIndex.someCell} runs: {@link CombatIndex.othersWithin} and
 *  {@link CombatIndex.civsWithin}. */
type CellTest = 'others' | 'civs';

function passes(cell: CoarseCell, test: CellTest, hostile: number): boolean {
  switch (test) {
    case 'others':
      return cell.undiscounted > 0 || (cell.ownerMask & hostile) !== 0;
    case 'civs':
      return cell.total - cell.passive - cell.hostileAnimal > 0;
  }
}

/** Whether `cell`'s bodies hold one a band scan for the `hostile` players keeps: a building or vehicle
 *  owned by such a player, or one with no player bit, which the tallies count as undiscounted. A seeker
 *  among its own houses so skips their every wall node. */
function bodiesHoldBandCandidate(cell: CoarseCell, hostile: number): boolean {
  return (
    ((cell.baseOwnerMask | cell.buildOwnerMask) & hostile) !== 0 ||
    cell.baseUndiscounted > 0 ||
    cell.buildUndiscounted > 0
  );
}

/** {@link bodiesHoldBandCandidate} for `cell`'s units, whose members with no player bit the tallies count
 *  as undiscounted or passive. */
function unitsHoldBandCandidate(cell: CoarseCell, hostile: number): boolean {
  return (cell.unitOwnerMask & hostile) !== 0 || cell.unitUndiscounted > 0 || cell.unitPassive > 0;
}

/** Append to `scan` from `count` every member of `list` within `minDist..maxDist` of (fromX, fromY) that
 *  `hostile` does not skip, growing its key buffer as needed; returns the new count. */
function appendBand(
  scan: BandScan,
  count: number,
  list: MemberList,
  fromX: number,
  fromY: number,
  minDist: number,
  maxDist: number,
  hostile: number,
  metric: SearchMetric,
): number {
  const { members, x, y, bit } = list;
  let n = count;
  for (let i = 0; i < list.count; i++) {
    const memberBit = bit[i] ?? 0;
    if (memberBit !== 0 && (memberBit & hostile) === 0) continue;
    const mx = x[i] ?? 0;
    const my = y[i] ?? 0;
    const distance =
      metric === 'hex'
        ? hexDistanceBetween(fromX, fromY, mx, my)
        : Math.abs(mx - fromX) + Math.abs(my - fromY);
    if (distance < minDist || distance > maxDist) continue;
    if (n === scan.keys.length) growKeys(scan);
    scan.keys[n++] = distance * CANDIDATE_ID_SPAN + (members[i] ?? 0);
  }
  return n;
}

/** The longest band sorted by insertion: a typed sort's view and call cost more than so few compares. */
const INSERTION_SORT_MAX_KEYS = 16;

/** Sort the first `count` of `keys` ascending, in place. */
function sortKeys(keys: Float64Array, count: number): void {
  if (count > INSERTION_SORT_MAX_KEYS) {
    // A typed array sorts numerically without a comparator call per compare.
    keys.subarray(0, count).sort();
    return;
  }
  for (let i = 1; i < count; i++) {
    const key = keys[i] ?? 0;
    let at = i;
    for (; at > 0 && (keys[at - 1] ?? 0) > key; at--) keys[at] = keys[at - 1] ?? 0;
    keys[at] = key;
  }
}

/** Double `scan`'s key buffer, keeping its keys. */
function growKeys(scan: BandScan): void {
  const grown = new Float64Array(scan.keys.length * 2);
  grown.set(scan.keys);
  scan.keys = grown;
}

/** Append to `scan` from `count` every member of `list` owned by `bit` within `maxDist` of (fromX, fromY),
 *  growing its key buffer as needed; returns the new count. */
function appendOwned(
  scan: BandScan,
  count: number,
  list: MemberList,
  bit: number,
  fromX: number,
  fromY: number,
  maxDist: number,
  metric: SearchMetric,
): number {
  let n = count;
  for (let i = 0; i < list.count; i++) {
    if (list.bit[i] !== bit) continue;
    const mx = list.x[i] ?? 0;
    const my = list.y[i] ?? 0;
    const distance =
      metric === 'hex'
        ? hexDistanceBetween(fromX, fromY, mx, my)
        : Math.abs(mx - fromX) + Math.abs(my - fromY);
    if (distance > maxDist) continue;
    if (n === scan.keys.length) growKeys(scan);
    scan.keys[n++] = distance * CANDIDATE_ID_SPAN + (list.members[i] ?? 0);
  }
  return n;
}

/** The inclusive coarse-cell range covering the box `radius` nodes around (hx, hy). */
function boxCellRange(
  hx: number,
  hy: number,
  radius: number,
): { cx0: number; cx1: number; cy0: number; cy1: number } {
  return {
    cx0: coarseOf(hx - radius),
    cx1: coarseOf(hx + radius),
    cy0: coarseOf(hy - radius),
    cy1: coarseOf(hy + radius),
  };
}
