import { Engagement, MoveGoal, Owner } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { BlockOverlay } from '../../nav/block-overlay.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { dynamicBlockOverlay } from '../footprint/index.js';
import { standingFighterPosts } from '../movement/collision/index.js';
import { encircleBands } from './encircle-bands.js';
import { forEachNodeInBand, type WeaponBand } from './weapon-band.js';

/** Shared so a body-less target allocates nothing. */
const NO_CELLS: readonly NodeId[] = [];

/** The cells a chaser already holds for itself: its live goal and the node it stands on. */
export interface OwnClaims {
  readonly goal: NodeId | undefined;
  readonly standingOn: NodeId | undefined;
}

/** {@link MeleeSlots.crowdingAround}: `occupied` cells of the band held by the asker's own side, and
 *  `sealed` when no cell of it is left to step onto. */
export interface Crowding {
  readonly occupied: number;
  readonly sealed: boolean;
}

/** A side that claims a cell: a player, or null for an unowned combatant such as a hostile animal. */
export type Side = number | null;

/**
 * One combat tick's melee-slot bookkeeping: which contact cells are spoken for, and the derived views that
 * answer it. Chasers are served in the canonical combatant order, so the deal is deterministic; every view
 * is per-tick derived state, never hashed, and the world scans run on first ask.
 */
export class MeleeSlots {
  /** The standing bodies by node, each with its player. */
  private standing?: ReadonlyMap<NodeId, number>;
  /** Goals en-route chasers already own, each with the chaser's side: a slot dealt in an earlier tick
   *  stays taken while its owner is still walking to it, else two chasers dealt across ticks converge on
   *  one cell and stack. */
  private enRoute?: ReadonlyMap<NodeId, Side>;
  /** The cells dealt this tick, each with the side it was dealt to. */
  private readonly claimed = new Map<NodeId, Side>();
  private blocked?: BlockOverlay;
  /** The tick's open encircle candidates per target and weapon band, so every chaser only filters taken
   *  slots over them. */
  private readonly bands = new Map<string, readonly NodeId[]>();

  constructor(
    private readonly world: World,
    private readonly ctx: SystemContext,
    private readonly terrain: TerrainGraph,
  ) {}

  /** Whether `cell` is already spoken for: a standing body, a cell dealt earlier this tick, or another
   *  chaser's live goal. `ownGoal` is the asker's own goal and `standingOn` the node it stands on, neither
   *  taken to itself - a cadence repath may re-choose and keep either. */
  isTaken(cell: NodeId, ownGoal: NodeId | undefined, standingOn?: NodeId): boolean {
    this.standing ??= standingFighterPosts(this.world, this.ctx.content, this.terrain);
    if ((this.standing.has(cell) && cell !== standingOn) || this.claimed.has(cell)) return true;
    this.enRoute ??= enRouteChaseGoals(this.world);
    return this.enRoute.has(cell) && cell !== ownGoal;
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
    this.enRoute ??= enRouteChaseGoals(this.world);
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
      const walking = cell === mine.goal ? undefined : enRoute.get(cell);
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
  claim(cell: NodeId, side: Side): void {
    this.claimed.set(cell, side);
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
    const cells = encircleBands(this.world, this.terrain).cellsOf(target, body ?? NO_CELLS, weapon);
    this.blocked ??= dynamicBlockOverlay(this.world, this.ctx, this.terrain);
    const blocked = this.blocked;
    const candidates = cells.filter((cell) => !blocked.has(cell));
    this.bands.set(key, candidates);
    return candidates;
  }
}

/** The chase destinations en-route chasers already own, by the chaser's side. Membership and side only,
 *  so query order carries no decision; conservatively stale within the tick, which only delays a slot's
 *  reuse by one tick. */
function enRouteChaseGoals(world: World): ReadonlyMap<NodeId, Side> {
  const out = new Map<NodeId, Side>();
  for (const e of world.query(Engagement, MoveGoal)) {
    out.set(world.get(e, MoveGoal).cell, world.tryGet(e, Owner)?.player ?? null);
  }
  return out;
}
