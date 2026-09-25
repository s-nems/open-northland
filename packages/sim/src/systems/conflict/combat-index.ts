import type { ContentSet } from '@open-northland/data';
import {
  Anger,
  diplomacyStance,
  Health,
  isValidPlayer,
  MAX_PLAYERS,
  Owner,
  Position,
  Settler,
  Vehicle,
} from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { vehicleFootprintNodes } from '../footprint/index.js';
import { isAggressiveAnimal, isAnimalTribe, isHuntablePrey, isLastResortPrey } from '../readviews/index.js';
import { entityNode } from '../spatial/nodes.js';
import {
  type BandScan,
  type CoarseCell,
  type CombatGrid,
  coarseOf,
  combatGridOf,
  playerBit,
  type WildClass,
} from './combat-grid.js';
import { firingBuildings } from './targeting.js';
import { vehicleWeapon } from './weapons.js';

/** A candidate packs as `distance * CANDIDATE_ID_SPAN + entity`, so a numeric sort orders by distance and then
 *  id. Entity ids stay below 2^32 and distances below 2^21, so the key is an exact double. */
const CANDIDATE_ID_SPAN = 2 ** 32;

/** A player-slot bitmask naming every slot: players are < {@link MAX_PLAYERS}, which fits one integer. */
const EVERY_PLAYER = (1 << MAX_PLAYERS) - 1;

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

/**
 * The combat tick's target index over every combatant, every vehicle and every building with a Health pool,
 * a felled one included until cleanup reaps it: the coarse cells of the world's {@link CombatGrid}, each holding its
 * early-out tallies and its members. The buildings are the grid's held layer and the combatants and vehicles
 * are appended per build, so an index answers until the next one is built for the same world. Derived state, never
 * hashed.
 *
 * The coarse queries over-approximate (Chebyshev box ⊇ Manhattan diamond, cell granularity, and "owned by a
 * player at war with the seeker either way, or unowned and not passive wildlife" ⊇ every gated accept
 * filter), so a `false` proves the nearest search would find nothing; a seeker whose filter breaks that
 * superset is ungated via a null `EngageSpec.player`.
 *
 * A nearest query scans the members of the coarse cells its box overlaps rather than walking every node of
 * every ring: a search band of radius 20 holds 840 nodes but rarely more than a few dozen members. The
 * winner is still the canonical (min distance, then min id) one, because candidates are sorted on exactly
 * that key before `accept` sees them.
 */
export class CombatIndex {
  private readonly grid: CombatGrid;
  private readonly content: ContentSet;
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

