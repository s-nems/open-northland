import {
  AttackOrder,
  Engagement,
  Position,
  Settler,
  type SettlerIdentity,
  Weapon,
} from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import { attackerWeapon } from '../../conflict/weapons.js';
import type { SystemContext } from '../../context.js';
import { isFighterJob, isRangedWeapon } from '../../readviews/index.js';
import { entityNode, manhattan } from '../../spatial/nodes.js';
import { ownedSettlers } from '../shared.js';
import { MUSTER_HOME_RADIUS_NODES } from './muster.js';

/** The seat's fighters, sorted by what this decision can do with them. */
export interface ArmyCensus {
  /** Standing at the barracks, free to be sent - the wave in waiting (canonical ascending id). */
  readonly muster: readonly Entity[];
  /** Out on the map with no focus left, free to be re-aimed at the next objective. */
  readonly afield: readonly Entity[];
  /** How many of {@link muster} shoot, and how many fight in reach (they sum to `muster.length`).
   *  Both are 0 for a seat whose recruits are all the weaponless base class the drill enlists: the
   *  garrison rung publishes only `trainSoldiers`, never the assistant's weapon-class counters. */
  readonly ranged: number;
  readonly melee: number;
}

/**
 * Sort the seat's fighters around its `rally` point. A fighter chasing an {@link AttackOrder} focus, or
 * trading blows right now ({@link Engagement}), lands in neither list: he is already committed, and
 * re-ordering him would cancel the swing he is halfway through - which is also why no march order needs
 * a "same focus already" check.
 */
export function takeCensus(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
  rally: NodeId,
): ArmyCensus {
  const muster: Entity[] = [];
  const afield: Entity[] = [];
  let ranged = 0;
  for (const e of ownedSettlers(world, player)) {
    const settler = world.get(e, Settler);
    if (!isFighterJob(ctx.content, settler.jobType)) continue;
    if (world.has(e, AttackOrder) || world.has(e, Engagement)) continue;
    if (!world.has(e, Position)) continue;
    if (manhattan(terrain, entityNode(world, terrain, e), rally) > MUSTER_HOME_RADIUS_NODES) {
      afield.push(e);
      continue;
    }
    muster.push(e);
    if (isShooter(world, ctx, e, settler)) ranged++;
  }
  return { muster, afield, ranged, melee: muster.length - ranged };
}

/** Whether the fighter shoots rather than closes: the weapon the CombatSystem would resolve for him -
 *  the worn one, else his class default - fires ammunition. A class the content arms with nothing counts
 *  as melee; he has no reach to keep. */
function isShooter(world: World, ctx: SystemContext, e: Entity, settler: SettlerIdentity): boolean {
  const armed = attackerWeapon(ctx, settler.tribe, settler.jobType, world.tryGet(e, Weapon)?.weaponTypeId);
  return armed !== null && isRangedWeapon(armed.weapon);
}
