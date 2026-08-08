import { Engagement, MoveGoal } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { BlockOverlay } from '../../nav/block-overlay.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { dynamicBlockOverlay } from '../footprint/index.js';
import { standingFighterNodes } from '../movement/collision/index.js';
import { manhattan } from '../spatial/metric.js';

/** A weapon's contact band in half-cell-node Manhattan distance. */
export interface WeaponBand {
  readonly minRange: number;
  readonly maxRange: number;
}

/**
 * One combat tick's melee-slot bookkeeping: which contact cells are spoken for, and the derived views that
 * answer it. Chasers are served in the canonical combatant order, so the deal is deterministic; every view
 * is per-tick derived state, never hashed, and the world scans run on first ask.
 */
export class MeleeSlots {
  private standing?: ReadonlySet<NodeId>;
  /** Goals en-route chasers already own: a slot dealt in an earlier tick stays taken while its owner is
   *  still walking to it, else two chasers dealt across ticks converge on one cell and stack. */
  private enRoute?: ReadonlySet<NodeId>;
  private readonly claimed = new Set<NodeId>();
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
   *  chaser's live goal. `ownGoal` is the asker's own goal, which is not taken to itself - a cadence
   *  repath may re-choose and keep it. */
  isTaken(cell: NodeId, ownGoal: NodeId | undefined): boolean {
    this.standing ??= standingFighterNodes(this.world, this.ctx.content, this.terrain);
    if (this.standing.has(cell) || this.claimed.has(cell)) return true;
    this.enRoute ??= enRouteChaseGoals(this.world);
    return this.enRoute.has(cell) && cell !== ownGoal;
  }

  /** Whether `cell` is ground a route can actually deliver to. A cell under another building's body or a
   *  resource is statically walkable but unroutable, and routing denies a stand-in for a dynamically
   *  blocked goal - dealing one would fail the route and cancel an ordered unit's whole attack order. */
  isOpen(cell: NodeId): boolean {
    if (!this.terrain.isWalkable(cell)) return false;
    this.blocked ??= dynamicBlockOverlay(this.world, this.ctx, this.terrain);
    return !this.blocked.has(cell);
  }

  /** Deal `cell` to the asking chaser - the tick's later chasers aim at the next free one. */
  claim(cell: NodeId): void {
    this.claimed.add(cell);
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
    for (const wall of body) {
      const t = this.terrain.coordsOf(wall);
      for (let dy = -weapon.maxRange; dy <= weapon.maxRange; dy++) {
        for (let dx = -weapon.maxRange; dx <= weapon.maxRange; dx++) {
          if (Math.abs(dx) + Math.abs(dy) > weapon.maxRange) continue;
          const x = t.x + dx;
          const y = t.y + dy;
          if (!this.terrain.inBounds(x, y)) continue;
          const cell = this.terrain.nodeAt(x, y);
          if (visited.has(cell)) continue; // adjacent walls' band boxes overlap - evaluate each cell once
          visited.add(cell);
          if (!this.isOpen(cell)) continue;
          const reach = distanceToBody(this.terrain, cell, body);
          if (reach < weapon.minRange || reach > weapon.maxRange) continue; // reach is to the NEAREST wall
          candidates.push(cell);
        }
      }
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

/** Manhattan distance from `cell` to the nearest cell of `body` - how the combat reach to a building is
 *  measured. */
function distanceToBody(terrain: TerrainGraph, cell: NodeId, body: readonly NodeId[]): number {
  let min = Number.POSITIVE_INFINITY;
  for (const wall of body) min = Math.min(min, manhattan(terrain, cell, wall));
  return min;
}
