import {
  Building,
  DefenceMode,
  diplomacyStance,
  MAX_PLAYERS,
  Owner,
  Settler,
} from '../../../components/index.js';
import type { World } from '../../../ecs/world.js';
import { type HalfCellNode, hexDistanceBetween } from '../../../nav/halfcell.js';
import { anchorNodeOf } from '../../ai-shared/node-geometry.js';
import type { SystemContext } from '../../context.js';
import { ownedFightersOf } from '../../movement/collision/owned-fighters.js';
import { isHeroJob } from '../../readviews/index.js';
import { playerSeesNode } from '../../vision/gates.js';
import { believedTowerPosts } from '../knowledge/intel/index.js';
import { believedEnemyTowers, visibleFighters } from '../military/operations/raid-target.js';
import { isLiveFighter } from '../military/points.js';

/** How far (hex nodes) from a building that may shoot the scout keeps (authored): the house bow's
 *  extracted 29-node `maximumrange`, the longest any building or post fires (a long bow's 23 plus the
 *  tower's 5-node bonus is 28), measured from the building's nearest wall up to 4 nodes off its anchor,
 *  and 2 nodes more. */
export const SCOUT_FIRE_CLEARANCE_NODES = 35;

/** How far (hex nodes) from an enemy fighter it sees the scout turns back (authored): a long bow's
 *  extracted 23-node reach and the 7 nodes a few seconds' walk closes. */
export const SCOUT_FIGHTER_CLEARANCE_NODES = 30;

/** The ground the seat's scout keeps out of: the reach of every enemy tower it believes stands, of every
 *  enemy building it last saw a post held on, and of every enemy building it sees on alarm. */
export interface ScoutDanger {
  readonly covers: (hx: number, hy: number) => boolean;
}

/** `player`'s {@link ScoutDanger} now. Costs the enemies' believed buildings and the alarmed ones. */
export function scoutDanger(world: World, ctx: SystemContext, player: number): ScoutDanger {
  const shooters: HalfCellNode[] = believedEnemyTowers(world, ctx, player).map((t) => t.at);
  for (const b of believedTowerPosts(world, player)) shooters.push({ hx: b.hx, hy: b.hy });
  for (const e of world.query(DefenceMode, Owner, Building)) {
    const owner = world.get(e, Owner).player;
    if (owner === player || diplomacyStance(world, player, owner) !== 'enemy') continue;
    const at = anchorNodeOf(world, e);
    if (at !== null && playerSeesNode(ctx.fog, player, at.hx, at.hy)) shooters.push(at);
  }
  return {
    covers: (hx, hy) =>
      shooters.some((s) => hexDistanceBetween(s.hx, s.hy, hx, hy) <= SCOUT_FIRE_CLEARANCE_NODES),
  };
}

/** Whether `player` sees an enemy fighter within {@link SCOUT_FIGHTER_CLEARANCE_NODES} of `at`. Costs the
 *  enemies' fighters and the militia. */
export function enemyFighterNear(
  world: World,
  ctx: SystemContext,
  player: number,
  at: HalfCellNode,
): boolean {
  for (let owner = 0; owner < MAX_PLAYERS; owner++) {
    if (owner === player || diplomacyStance(world, player, owner) !== 'enemy') continue;
    for (const { at: seen } of visibleFighters(world, ctx, player, owner))
      if (hexDistanceBetween(seen.hx, seen.hy, at.hx, at.hy) <= SCOUT_FIGHTER_CLEARANCE_NODES) return true;
  }
  return false;
}

/** Whether `player` holds a soldier: a live fighter of a fighting trade other than a hero. */
export function seatHasSoldier(world: World, ctx: SystemContext, player: number): boolean {
  for (const e of ownedFightersOf(world, ctx.content, player)) {
    if (!isLiveFighter(world, e)) continue;
    if (!isHeroJob(ctx.content, world.tryGet(e, Settler)?.jobType ?? null)) return true;
  }
  return false;
}
