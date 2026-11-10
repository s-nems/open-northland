import {
  AttackOrder,
  Engagement,
  MoveGoal,
  Owner,
  PathFollow,
  PathRoute,
  PlayerOrder,
} from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { BlockOverlay } from '../../nav/block-overlay.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { dynamicBlockOverlay } from '../footprint/index.js';
import { routeStructureBlocks } from '../movement/attack-move-blocks.js';
import { standingFighterPosts } from '../movement/collision/index.js';
import { liveStepEnd, stopAtNextNode } from '../movement/nav-state.js';
import { structureSameRegion, structureStandable } from '../movement/structure-route.js';
import { hexNodeDistance } from '../spatial/metric.js';
import { entityNode } from '../spatial/nodes.js';
import { encircleBands } from './encircle-bands.js';
import { forEachNodeInBand, type WeaponBand } from './weapon-band.js';

/** Shared so a body-less target allocates nothing. */
const NO_CELLS: readonly NodeId[] = [];

/** The cells a chaser already holds for itself: its live goal and the node it stands on. */
export interface OwnClaims {
  readonly goal: NodeId | undefined;
  readonly standingOn: NodeId | undefined;
  readonly chaser?: SlotChaser;
}

export interface SlotChaser {
  readonly entity: Entity;
  readonly target: Entity;
}

interface Reservation {
  entity: Entity;
  target: Entity | undefined;
  side: Side;
  shared: boolean;
  /** The {@link ChaseGoals} round that filled this entry; it counts in that round alone. */
  round: number;
}

/** {@link MeleeSlots.crowdingAround}: `occupied` cells of the band held by the asker's own side, and
 *  `sealed` when no cell of it is left to step onto. */
export interface Crowding {
  readonly occupied: number;
  readonly sealed: boolean;
}

/** A side that claims a cell: a player, or null for an unowned combatant such as a hostile animal. */
export type Side = number | null;

/** The first rank still open to the askers standing on one bank; `anchor` is the first such asker's node,
 *  or null for askers off structural ground. */
interface BankRanks {
  readonly anchor: NodeId | null;
  firstOpen: number;
}

interface WaitingRanks {
  readonly rows: Map<number, NodeId[]>;
  readonly banks: BankRanks[];
}

/**
 * One combat tick's melee-slot bookkeeping: which contact cells are spoken for, and the derived views that
 * answer it. Chasers are served in the canonical combatant order, so the deal is deterministic; every view
 * is per-tick derived state, never hashed, and the world scans run on first ask.
 */
export class MeleeSlots {
  /** The standing bodies by node, each with its player. */
  private standing?: ReadonlyMap<NodeId, number>;
  /** Reservations from earlier ticks; a closer ally may take a front slot before its owner arrives. */
  private enRoute?: ChaseGoals | undefined;
  private readonly claimants = new Map<NodeId, SlotChaser>();
  /** The cells dealt this tick, each with the side it was dealt to. */
  private readonly claimed = new Map<NodeId, Side>();
  private blocked?: BlockOverlay;
  private readonly marchBlocks = new Map<number, BlockOverlay>();
  /** The tick's open encircle candidates per target and weapon band, so every chaser only filters taken
   *  slots over them. */
  private readonly bands = new Map<string, readonly NodeId[]>();
  private readonly waiting = new Map<string, WaitingRanks>();

  constructor(
    private readonly world: World,
    private readonly ctx: SystemContext,
    private readonly terrain: TerrainGraph,
  ) {}

  /** Whether `cell` is already spoken for: a standing body, a cell dealt earlier this tick, or another
   *  chaser's live goal. `ownGoal` is the asker's own goal and `standingOn` the node it stands on, neither
   *  taken to itself - a cadence repath may re-choose and keep either. */
  isTaken(cell: NodeId, ownGoal: NodeId | undefined, standingOn?: NodeId, chaser?: SlotChaser): boolean {
    this.standing ??= standingFighterPosts(this.world, this.ctx.content, this.terrain);
    if (this.standing.has(cell) && cell !== standingOn) return true;
    if (this.claimed.has(cell)) return !this.canYield(cell, chaser);
    this.enRoute ??= takeChaseGoals(this.world);
    return this.enRoute.get(cell) !== undefined && cell !== ownGoal && !this.canYield(cell, chaser);
  }

