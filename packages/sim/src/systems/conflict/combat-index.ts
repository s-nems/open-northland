import type { ContentSet } from '@open-northland/data';
import {
  Anger,
  diplomacyStance,
  isValidPlayer,
  MAX_PLAYERS,
  Owner,
  Settler,
} from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { isAggressiveAnimal, isAnimalTribe, isLowPriorityBuildingTarget } from '../readviews/index.js';
import { entityNode } from '../spatial/nodes.js';
import { buildingBodyNodes } from './target-node.js';

/** Coarse cell edge (half-cell nodes). A sight- or defend-radius query (≤ ~20 nodes) spans three or four
 *  cells per axis, a box about 2.5× the diamond it scans for; a coarser cell scans more members outside the
 *  band, a finer one walks more cells. Only query cost depends on it, never a winner. */
const COARSE_CELL_NODES = 16;

/**
 * How many rings past the first hit {@link CombatIndex.nearestFew} keeps taking. Without it a band holding
 * fewer acceptors than the caller asked for costs every candidate out to `maxDist`. Approximation: three
 * rings is the huddle around the nearest target, so a garrison fans onto enemies beside its closest one
 * rather than onto stragglers half a map behind them.
 */
const NEAREST_FEW_TAIL_RINGS = 3;

/** A candidate packs as `distance * CANDIDATE_ID_SPAN + entity`, so a numeric sort orders by distance and then
 *  id. Entity ids stay below 2^32 and distances below 2^21, so the key is an exact double. */
const CANDIDATE_ID_SPAN = 2 ** 32;

/** A player-slot bitmask naming every slot: players are < {@link MAX_PLAYERS}, which fits one integer. */
const EVERY_PLAYER = (1 << MAX_PLAYERS) - 1;

/** A player's slot bit, or 0 for a player outside the slots. */
function playerBit(player: number): number {
  return isValidPlayer(player) ? 1 << player : 0;
}

/** An unowned animal's presence class, or null for anything owned or non-animal. */
type WildClass = 'passive' | 'hostile' | null;

/** One coarse cell: its early-out tallies and its members with the node each was admitted at. Counts are per
 *  member, not per node - both queries reduce to "does a member of some class exist here?", which no
 *  weighting can change. */
interface CoarseCell {
  total: number;
  passive: number;
  hostileAnimal: number;
  /** Members no diplomacy can discount: unowned ones other than passive wildlife, and any owned outside the
   *  player slots. */
  undiscounted: number;
  /** The {@link playerBit}s of the players owning a member here. */
  ownerMask: number;
  readonly members: Entity[];
  readonly memberX: number[];
  readonly memberY: number[];
  /** The member's owner as a {@link playerBit}, 0 when unowned. */
  readonly memberBit: number[];
  /** The last member tallied, so a building's several nodes in one cell count once. */
  countedLast: Entity | null;
  /** {@link countedLast}'s owner bit, reused for its further nodes. */
  countedLastBit: number;
}

