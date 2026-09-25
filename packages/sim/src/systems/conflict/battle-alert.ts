import {
  Engagement,
  Health,
  HuntFocus,
  hasMissionBehaviour,
  MISSION_BEHAVIOUR,
  NeedOrder,
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

// The battle alert: a unit whose stance fights takes no rest and no company while a battle is on around it,
// and one asleep in the open gets up for a fight near enough to join. A battle is on where fighting is
// going on within the rest clearance - one of the player's own units engaged, or one it sees that is
// hostile to it - or where the player can see an enemy soldier standing within the stand-to radius, close
// enough that contact is a matter of a few seconds.
//
// The two halves answer different questions and so read different radii. The nearer one, presence, is what
// keeps a line from lying down in the moments before contact, when nobody is engaged yet. The wider one is
// the battle itself, which a rear rank stands to for whether or not it can see anything.
//
// Wild animals raise neither. A bear that attacks is answered by the fight half the moment it closes, and
// one that merely prowls is no reason for a settlement to give up sleeping; leaving wildlife out also keeps
// the presence sweep off the hundreds of deer a decoded map carries.

/**
 * How near (Manhattan half-cell nodes) a fight gets a fighting unit asleep in the open back up, and how
 * near an enemy on its feet keeps one from lying down. Twice the sight radius, so a rear rank stands to
 * while the rank in front fights. Authored: no readable rule keeps a soldier from resting in a battle.
 */
export const STAND_TO_RADIUS_NODES = 2 * SIGHT_RADIUS_NODES;

/**
 * How far off the fighting must be before a fighting unit lies down or leaves for its needs. The margin
 * over {@link STAND_TO_RADIUS_NODES} keeps a sleeper at the edge of a battle from being roused by every
 * step the fight takes. Authored.
 */
export const REST_CLEARANCE_NODES = STAND_TO_RADIUS_NODES + SIGHT_RADIUS_NODES / 2;

/**
 * Whether `t`, a unit not of `player`'s own, is `player`'s business: a live settler it sees that is hostile
 * to `e` either way round, one that would strike `e` or one `e` would strike. A third player's war counts
 * where its sides are hostile to `e` - a battle in the next valley is a reason to stand to, whoever
 * started it.
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
    if (!playerSeesEntity(world, ctx.fog, player, t)) return false;
    return isValidTarget(world, ctx, t, other, e) || isValidTarget(world, ctx, e, self, t);
  };
}

/**
 * Whether the alert holds `e` where it stands rather than letting it rest or wander off: its stance fights,
 * nothing excuses it - a need the player ordered outranks the alert, and a hunter on a hunt is at work, not
 * at war - and `front` puts a battle inside its rest clearance. The drive ladder's rule, shared so a read
 * seam can caption exactly what the ladder does.
 */
export function holdsGround(world: World, ctx: SystemContext, e: Entity, front: BattleFront): boolean {
  if (world.has(e, NeedOrder) || world.has(e, HuntFocus)) return false;
  const owner = world.tryGet(e, Owner);
  const settler = world.tryGet(e, Settler);
  if (owner === undefined || settler === undefined) return false;
  if (!stanceFights(stanceMode(world, ctx.content, e, settler.jobType))) return false;
  return front.holdsRest(e, owner.player);
}

/**
 * Where the battle is, for one pass. Both indexes are built on the first question that needs them and kept
 * for the rest of the pass, and the only move inside the planner's is a garrison stepping on or off its
 * tower. The combat pass engages and disengages as it goes, so its engaged front is up to a tick behind for
 * the units it has yet to visit - canonically, by entity id, and a sleeper stands to one tick later at
 * worst.
 *
 * The engaged index is all a sleeper needs, and peace leaves it empty, so the settlement a garrison dozes
 * in costs nothing to ask about. The presence index is the expensive half: one sweep of the owned settlers,
 * at most once per pass, and only on a pass where a unit whose stance fights asks {@link holdsRest} with no
 * fighting inside its clearance - which in peacetime means a soldier with a pressing need, or a civilian
 * trade in a fighting stance that wants company. Each caller asks last, after its own cheap refusals.
 *
 * A hunt is no battle: a hunter's chase neither holds a settlement awake nor wakes it.
 */
export class BattleFront {
  private engaged: CoarseGrid | null = null;
  private fighters: CoarseGrid | null = null;

  constructor(
    private readonly world: World,
    private readonly ctx: SystemContext,
  ) {}

  /** Whether `e`, whose stance fights, holds its ground instead of resting or wandering off. */
  holdsRest(e: Entity, player: number): boolean {
    return this.fightWithin(e, player, REST_CLEARANCE_NODES) || this.enemyStandsNear(e, player);
  }

  /** Whether a fight is on close enough to get `e` up from its sleep in the open. An enemy on its feet is
   *  not enough: one that comes within `e`'s own sight is acquired by the combat drive, which wakes it. */
  standsTo(e: Entity, player: number): boolean {
    return this.fightWithin(e, player, STAND_TO_RADIUS_NODES);
  }

  /** Whether anyone is fighting within {@link STAND_TO_RADIUS_NODES} of node `(hx, hy)`, whoever the sides
   *  are: a civilian walking in there would walk into the fight. */
  fightNear(hx: number, hy: number): boolean {
    const grid = this.ensureEngaged();
    return !grid.empty && grid.anyWithin(hx, hy, STAND_TO_RADIUS_NODES, () => true);
  }

  private fightWithin(e: Entity, player: number, radius: number): boolean {
    const grid = this.ensureEngaged();
    if (grid.empty) return false;
    // Built on the first foreign member met, which most questions never reach: a unit stands to for its own
    // side's fight far more often than for anyone else's.
    let hostile: ((t: Entity) => boolean) | null = null;
    return this.within(grid, e, radius, (t) => {
      if (this.world.tryGet(t, Owner)?.player === player) return true;
      hostile ??= threatens(this.world, this.ctx, e, player);
      return hostile(t);
    });
  }

  private enemyStandsNear(e: Entity, player: number): boolean {
    const hostile = threatens(this.world, this.ctx, e, player);
    return this.within(
      this.ensureFighters(),
      e,
      STAND_TO_RADIUS_NODES,
      (t) => this.world.get(t, Owner).player !== player && hostile(t),
    );
  }

  private within(grid: CoarseGrid, e: Entity, radius: number, accept: (t: Entity) => boolean): boolean {
    const p = this.world.get(e, Position);
    return grid.anyWithin(nodeHxOfPosition(p.x, p.y), nodeHyOfPosition(p.y), radius, accept);
  }

  private ensureEngaged(): CoarseGrid {
    if (this.engaged !== null) return this.engaged;
    const grid = new CoarseGrid();
    for (const t of this.world.query(Engagement, Position)) {
      if (!this.world.has(t, HuntFocus)) grid.add(this.world, t);
    }
    this.engaged = grid;
    return grid;
  }

  private ensureFighters(): CoarseGrid {
    if (this.fighters !== null) return this.fighters;
    const grid = new CoarseGrid();
    for (const t of this.world.query(Settler, Health, Position, Owner)) {
      if (this.world.get(t, Health).hitpoints <= 0) continue;
      if (picksFights(this.world, this.ctx, t)) grid.add(this.world, t);
    }
    this.fighters = grid;
    return grid;
  }
}

/** Whether an owned unit picks fights of its own: its stance says so and no script holds it passive. A
 *  unit that never starts one is nobody's reason to stand to. */
function picksFights(world: World, ctx: SystemContext, t: Entity): boolean {
  if (hasMissionBehaviour(world, t, MISSION_BEHAVIOUR.PASSIVE)) return false;
  return stanceFights(stanceMode(world, ctx.content, t, world.get(t, Settler).jobType));
}

interface Member {
  readonly e: Entity;
  readonly hx: number;
  readonly hy: number;
}

/** Positioned entities in coarse cells {@link REST_CLEARANCE_NODES} wide, so a query within that radius -
 *  the widest {@link BattleFront} asks - reads the nine cells around its own. Its own structure rather than
 *  `spatial/nodes.ts` buckets, whose nearest search walks the rings of a radius-40 diamond (some 3300
 *  nodes) to answer a question that only needs the members of nine cells, and rather than the combat pass's
 *  {@link CombatIndex}, which the planner pass has no access to. */
class CoarseGrid {
  private readonly byCx = new Map<number, Map<number, Member[]>>();
  /** Whether nothing was ever added, so a peacetime question costs one branch. */
  empty = true;

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
    this.empty = false;
  }

  /** Whether a member within `radius`, at most {@link REST_CLEARANCE_NODES}, of `(hx, hy)` passes `accept`.
   *  `accept` must be a pure read: which member matches depends on insertion order, only whether one does
   *  is a fact about the world. */
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