  /** `combatants` are the seekers and unit targets. Every building holding a Health pool joins too, at every
   *  wall node, and every vehicle at every node of its disc, so a search finds a body at the distance to its
   *  nearest face. */
  constructor(
    private readonly world: World,
    ctx: SystemContext,
    terrain: TerrainGraph,
    combatants: Iterable<Entity>,
  ) {
    this.content = ctx.content;
    this.tick = ctx.tick;
    this.hostileMasks = hostileMasksOf(world);
    this.grid = combatGridOf(world, ctx, terrain);
    this.grid.startBuild(world, ctx);
    const firing = firingBuildings(world, ctx);
    for (const b of firing) this.grid.admitFiring(b);
    this.firing = firing;
    for (const e of combatants) {
      const node = entityNode(world, terrain, e);
      const owner = world.tryGet(e, Owner);
      const bit = owner === undefined ? 0 : playerBit(owner.player);
      const unowned = owner === undefined ? world.tryGet(e, Settler) : undefined;
      const game =
        unowned !== undefined &&
        isHuntablePrey(ctx.content, unowned.tribe) &&
        !isLastResortPrey(ctx.content, unowned.tribe);
      this.grid.admitUnit(e, terrain.xOf(node), terrain.yOf(node), bit, this.wildClassOf(e, unowned), game);
    }
    // A vehicle moves, so it joins per build rather than in the held building layer.
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
   * The nearest indexed target to node (fromX, fromY) satisfying `accept`, over Manhattan `minDist..maxDist`:
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
  ): { entity: Entity; distance: number } | null {
    const { keys, count } = this.bandScan(fromX, fromY, minDist, maxDist, seeker);
    // A member admitted at several nodes recurs at a larger distance; a rejection holds for all of them.
    const rejected = new Set<Entity>();
    this.depth++;
    try {
      for (let i = 0; i < count; i++) {
        const key = keys[i] ?? 0;
        const distance = Math.floor(key / CANDIDATE_ID_SPAN);
        const entity = (key - distance * CANDIDATE_ID_SPAN) as Entity;
        if (rejected.has(entity)) continue;
        if (accept(entity)) return { entity, distance };
        rejected.add(entity);
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
  ): readonly { entity: Entity; distance: number }[] {
    const { keys, count } = this.bandScan(fromX, fromY, minDist, maxDist, seeker);
    const found: { entity: Entity; distance: number }[] = [];
    const seen = new Set<Entity>();
    let lastRing = maxDist;
    this.depth++;
    try {
      for (let i = 0; i < count && found.length < limit; i++) {
        const key = keys[i] ?? 0;
        const distance = Math.floor(key / CANDIDATE_ID_SPAN);
        if (distance > lastRing) break;
        const entity = (key - distance * CANDIDATE_ID_SPAN) as Entity;
        if (seen.has(entity)) continue;
        seen.add(entity);
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
   * Whether any member `player` might fight or flee from lies within Manhattan `radius` of node (hx, hy): one
   * owned by a player holding `enemy` toward or from it, or an unowned one other than passive wildlife.
   * `false` is a proof of absence; `true` only means "run the real search".
   */
  othersWithin(player: number, hx: number, hy: number, radius: number): boolean {
    const hostile = this.hostileMaskOf(player);
    return this.someCell(hx, hy, radius, (cell) => cell.undiscounted > 0 || (cell.ownerMask & hostile) !== 0);
  }

  /**
   * Whether anything `player` might flee from lies within Manhattan `radius` of node (hx, hy): the
   * {@link othersWithin} test over units and {@link firing} buildings only, since a plain building is no
   * flee threat. `false` is a proof of absence; `true` only means "run the real search".
   */
  threatsWithin(player: number, hx: number, hy: number, radius: number): boolean {
    const hostile = this.hostileMaskOf(player);
    return this.someCell(
      hx,
      hy,
      radius,
      (cell) => cell.threatUndiscounted > 0 || (cell.threatMask & hostile) !== 0,
    );
  }

  /**
   * Whether any civilization combatant - everything not classified wildlife - might lie within Manhattan
   * `radius` of node (hx, hy). The hostile-animal seeker's early-out twin of {@link othersWithin}, since a
   * wild animal's only valid targets are civilization settlers.
   */
  civsWithin(hx: number, hy: number, radius: number): boolean {
    return this.someCell(hx, hy, radius, (cell) => cell.total - cell.passive - cell.hostileAnimal > 0);
  }

  /**
   * Whether any unowned member of a huntable tribe that is not last-resort prey might lie within Manhattan
   * `radius` of node (hx, hy). Every hunter's primary-tier target is one, so `false` proves that tier's
   * search empty.
   */
  gameWithin(hx: number, hy: number, radius: number): boolean {
    return this.someCell(hx, hy, radius, (cell) => cell.game > 0);
  }

  /** Every (member, admitted node) pair within the band as sorted candidate keys, in this depth's scan. A
   *  seeker asks the same band once per target tier, so the second tier reuses the first tier's scan. */
  private bandScan(
    fromX: number,
    fromY: number,
    minDist: number,
    maxDist: number,
    seeker: number | null,
  ): BandScan {
    const scan = this.grid.bandScanAt(this.depth);
    if (
      scan.valid &&
      scan.x === fromX &&
      scan.y === fromY &&
      scan.minDist === minDist &&
      scan.maxDist === maxDist &&
      scan.seeker === seeker
    ) {
      return scan;
    }
    const hostile = seeker === null ? EVERY_PLAYER : this.hostileMaskOf(seeker);
    let keys = scan.keys;
    let count = 0;
    const { cx0, cx1, cy0, cy1 } = boxCellRange(fromX, fromY, maxDist);
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cy = cy0; cy <= cy1; cy++) {
        const cell = this.grid.cellAt(cx, cy);
        if (cell === undefined) continue;
        const { members, memberX, memberY, memberBit } = cell;
        for (let i = 0; i < cell.count; i++) {
          const bit = memberBit[i] ?? 0;
          if (bit !== 0 && (bit & hostile) === 0) continue;
          const distance = Math.abs((memberX[i] ?? 0) - fromX) + Math.abs((memberY[i] ?? 0) - fromY);
          if (distance < minDist || distance > maxDist) continue;
          if (count === keys.length) {
            const grown = new Float64Array(keys.length * 2);
            grown.set(keys);
            keys = grown;
          }
          keys[count++] = distance * CANDIDATE_ID_SPAN + (members[i] ?? 0);
        }
      }
    }
    // A typed array sorts numerically without a comparator call per compare.
    keys.subarray(0, count).sort();
    scan.valid = true;
    scan.x = fromX;
    scan.y = fromY;
    scan.minDist = minDist;
    scan.maxDist = maxDist;
    scan.seeker = seeker;
    scan.count = count;
    scan.keys = keys;
    return scan;
  }

  /**
   * Classify a member by `unowned`, its Settler when it carries no Owner, or null for anything owned or
   * non-animal. `'passive'` is discounted from {@link othersWithin} and `'hostile'` additionally from
   * {@link civsWithin}, so neither a grazing herd nor a wolf pack can defeat every gated seeker's early-out.
   * Pure reads - the lapsed-Anger reap stays with the attacker pass, and it can only grow the passive share
   * within the tick, which leaves the build-time tally conservative.
   */
  private wildClassOf(e: Entity, unowned: { readonly tribe: number } | undefined): WildClass {
    const { world, content } = this;
    if (unowned === undefined || !isAnimalTribe(content, unowned.tribe)) return null;
    if (isAggressiveAnimal(content, unowned.tribe)) return 'hostile';
    const anger = world.tryGet(e, Anger);
    return anger !== undefined && this.tick < anger.until ? 'hostile' : 'passive';
  }

  /** The players `player` may fight or flee from; every slot for a player outside them, whom
   *  {@link diplomacyStance} reads as everyone's enemy. */
  private hostileMaskOf(player: number): number {
    return isValidPlayer(player) ? (this.hostileMasks[player] ?? EVERY_PLAYER) : EVERY_PLAYER;
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

/** Per player slot, the {@link playerBit}s of the other players it holds `enemy` toward or from - the
 *  either-way rule of `isFleeThreat`, which also covers the one-way `isValidTarget`. */
function hostileMasksOf(world: World): number[] {
  const masks: number[] = [];
  for (let p = 0; p < MAX_PLAYERS; p++) {
    let mask = 0;
    for (let q = 0; q < MAX_PLAYERS; q++) {
      if (q === p) continue;
      if (diplomacyStance(world, p, q) === 'enemy' || diplomacyStance(world, q, p) === 'enemy')
        mask |= 1 << q;
    }
    masks.push(mask);
  }
  return masks;
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
