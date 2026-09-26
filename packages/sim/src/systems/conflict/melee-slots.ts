import { Engagement, MoveGoal } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { BlockOverlay } from '../../nav/block-overlay.js';
import { forEachRingNode } from '../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { dynamicBlockOverlay } from '../footprint/index.js';
import { standingFighterPosts } from '../movement/collision/index.js';
import { hexNodeDistance } from '../spatial/metric.js';

/** A weapon's reach band in map points ({@link hexNodeDistance}). Original behavior: a target is in reach
 *  when its map-point distance lies within `[minRange, maxRange]`. */
export interface WeaponBand {
  readonly minRange: number;
  readonly maxRange: number;
}

/** Visit every node within `band` of `centre`, nearest ring first, until `visit` answers false; answers
 *  whether the walk finished. Costs the band's area, about three times `maxRange` squared. */
export function forEachNodeInBand(
  terrain: TerrainGraph,
  centre: NodeId,
  band: WeaponBand,
  visit: (cell: NodeId) => boolean,
): boolean {
  const at = { hx: terrain.xOf(centre), hy: terrain.yOf(centre) };
  const onNode = (hx: number, hy: number): boolean => visit(terrain.nodeAt(hx, hy));
  for (let ring = band.minRange; ring <= band.maxRange; ring++) {
    if (!forEachRingNode(at, ring, terrain.width, terrain.height, onNode)) return false;
  }
  return true;
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
  /** Goals en-route chasers already own: a slot dealt in an earlier tick stays taken while its owner is
   *  still walking to it, else two chasers dealt across ticks converge on one cell and stack. */
  private enRoute?: ReadonlySet<NodeId>;
  /** The cells dealt this tick, each with the side it was dealt to. */
  private readonly claimed = new Map<NodeId, Side>();
  private blocked?: BlockOverlay;
  /** Encircle candidates per building and weapon band: a building never moves within a tick, so the band
   *  scan runs once and every chaser only filters taken slots over it. */
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
   * How many of `side`'s own bodies already stand at a unit on `node`, or were dealt a cell there this
   * tick, within `band` of it (the cells a weapon of that band strikes it from), `except` (the asker's own
   * node) not counted; and whether the band is `sealed`, no cell of it left to step onto. The enemy's own
   * neighbours are no crowd: they take sides away, which `sealed` and the slot deal answer, but a man at the
   * edge of his own line is not a pile for standing beside his friends.
   */
  crowdingAround(node: NodeId, band: WeaponBand, side: Side, except?: NodeId): Crowding {
    this.standing ??= standingFighterPosts(this.world, this.ctx.content, this.terrain);
    const standing = this.standing;
    let occupied = 0;
    let open = 0;
    forEachNodeInBand(this.terrain, node, band, (cell) => {
      if (cell === except) return true;
      const body = standing.get(cell);
      const dealt = this.claimed.get(cell);
      if (body === undefined && dealt === undefined) {
        if (this.terrain.isWalkable(cell)) open++;
      } else if (body === side || dealt === side) {
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
   * (reach 0) is never dealt.
   */
  encircleCandidates(target: Entity, body: readonly NodeId[] | null, weapon: WeaponBand): readonly NodeId[] {
    const key = `${target}:${weapon.minRange}:${weapon.maxRange}`;
    const cached = this.bands.get(key);
    if (cached !== undefined) return cached;
    const candidates = this.buildBand(body ?? [], weapon);
    this.bands.set(key, candidates);
    return candidates;
  }

  /** The uncached band scan behind {@link encircleCandidates} - O(bandCells × body). */
  private buildBand(body: readonly NodeId[], weapon: WeaponBand): readonly NodeId[] {
    const visited = new Set<NodeId>();
    const candidates: NodeId[] = [];
    const disc = { minRange: 0, maxRange: weapon.maxRange };
    for (const wall of body) {
      forEachNodeInBand(this.terrain, wall, disc, (cell) => {
        if (visited.has(cell)) return true; // adjacent walls' discs overlap - evaluate each cell once
        visited.add(cell);
        if (!this.isOpen(cell)) return true;
        const reach = distanceToBody(this.terrain, cell, body);
        // Reach is to the NEAREST wall.
        if (reach >= weapon.minRange && reach <= weapon.maxRange) candidates.push(cell);
        return true;
      });
    }
    return candidates;
  }
}

/** The chase destinations en-route chasers already own. Membership-only, so query order carries no
 *  decision; conservatively stale within the tick, which only delays a slot's reuse by one tick. */
function enRouteChaseGoals(world: World): ReadonlySet<NodeId> {
  const out = new Set<NodeId>();
  for (const e of world.query(Engagement, MoveGoal)) out.add(world.get(e, MoveGoal).cell);
  return out;
}

/** Map-point distance from `cell` to the nearest cell of `body` - how the combat reach to a building is
 *  measured. */
function distanceToBody(terrain: TerrainGraph, cell: NodeId, body: readonly NodeId[]): number {
  let min = Number.POSITIVE_INFINITY;
  for (const wall of body) min = Math.min(min, hexNodeDistance(terrain, cell, wall));
  return min;
}