  /** Hand the pass's reservation table back for the world's next pass; the slots answer nothing after. */
  release(): void {
    if (this.enRoute !== undefined) heldChaseGoals.set(this.world, this.enRoute);
    this.enRoute = undefined;
  }

  /** Friendly destinations stay distinct when braking; opposing chasers can still meet head-on. */
  canStop(cell: NodeId, ownGoal: NodeId | undefined, chaser: SlotChaser): boolean {
    if (this.isOccupied(cell)) return false;
    this.enRoute ??= takeChaseGoals(this.world);
    const side = this.world.tryGet(chaser.entity, Owner)?.player;
    if (cell !== ownGoal && this.enRoute.get(cell)?.shared === true) return false;
    return (
      side === undefined ||
      this.enRoute.get(cell)?.side !== side ||
      !this.isTaken(cell, ownGoal, undefined, chaser)
    );
  }

  /** Whether a body stands on `cell` or it was dealt earlier this tick: {@link isTaken} without the goals of
   *  chasers still walking, for a walker that is on the spot before them. */
  isOccupied(cell: NodeId): boolean {
    this.standing ??= standingFighterPosts(this.world, this.ctx.content, this.terrain);
    return this.standing.has(cell) || this.claimed.has(cell);
  }

  /**
   * How many of `side`'s own bodies already stand at a unit on `node`, were dealt a cell there this tick,
   * or are walking to one, within `band` of it (the cells a weapon of that band strikes it from), the
   * asker's own node and goal not counted; and whether the band is `sealed`: no cell of it the slot deal
   * would still hand out, the asker's own node counting as free. The enemy's own neighbours are no crowd:
   * they take sides away, which `sealed` and the slot deal answer, but a man at the edge of his own line
   * is not a pile for standing beside his friends.
   */
  crowdingAround(node: NodeId, band: WeaponBand, side: Side, mine: OwnClaims): Crowding {
    this.standing ??= standingFighterPosts(this.world, this.ctx.content, this.terrain);
    this.enRoute ??= takeChaseGoals(this.world);
    const { standing, enRoute } = this;
    let occupied = 0;
    let open = 0;
    forEachNodeInBand(this.terrain, node, band, (cell) => {
      if (cell === mine.standingOn) {
        if (this.isOpen(cell)) open++;
        return true;
      }
      const body = standing.get(cell);
      const dealt = this.claimed.get(cell);
      const walking = cell === mine.goal ? undefined : enRoute.get(cell)?.side;
      if (body === undefined && dealt === undefined && walking === undefined) {
        if (this.isOpen(cell)) open++;
      } else if (body === side || dealt === side || walking === side) {
        occupied++;
      }
      return true;
    });
    return { occupied, sealed: open === 0 };
  }

  /** Whether `cell` is ground a route can actually deliver to. A cell under another building's body or a
   *  resource is statically walkable but unroutable, and routing denies a stand-in for a dynamically
   *  blocked goal - dealing one would fail the route and cancel an ordered unit's whole attack order. */
  isOpen(cell: NodeId): boolean {
    if (!this.terrain.isWalkable(cell)) return false;
    this.blocked ??= dynamicBlockOverlay(this.world, this.ctx, this.terrain);
    return !this.blocked.has(cell);
  }