/**
 * The combat tick's target index over every combatant and attackable building: a grid of coarse cells, each
 * holding its early-out tallies and its members. Derived state, rebuilt each tick and never hashed.
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
  /** Coarse column → row → cell; nested numeric maps keep negative/off-map nodes collision-free. */
  private readonly byCx = new Map<number, Map<number, CoarseCell>>();
  private readonly content: ContentSet;
  private readonly tick: number;
  private readonly ctx: SystemContext;
  /** Members on the deprioritized siege tier, classified once at build: a building's class cannot change
   *  within the tick the index lives. */
  private readonly lowPriority = new Set<Entity>();
  /** Per player slot, the {@link playerBit}s of the players it holds `enemy` toward or from, resolved once at
   *  build: every stance writer ahead of `combat` in the tick schedule has run by then and none runs inside
   *  it, so a stance flipped earlier this tick is already seen. */
  private readonly hostileMasks: readonly number[];
  /** The last band's sorted candidates: a seeker asks the same band once per target tier, so the second
   *  tier reuses the first tier's scan. A nested query with another band simply rebuilds it. */
  private lastBand: {
    x: number;
    y: number;
    minDist: number;
    maxDist: number;
    seeker: number | null;
    keys: Float64Array;
  } | null = null;

  /** `combatants` are the seekers and unit targets, `buildings` the live attackable structures; a building
   *  joins at every wall node, so a search finds it at the distance to its nearest face. */
  constructor(
    private readonly world: World,
    ctx: SystemContext,
    private readonly terrain: TerrainGraph,
    combatants: Iterable<Entity>,
    buildings: Iterable<Entity>,
  ) {
    this.content = ctx.content;
    this.tick = ctx.tick;
    this.ctx = ctx;
    this.hostileMasks = hostileMasksOf(world);
    for (const e of combatants) this.admit(e, entityNode(world, terrain, e));
    for (const b of buildings) {
      for (const node of buildingBodyNodes(world, ctx, terrain, b)) this.admit(b, node);
    }
  }

  /** Whether member `e` is a plain building - the siege tier a warrior turns on only when nothing better is
   *  in sight. False for a settler, a headquarters, a tower and anything not indexed. */
  isLowPriorityBuilding(e: Entity): boolean {
    return this.lowPriority.has(e);
  }

  /**
   * The nearest indexed target to node (fromX, fromY) satisfying `accept`, over Manhattan `minDist..maxDist`:
   * the min-distance, then min-id acceptor, `accept` asked in that order and stopped at the first yes.
   * `accept` must be total and pure over any indexed entity: a rejection is remembered for the call.
   * Members owned by `seeker` or by a player at peace with it both ways are never offered: every gated
   * target filter rejects them, so skipping them here saves the filter's reads without changing the winner.
   * `accept` may re-enter this method: all search state is call-local.
   */
  nearest(
    fromX: number,
    fromY: number,
    minDist: number,
    maxDist: number,
    accept: (e: Entity) => boolean,
    seeker: number | null,
  ): { entity: Entity; distance: number } | null {
    const candidates = this.candidatesInBand(fromX, fromY, minDist, maxDist, seeker);
    // A member admitted at several nodes recurs at a larger distance; a rejection holds for all of them.
    const rejected = new Set<Entity>();
    for (let i = 0; i < candidates.length; i++) {
      const key = candidates[i] ?? 0;
      const distance = Math.floor(key / CANDIDATE_ID_SPAN);
      const entity = (key - distance * CANDIDATE_ID_SPAN) as Entity;
      if (rejected.has(entity)) continue;
      if (accept(entity)) return { entity, distance };
      rejected.add(entity);
    }
    return null;
  }

  /**
   * The `limit` nearest indexed targets satisfying `accept`, in the same (distance, then id) order
   * {@link nearest} picks its winner from, so `[0]` is exactly what `nearest` returns. A member indexed at
   * several nodes is listed once, at its nearest, and `accept` is asked once per member, so it must be
   * total and pure over any indexed entity. The take stops at `limit` acceptors, `maxDist`, or
   * {@link NEAREST_FEW_TAIL_RINGS} past the first ring that hit.
   */
  nearestFew(
    fromX: number,
    fromY: number,
    minDist: number,
    maxDist: number,
    accept: (e: Entity) => boolean,
    limit: number,
    seeker: number | null,
  ): readonly { entity: Entity; distance: number }[] {
    const candidates = this.candidatesInBand(fromX, fromY, minDist, maxDist, seeker);
    const found: { entity: Entity; distance: number }[] = [];
    const seen = new Set<Entity>();
    let lastRing = maxDist;
    for (let i = 0; i < candidates.length && found.length < limit; i++) {
      const key = candidates[i] ?? 0;
      const distance = Math.floor(key / CANDIDATE_ID_SPAN);
      if (distance > lastRing) break;
      const entity = (key - distance * CANDIDATE_ID_SPAN) as Entity;
      if (seen.has(entity)) continue;
      seen.add(entity);
      if (!accept(entity)) continue;
      found.push({ entity, distance });
      lastRing = Math.min(lastRing, distance + NEAREST_FEW_TAIL_RINGS);
    }
    return found;
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
   * Whether any civilization combatant - everything not classified wildlife - might lie within Manhattan
   * `radius` of node (hx, hy). The hostile-animal seeker's early-out twin of {@link othersWithin}, since a
   * wild animal's only valid targets are civilization settlers.
   */
  civsWithin(hx: number, hy: number, radius: number): boolean {
    return this.someCell(hx, hy, radius, (cell) => cell.total - cell.passive - cell.hostileAnimal > 0);
  }

  /** Every (member, admitted node) pair within the band, as sorted candidate keys. */
  private candidatesInBand(
    fromX: number,
    fromY: number,
    minDist: number,
    maxDist: number,
    seeker: number | null,
  ): Float64Array {
    const last = this.lastBand;
    if (
      last !== null &&
      last.x === fromX &&
      last.y === fromY &&
      last.minDist === minDist &&
      last.maxDist === maxDist &&
      last.seeker === seeker
    ) {
      return last.keys;
    }
    const hostile = seeker === null ? EVERY_PLAYER : this.hostileMaskOf(seeker);
    const keys: number[] = [];
    const { cx0, cx1, cy0, cy1 } = boxCellRange(fromX, fromY, maxDist);
    for (let cx = cx0; cx <= cx1; cx++) {
      const column = this.byCx.get(cx);
      if (column === undefined) continue;
      for (let cy = cy0; cy <= cy1; cy++) {
        const cell = column.get(cy);
        if (cell === undefined) continue;
        const { members, memberX, memberY, memberBit } = cell;
        for (let i = 0; i < members.length; i++) {
          const bit = memberBit[i] ?? 0;
          if (bit !== 0 && (bit & hostile) === 0) continue;
          const distance = Math.abs((memberX[i] ?? 0) - fromX) + Math.abs((memberY[i] ?? 0) - fromY);
          if (distance < minDist || distance > maxDist) continue;
          keys.push(distance * CANDIDATE_ID_SPAN + (members[i] ?? 0));
        }
      }
    }
    // A typed array sorts numerically without a comparator call per compare.
    const sorted = new Float64Array(keys).sort();
    this.lastBand = { x: fromX, y: fromY, minDist, maxDist, seeker, keys: sorted };
    return sorted;
  }

  /** Tally `e` into node `node`'s coarse cell and hold the pair for the cell's member scan. */
  private admit(e: Entity, node: NodeId): void {
    const x = this.terrain.xOf(node);
    const y = this.terrain.yOf(node);
    const cell = this.cellAt(coarseOf(x), coarseOf(y));
    cell.members.push(e);
    cell.memberX.push(x);
    cell.memberY.push(y);
    if (cell.countedLast === e) {
      cell.memberBit.push(cell.countedLastBit);
      return;
    }
    const owner = this.world.tryGet(e, Owner);
    const bit = owner === undefined ? 0 : playerBit(owner.player);
    cell.memberBit.push(bit);
    cell.countedLast = e;
    cell.countedLastBit = bit;
    cell.total++;
    const wild = this.wildClassOf(e);
    if (wild === 'passive') cell.passive++;
    else if (wild === 'hostile') cell.hostileAnimal++;
    if (bit !== 0) cell.ownerMask |= bit;
    else if (wild !== 'passive') cell.undiscounted++;
    if (isLowPriorityBuildingTarget(this.world, this.ctx, e)) this.lowPriority.add(e);
  }

  /**
   * Classify an unowned animal member: `'passive'` is discounted from {@link othersWithin} and `'hostile'`
   * additionally from {@link civsWithin}, so neither a grazing herd nor a wolf pack can defeat every gated
   * seeker's early-out. Pure reads - the lapsed-Anger reap stays with the attacker pass, and it can only
   * grow the passive share within the tick, which leaves the build-time tally conservative.
   */
  private wildClassOf(e: Entity): WildClass {
    const { world, content } = this;
    if (world.has(e, Owner)) return null;
    const s = world.tryGet(e, Settler);
    if (s === undefined || !isAnimalTribe(content, s.tribe)) return null;
    if (isAggressiveAnimal(content, s.tribe)) return 'hostile';
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
      const column = this.byCx.get(cx);
      if (column === undefined) continue;
      for (let cy = cy0; cy <= cy1; cy++) {
        const cell = column.get(cy);
        if (cell !== undefined && test(cell)) return true;
      }
    }
    return false;
  }

  private cellAt(cx: number, cy: number): CoarseCell {
    let column = this.byCx.get(cx);
    if (column === undefined) {
      column = new Map<number, CoarseCell>();
      this.byCx.set(cx, column);
    }
    let cell = column.get(cy);
    if (cell === undefined) {
      cell = {
        total: 0,
        passive: 0,
        hostileAnimal: 0,
        undiscounted: 0,
        ownerMask: 0,
        members: [],
        memberX: [],
        memberY: [],
        memberBit: [],
        countedLast: null,
        countedLastBit: 0,
      };
      column.set(cy, cell);
    }
    return cell;
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

function coarseOf(node: number): number {
  return Math.floor(node / COARSE_CELL_NODES);
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
