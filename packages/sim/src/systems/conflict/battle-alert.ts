import {
  Engagement,
  Health,
  HuntFocus,
  hasMissionBehaviour,
  MISSION_BEHAVIOUR,
  Owner,
  Position,
  Settler,
} from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { nodeHxOfPosition, nodeHyOfPosition } from '../../nav/halfcell.js';
import type { SystemContext } from '../context.js';
import { stanceFights, stanceMode } from '../readviews/index.js';
import { playerSeesEntity } from '../vision/index.js';
import { isValidTarget, SIGHT_RADIUS_NODES } from './targeting.js';

// The battle alert: a unit whose stance fights takes no rest while a fight is on around it, and one asleep
// in the open gets up for one. A fight is on where one of its player's own units is engaged, or where its
// player sees a unit hostile to it that picks fights.

/**
 * How near (Manhattan half-cell nodes) a fight gets a fighting unit asleep in the open back up. Twice the
 * sight radius, so a rear rank stands to while the rank in front fights. Authored: no readable rule keeps
 * a soldier from resting in the middle of a fight.
 */
export const STAND_TO_RADIUS_NODES = 2 * SIGHT_RADIUS_NODES;

/**
 * How far away a fight must be before a fighting unit lies down or leaves for its needs. The margin over
 * {@link STAND_TO_RADIUS_NODES} keeps a sleeper at the edge of a battle from being roused by every step the
 * fight takes. Authored.
 */
export const REST_CLEARANCE_NODES = STAND_TO_RADIUS_NODES + SIGHT_RADIUS_NODES / 2;

/**
 * Whether `t`, a unit not of `player`'s own, threatens `e`: a live settler the player sees that picks fights
 * and is hostile to `e` either way round, one that would strike `e` or one `e` would strike. A building
 * threatens no one.
 */
export function threatens(
  world: World,
  ctx: SystemContext,
  e: Entity,
  player: number,
): (t: Entity) => boolean {
  const self = world.get(e, Settler);
  return (t) => {
    const other = world.tryGet(t, Settler);
    const health = world.tryGet(t, Health);
    if (other === undefined || health === undefined || health.hitpoints <= 0) return false;
    if (!picksFights(world, ctx, t, other.jobType)) return false;
    if (!playerSeesEntity(world, ctx.fog, player, t)) return false;
    return isValidTarget(world, ctx, t, other, e) || isValidTarget(world, ctx, e, self, t);
  };
}

/** An owned unit picks fights by its stance, unless a script holds it passive; an unowned one (wildlife, a
 *  scenario civ) is left to the hostility check, which admits only the aggressive and the provoked. */
function picksFights(world: World, ctx: SystemContext, t: Entity, jobType: number | null): boolean {
  if (hasMissionBehaviour(world, t, MISSION_BEHAVIOUR.PASSIVE)) return false;
  return !world.has(t, Owner) || stanceFights(stanceMode(world, ctx.content, t, jobType));
}

/**
 * The engaged units of one pass, bucketed by owner and coarse cell. Built from the engaged units alone on
 * the first query, which peace leaves all but empty, so a sleeper's question costs the fight near it rather
 * than every fight on the map. A hunt is no fight.
 */
export class EngagedUnits {
  private byOwner: Map<number, CoarseGrid> | null = null;

  constructor(private readonly world: World) {}

  /** Whether one of `player`'s own units within `radius` of node `(hx, hy)` is engaged. */
  near(player: number, hx: number, hy: number, radius: number): boolean {
    return (
      this.ensure()
        .get(player)
        ?.anyWithin(hx, hy, radius, () => true) ?? false
    );
  }

  private ensure(): Map<number, CoarseGrid> {
    if (this.byOwner !== null) return this.byOwner;
    const byOwner = new Map<number, CoarseGrid>();
    for (const t of this.world.query(Engagement, Position, Owner)) {
      if (this.world.has(t, HuntFocus)) continue;
      const owner = this.world.get(t, Owner).player;
      let grid = byOwner.get(owner);
      if (grid === undefined) {
        grid = new CoarseGrid();
        byOwner.set(owner, grid);
      }
      grid.add(this.world, t);
    }
    this.byOwner = byOwner;
    return byOwner;
  }
}

/**
 * The planner pass's view of where fighting is going on: its engaged units, and every live settler that
 * picks fights. Built on the first query, so a tick on which no fighting unit weighs rest pays nothing, and
 * kept for the rest of the pass: the only move inside one is a garrison stepping on or off its tower.
 */
export class ThreatPresence {
  private readonly engaged: EngagedUnits;
  private fighters: CoarseGrid | null = null;

  constructor(
    private readonly world: World,
    private readonly ctx: SystemContext,
  ) {
    this.engaged = new EngagedUnits(world);
  }

  /** Whether a fight is on within {@link REST_CLEARANCE_NODES} of `e`, for `e`'s `player`. */
  fightNear(e: Entity, player: number): boolean {
    const p = this.world.get(e, Position);
    const hx = nodeHxOfPosition(p.x, p.y);
    const hy = nodeHyOfPosition(p.y);
    if (this.engaged.near(player, hx, hy, REST_CLEARANCE_NODES)) return true;
    const hostile = threatens(this.world, this.ctx, e, player);
    return this.ensureFighters().anyWithin(
      hx,
      hy,
      REST_CLEARANCE_NODES,
      (t) => this.world.tryGet(t, Owner)?.player !== player && hostile(t),
    );
  }

  private ensureFighters(): CoarseGrid {
    if (this.fighters !== null) return this.fighters;
    const fighters = new CoarseGrid();
    for (const t of this.world.query(Settler, Health, Position)) {
      if (this.world.get(t, Health).hitpoints <= 0) continue;
      if (picksFights(this.world, this.ctx, t, this.world.get(t, Settler).jobType))
        fighters.add(this.world, t);
    }
    this.fighters = fighters;
    return fighters;
  }
}

interface Member {
  readonly e: Entity;
  readonly hx: number;
  readonly hy: number;
}

/** Positioned entities in coarse cells {@link REST_CLEARANCE_NODES} wide, so a query within that radius
 *  reads the nine cells around its own. */
class CoarseGrid {
  private readonly byCx = new Map<number, Map<number, Member[]>>();

  add(world: World, e: Entity): void {
    const p = world.get(e, Position);
    const hx = nodeHxOfPosition(p.x, p.y);
    const hy = nodeHyOfPosition(p.y);
    let column = this.byCx.get(coarseOf(hx));
    if (column === undefined) {
      column = new Map();
      this.byCx.set(coarseOf(hx), column);
    }
    let cell = column.get(coarseOf(hy));
    if (cell === undefined) {
      cell = [];
      column.set(coarseOf(hy), cell);
    }
    cell.push({ e, hx, hy });
  }

  /** Whether a member within `radius`, at most {@link REST_CLEARANCE_NODES}, of `(hx, hy)` passes `accept`. */
  anyWithin(hx: number, hy: number, radius: number, accept: (e: Entity) => boolean): boolean {
    for (let dx = -1; dx <= 1; dx++) {
      const column = this.byCx.get(coarseOf(hx) + dx);
      if (column === undefined) continue;
      for (let dy = -1; dy <= 1; dy++) {
        for (const m of column.get(coarseOf(hy) + dy) ?? []) {
          if (Math.abs(m.hx - hx) + Math.abs(m.hy - hy) <= radius && accept(m.e)) return true;
        }
      }
    }
    return false;
  }
}

function coarseOf(node: number): number {
  return Math.floor(node / REST_CLEARANCE_NODES);
}