  /** Deal `cell` to the asking chaser of `side` - the tick's later chasers aim at the next free one. */
  claim(cell: NodeId, side: Side, chaser?: SlotChaser): void {
    const prior = this.claimants.get(cell) ?? this.enRoute?.get(cell);
    if (prior !== undefined && this.canYield(cell, chaser)) {
      stopAtNextNode(this.world, prior.entity);
      const engagement = this.world.tryMut(prior.entity, Engagement);
      if (engagement !== undefined) engagement.repathAt = this.ctx.tick;
      const order = this.world.tryMut(prior.entity, AttackOrder);
      if (order?.breach?.stand === cell) order.breach.stand = null;
      this.enRoute?.drop(cell);
    }
    this.claimed.set(cell, side);
    if (chaser !== undefined) this.claimants.set(cell, chaser);
    else this.claimants.delete(cell);
  }

  /** A reservation is a destination, not a body. A nearer ally fighting the same target may take it;
   * equal distances preserve the incumbent, so a moving front does not shuffle on ties. */
  private canYield(cell: NodeId, chaser: SlotChaser | undefined): boolean {
    if (chaser === undefined || (this.claimed.has(cell) && !this.claimants.has(cell))) return false;
    const prior = this.claimants.get(cell) ?? this.enRoute?.get(cell);
    if (prior === undefined || prior.entity === chaser.entity || prior.target !== chaser.target) return false;
    if (this.enRoute?.get(cell)?.shared === true) return false;
    const side = this.world.tryGet(chaser.entity, Owner)?.player;
    if (side === undefined || this.world.tryGet(prior.entity, Owner)?.player !== side) return false;
    if (this.world.tryGet(prior.entity, MoveGoal)?.cell !== cell) return false;
    const target =
      this.world.tryGet(prior.entity, Engagement)?.target ??
      this.world.tryGet(prior.entity, AttackOrder)?.target;
    if (target !== chaser.target) return false;
    const here = entityNode(this.world, this.terrain, chaser.entity);
    const there = entityNode(this.world, this.terrain, prior.entity);
    const follow = this.world.tryGet(prior.entity, PathFollow);
    const route = this.world.tryGet(prior.entity, PathRoute)?.waypoints;
    if (follow !== undefined && route !== undefined) {
      const end = liveStepEnd(follow.index, route);
      if (end !== undefined && route[end]?.node === cell) return false;
    }
    const remaining = hexNodeDistance(this.terrain, there, cell);
    if (remaining <= 1 || hexNodeDistance(this.terrain, here, cell) >= remaining) return false;
    return this.sameBank(here, cell, chaser.entity);
  }

  /** Whether `cell` lies on the connected ground `here` stands on, around the structures `chaser` routes
   *  by; bodies only reserve individual slots. */
  sameBank(here: NodeId, cell: NodeId, chaser?: Entity): boolean {
    return structureSameRegion(this.world, this.ctx, this.terrain, here, cell, this.structuresFor(chaser));
  }

  /** Whether `here` is structural ground at all, so {@link sameBank} can hold from it. */
  hasBank(here: NodeId, chaser?: Entity): boolean {
    return structureStandable(this.world, this.ctx, this.terrain, here, this.structuresFor(chaser));
  }

  /** A marching chaser plans around its enemies' gates; any other routes by the walk block alone. */
  private structuresFor(chaser: Entity | undefined): BlockOverlay | undefined {
    const player =
      chaser !== undefined && this.world.tryGet(chaser, PlayerOrder)?.attackMove !== undefined
        ? this.world.tryGet(chaser, Owner)?.player
        : undefined;
    if (player === undefined) return undefined;
    let blocked = this.marchBlocks.get(player);
    if (blocked === undefined) {
      blocked = routeStructureBlocks(this.world, this.ctx, this.terrain, chaser);
      this.marchBlocks.set(player, blocked);
    }
    return blocked;
  }

