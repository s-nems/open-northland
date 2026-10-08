import {
  EVERY_PLAYER,
  Health,
  hostileMaskOf,
  hostilePlayerMasks,
  Owner,
  Position,
  Vehicle,
} from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { hexDistanceBetween } from '../../nav/halfcell.js';
import type { TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { vehicleFootprintNodes } from '../footprint/index.js';
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
import { firingBuildings } from './targeting.js';
import { vehicleWeapon } from './weapons.js';

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
  /** Per player slot, the {@link playerBit}s of the players it holds `enemy` toward or from, resolved once at
   *  build: every stance writer ahead of `combat` in the tick schedule has run by then and none runs inside
   *  it, so a stance flipped earlier this tick is already seen. */
  private readonly hostileMasks: readonly number[];
  /** The buildings able to shoot this build, the only ones a fleer runs from. */
  readonly firing: ReadonlySet<Entity>;
  /** How many queries are iterating their band: an `accept` that re-enters a query scans on the next
   *  depth's buffer, leaving the outer band intact. */
  private depth = 0;

  /** Every building holding a Health pool joins at every wall node, and every vehicle at every node of its
   *  disc, so a search finds a body at the distance to its nearest face. */
  constructor(world: World, ctx: SystemContext, terrain: TerrainGraph) {
    this.tick = ctx.tick;
    this.hostileMasks = hostilePlayerMasks(world);
    this.grid = combatGridOf(world, ctx, terrain);
    this.grid.startBuild(world, ctx);
    const firing = firingBuildings(world, ctx);
    for (const b of firing) this.grid.admitFiring(b);
    this.firing = firing;
    // A vehicle moves, so it joins per build rather than in a held layer.
    for (const v of world.query(Vehicle, Health, Position)) {
      const owner = world.tryGet(v, Owner);
      this.grid.admitBody(
        v,
        vehicleFootprintNodes(world, ctx.content, terrain, v),
        owner === undefined ? 0 : playerBit(owner.player),
        vehicleWeapon(ctx, world.get(v, Vehicle)) !== null,
      );
    }
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
    beginMeetings(scan);
    this.depth++;
    try {
      for (let i = 0; i < count; i++) {
        const key = keys[i] ?? 0;
        const distance = Math.floor(key / CANDIDATE_ID_SPAN);
        const entity = (key - distance * CANDIDATE_ID_SPAN) as Entity;
        if (!firstMeeting(scan, entity)) continue;
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
    beginMeetings(scan);
    this.depth++;
    try {
      for (let i = 0; i < count && found.length < limit; i++) {
        const key = keys[i] ?? 0;
        const distance = Math.floor(key / CANDIDATE_ID_SPAN);
        if (distance > lastRing) break;
        const entity = (key - distance * CANDIDATE_ID_SPAN) as Entity;
        if (!firstMeeting(scan, entity)) continue;
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
   * Whether {@link nearest} over the same band would find anything: some indexed target `accept` takes. The
   * members are asked in cell order with no sort and the first yes ends the scan, so `accept` must be pure
   * and must not query this index.
   */
  anyWithin(
    fromX: number,
    fromY: number,
    minDist: number,
    maxDist: number,
    accept: (e: Entity) => boolean,
    seeker: number | null,
    metric: SearchMetric,
  ): boolean {
    const hostile = seeker === null ? EVERY_PLAYER : hostileMaskOf(this.hostileMasks, seeker);
    const { cx0, cx1, cy0, cy1 } = boxCellRange(fromX, fromY, maxDist);
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cy = cy0; cy <= cy1; cy++) {
        const cell = this.grid.cellAt(cx, cy);
        if (cell === undefined) continue;
        if (anyInBand(cell.bodies, fromX, fromY, minDist, maxDist, hostile, metric, accept)) return true;
        if (anyInBand(cell.units, fromX, fromY, minDist, maxDist, hostile, metric, accept)) return true;
      }
    }
    return false;
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
    const keys: number[] = [];
    const { cx0, cx1, cy0, cy1 } = boxCellRange(fromX, fromY, maxDist);
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cy = cy0; cy <= cy1; cy++) {
        const cell = this.grid.cellAt(cx, cy);
        if (cell === undefined || (cell.ownerMask & bit) === 0) continue;
        appendOwned(keys, cell.bodies, bit, fromX, fromY, maxDist, metric);
        appendOwned(keys, cell.units, bit, fromX, fromY, maxDist, metric);
      }
    }
    keys.sort((a, b) => a - b);
    const seen = new Set<Entity>();
    const found: { entity: Entity; distance: number }[] = [];
    for (const key of keys) {
      const distance = Math.floor(key / CANDIDATE_ID_SPAN);
      const entity = (key - distance * CANDIDATE_ID_SPAN) as Entity;
      if (seen.has(entity)) continue;
      seen.add(entity);
      found.push({ entity, distance });
    }
    return found;
  }

  /**
   * Whether any member `player` might fight or flee from lies within `radius` map points of node (hx, hy): one
   * owned by a player holding `enemy` toward or from it, or an unowned one other than passive wildlife.
   * `false` is a proof of absence; `true` only means "run the real search".
   */
  othersWithin(player: number, hx: number, hy: number, radius: number): boolean {
    const hostile = hostileMaskOf(this.hostileMasks, player);
    return this.someCell(hx, hy, radius, (cell) => cell.undiscounted > 0 || (cell.ownerMask & hostile) !== 0);
  }

  /**
   * Whether anything `player` might flee from lies within `radius` map points of node (hx, hy): the
   * {@link othersWithin} test over units and {@link firing} buildings only, since a plain building is no
   * flee threat. `false` is a proof of absence; `true` only means "run the real search".
   */
  threatsWithin(player: number, hx: number, hy: number, radius: number): boolean {
    const hostile = hostileMaskOf(this.hostileMasks, player);
    return this.someCell(
      hx,
      hy,
      radius,
      (cell) => cell.threatUndiscounted > 0 || (cell.threatMask & hostile) !== 0,
    );
  }

  /**
   * Whether any civilization combatant - everything not classified wildlife - might lie within `radius` map
   * points of node (hx, hy). The hostile-animal seeker's early-out twin of {@link othersWithin}, since a
   * wild animal's only valid targets are civilization settlers.
   */
  civsWithin(hx: number, hy: number, radius: number): boolean {
    return this.someCell(hx, hy, radius, (cell) => cell.total - cell.passive - cell.hostileAnimal > 0);
  }

  /**
   * Whether any unowned member of a huntable tribe that is not last-resort prey might lie within `radius`
   * map points of node (hx, hy). Every hunter's primary-tier target is one, so `false` proves that tier's
   * search empty.
   */
  gameWithin(hx: number, hy: number, radius: number): boolean {
    return this.someCell(hx, hy, radius, (cell) => cell.game > 0);
  }

  /**
   * Write to `out` from index `at` every owned unit in a slot whose {@link othersWithin} could be true at up
   * to `radius` map points from its node: one in a cell whose neighbourhood of that reach holds an
   * undiscounted member or a player at war with it either way. Every other owned unit proves that test
   * false. Unordered; returns the new count.
   */
  unitsNearStrangers(radius: number, out: Entity[], at: number): number {
    let count = at;
    for (const cell of this.grid.strangerCellsWithin(radius)) {
      const { units, nearMask, nearUndiscounted } = cell;
      for (let i = 0; i < units.count; i++) {
        const unit = units.members[i];
        const bit = units.bit[i] ?? 0;
        if (unit === undefined || bit === 0) continue;
        if (nearUndiscounted || (nearMask & hostileMaskOf(this.hostileMasks, playerOfBit(bit))) !== 0)
          out[count++] = unit;
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
        count = appendBand(scan, count, cell.bodies, fromX, fromY, minDist, maxDist, hostile, metric);
        count = appendBand(scan, count, cell.units, fromX, fromY, minDist, maxDist, hostile, metric);
      }
    }
    // A typed array sorts numerically without a comparator call per compare.
    scan.keys.subarray(0, count).sort();
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

  /** Whether any coarse cell overlapping the box `radius` nodes around (hx, hy) passes `test`. */
  private someCell(hx: number, hy: number, radius: number, test: (cell: CoarseCell) => boolean): boolean {
    const { cx0, cx1, cy0, cy1 } = boxCellRange(hx, hy, radius);
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cy = cy0; cy <= cy1; cy++) {
        const cell = this.grid.cellAt(cx, cy);
        if (cell !== undefined && test(cell)) return true;
      }
    }
    return false;
  }
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
    if (n === scan.keys.length) {
      const grown = new Float64Array(scan.keys.length * 2);
      grown.set(scan.keys);
      scan.keys = grown;
    }
    scan.keys[n++] = distance * CANDIDATE_ID_SPAN + (members[i] ?? 0);
  }
  return n;
}