  /** Owner rule: fill successive ranks behind a full front. Full rows are skipped collectively for
   * this pass; each asker's own standing cell and reserved goal remain eligible even in a full row. */
  waitingCell(
    here: NodeId,
    target: { readonly entity: Entity; readonly node: NodeId; readonly body: readonly NodeId[] | null },
    weapon: WeaponBand,
    mine: OwnClaims,
  ): NodeId {
    const chaser = mine.chaser?.entity;
    const marching = chaser !== undefined && this.world.tryGet(chaser, PlayerOrder)?.attackMove !== undefined;
    const side = marching ? this.world.tryGet(chaser, Owner)?.player : undefined;
    const key = `${target.entity}:${weapon.maxRange}:${side}`;
    let ranks = this.waiting.get(key);
    if (ranks === undefined) {
      ranks = { rows: new Map(), banks: [] };
      this.waiting.set(key, ranks);
    }
    const terrain = this.terrain;
    const body = target.body !== null && target.body.length > 0 ? target.body : [target.node];
    const reach = (cell: NodeId): number => {
      let distance = Number.POSITIVE_INFINITY;
      for (const wall of body) distance = Math.min(distance, hexNodeDistance(terrain, cell, wall));
      return distance;
    };
    const distance = reach(here);
    const banked = this.hasBank(here, chaser);
    const onBank = (cell: NodeId): boolean => !banked || this.sameBank(here, cell, chaser);
    const bank = this.bankRanks(ranks, here, banked, chaser, weapon.maxRange + 1);
    const own = [mine.goal, mine.standingOn].filter((cell): cell is NodeId => cell !== undefined);
    const ownRanks = own.map(reach);
    // The ranks walked out to: the asker's own, and its reserved goal's where that lies deeper, since a
    // route to a deeper rank may pass through nearer ranks and must not drop the goal on the way.
    const outermost = Math.max(distance, ...ownRanks);
    let firstOpen = bank.firstOpen;
    const nextRank = (start: number): number => {
      let next = Math.max(start, firstOpen);
      for (const rank of ownRanks) if (rank >= start) next = Math.min(next, rank);
      return next;
    };
    for (let radius = nextRank(weapon.maxRange + 1); radius <= outermost; radius = nextRank(radius + 1)) {
      let row = ranks.rows.get(radius);
      if (row === undefined) {
        row = [...this.encircleCandidates(target.entity, body, { minRange: radius, maxRange: radius })];
        ranks.rows.set(radius, row);
      }
      let best: NodeId | undefined;
      let bestDistance = Number.POSITIVE_INFINITY;
      const consider = (cell: NodeId): void => {
        const dist = hexNodeDistance(terrain, here, cell);
        if (dist < bestDistance || (dist === bestDistance && (best === undefined || cell < best))) {
          best = cell;
          bestDistance = dist;
        }
      };
      // Claims only grow during a pass. Prune once for all later askers, preserving the two own-cell
      // exceptions separately rather than leaving every occupied cell in every soldier's search.
      let kept = 0;
      let openOnBank = false;
      for (const cell of row) {
        if (this.isTaken(cell, undefined)) continue;
        row[kept++] = cell;
        if (!onBank(cell)) continue;
        openOnBank = true;
        consider(cell);
      }
      row.length = kept;
      if (!openOnBank && radius >= firstOpen) {
        firstOpen = radius + 1;
        bank.firstOpen = firstOpen;
      }
      for (let i = 0; i < own.length; i++) {
        const cell = own[i] as NodeId;
        if (
          ownRanks[i] === radius &&
          onBank(cell) &&
          this.isOpen(cell) &&
          !this.isTaken(cell, mine.goal, mine.standingOn)
        ) {
          // Keep a live destination within this rank; choosing another equally deep slot each cadence
          // can turn a detour around a crowded building back on itself indefinitely.
          if (cell === mine.goal) return cell;
          consider(cell);
        }
      }
      if (best !== undefined) return best;
    }
    return here;
  }

  /** The ranks of the bank `here` stands on; regions are disjoint, so at most one anchor shares it. */
  private bankRanks(
    ranks: WaitingRanks,
    here: NodeId,
    banked: boolean,
    chaser: Entity | undefined,
    firstOpen: number,
  ): BankRanks {
    for (const bank of ranks.banks) {
      const shared = bank.anchor === null ? !banked : banked && this.sameBank(bank.anchor, here, chaser);
      if (shared) return bank;
    }
    const bank = { anchor: banked ? here : null, firstOpen };
    ranks.banks.push(bank);
    return bank;
  }

  /**
   * The open in-band contact cells around a building: every {@link isOpen} cell whose distance to the body's
   * nearest wall is in the weapon band - the same nearest-wall rule the reach check uses, so a body cell
   * (reach 0) is never dealt. The static band is held across ticks; only the walk block is read per tick.
   */
  encircleCandidates(target: Entity, body: readonly NodeId[] | null, weapon: WeaponBand): readonly NodeId[] {
    const key = `${target}:${weapon.minRange}:${weapon.maxRange}`;
    const cached = this.bands.get(key);
    if (cached !== undefined) return cached;
    const candidates = this.encircleCells(target, body, weapon).filter((cell) => this.isOpen(cell));
    this.bands.set(key, candidates);
    return candidates;
  }

  /** {@link encircleCandidates} before the walk block: the held static band, every cell of it walkable, so
   *  {@link isOpen} tells which of them a candidate list would keep. Shared across ticks; never mutate it. */
  encircleCells(target: Entity, body: readonly NodeId[] | null, weapon: WeaponBand): readonly NodeId[] {
    return encircleBands(this.world, this.terrain).cellsOf(target, body ?? NO_CELLS, weapon);
  }
}

/** How many dead entries per live chaser a {@link ChaseGoals} table holds, past {@link DEAD_GOALS_SLACK},
 *  before a refill starts it over. */
const DEAD_GOALS_PER_CHASER = 4;
const DEAD_GOALS_SLACK = 64;

/**
 * The live chase goals by cell. Multiple live routes to one cell cannot be transferred as one reservation:
 * the first canonical owner is retained for crowding and the cell marked shared, so a claimant never leaves
 * a second route live. A table outlives its pass and the next refills its entries in place, so only the
 * entries of the current round count and no reader may walk the table.
 */
class ChaseGoals {
  private readonly byCell = new Map<NodeId, Reservation>();
  private round = 0;

  refill(world: World): this {
    const chasers = world.canonicalQuery(Engagement, MoveGoal);
    if (this.byCell.size > DEAD_GOALS_PER_CHASER * chasers.length + DEAD_GOALS_SLACK) this.byCell.clear();
    const round = ++this.round;
    for (let i = 0; i < chasers.length; i++) {
      const e = chasers[i] as Entity;
      const cell = world.get(e, MoveGoal).cell;
      const prior = this.byCell.get(cell);
      if (prior !== undefined && prior.round === round) {
        prior.shared = true;
        continue;
      }
      const target = world.get(e, Engagement).target ?? world.tryGet(e, AttackOrder)?.target;
      const side = world.tryGet(e, Owner)?.player ?? null;
      if (prior === undefined) {
        this.byCell.set(cell, { entity: e, target, side, shared: false, round });
      } else {
        prior.entity = e;
        prior.target = target;
        prior.side = side;
        prior.shared = false;
        prior.round = round;
      }
    }
    return this;
  }

  get(cell: NodeId): Reservation | undefined {
    const held = this.byCell.get(cell);
    return held !== undefined && held.round === this.round ? held : undefined;
  }

  drop(cell: NodeId): void {
    const held = this.byCell.get(cell);
    if (held !== undefined) held.round = 0;
  }
}

/** Each world's table between two passes: the one {@link MeleeSlots.release} handed back. */
const heldChaseGoals = new WeakMap<World, ChaseGoals>();

/** The world's live chase goals, in the table its last pass released when there is one. */
function takeChaseGoals(world: World): ChaseGoals {
  const held = heldChaseGoals.get(world);
  if (held === undefined) return new ChaseGoals().refill(world);
  heldChaseGoals.delete(world);
  return held.refill(world);
}