/** Whether `accept` takes a member of `list` that {@link appendBand} would key for the same band. */
function anyInBand(
  list: MemberList,
  fromX: number,
  fromY: number,
  minDist: number,
  maxDist: number,
  hostile: number,
  metric: SearchMetric,
  accept: (e: Entity) => boolean,
): boolean {
  const { members, x, y, bit } = list;
  for (let i = 0; i < list.count; i++) {
    const memberBit = bit[i] ?? 0;
    if (memberBit !== 0 && (memberBit & hostile) === 0) continue;
    const mx = x[i] ?? 0;
    const my = y[i] ?? 0;
    const distance =
      metric === 'hex'
        ? hexDistanceBetween(fromX, fromY, mx, my)
        : Math.abs(mx - fromX) + Math.abs(my - fromY);
    const member = members[i];
    if (member !== undefined && distance >= minDist && distance <= maxDist && accept(member)) return true;
  }
  return false;
}

/** Push to `keys` every member of `list` owned by `bit` within `maxDist` of (fromX, fromY). */
function appendOwned(
  keys: number[],
  list: MemberList,
  bit: number,
  fromX: number,
  fromY: number,
  maxDist: number,
  metric: SearchMetric,
): void {
  for (let i = 0; i < list.count; i++) {
    if (list.bit[i] !== bit) continue;
    const mx = list.x[i] ?? 0;
    const my = list.y[i] ?? 0;
    const distance =
      metric === 'hex'
        ? hexDistanceBetween(fromX, fromY, mx, my)
        : Math.abs(mx - fromX) + Math.abs(my - fromY);
    if (distance <= maxDist) keys.push(distance * CANDIDATE_ID_SPAN + (list.members[i] ?? 0));
  }
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

/** The last epoch before a scan's member marks are cleared and counting restarts. */
const MAX_MET_EPOCH = 0xffffffff;

/** Start a query's member marks on `scan`. */
function beginMeetings(scan: BandScan): void {
  if (scan.metEpoch === MAX_MET_EPOCH) {
    scan.met.fill(0);
    scan.metEpoch = 0;
  }
  scan.metEpoch++;
}

/** Whether the running query over `scan` meets `e` for the first time, marking it met. */
function firstMeeting(scan: BandScan, e: Entity): boolean {
  if (e >= scan.met.length) {
    const grown = new Uint32Array(Math.max(e + 1, 2 * scan.met.length));
    grown.set(scan.met);
    scan.met = grown;
  }
  if (scan.met[e] === scan.metEpoch) return false;
  scan.met[e] = scan.metEpoch;
  return true;
}
