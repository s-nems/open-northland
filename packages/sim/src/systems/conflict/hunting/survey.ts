import { Health, Owner, UnreachableTargets } from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { TerrainGraph } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import { MILITARY_MODE, stanceMode } from '../../readviews/index.js';
import { entityNode } from '../../spatial/nodes.js';
import { combatDormantOn, passIndexOf } from '../combat-index.js';
import { isHuntTarget, SIGHT_RADIUS_NODES } from '../targeting.js';
import { groundDistance, huntingGround } from './ground.js';
import { preyHeldByOthers } from './prey-holds.js';
import { isLastResortAnimal, lastResortGate, preyOnBank } from './spec.js';

/**
 * What a hunter's prey acquisition finds in its ground: `game` an animal it would draw on, `cutOff` only
 * game across a terrain seam or given up as unreachable, `none` no free game in its ground.
 */
export type HuntingGameSurvey = 'game' | 'cutOff' | 'none';

/**
 * The prey acquisition's answer for hunter `e` as of the tick's combat pass, read off the index that pass
 * built and the gates of `hunterEngageSpec`, without its writes: the spec reaps a lapsed lock and
 * the given-up memo as it reads them. One band scan over the ground, as one acquisition costs. Null for a
 * hunter that runs no prey search (an ordered or fighting stance, no Health pool, unowned) or on a tick
 * the combat system has not judged yet.
 */
export function surveyHuntingGame(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  e: Entity,
  jobType: number,
): HuntingGameSurvey | null {
  if (!world.has(e, Owner) || !world.has(e, Health)) return null;
  if (stanceMode(world, ctx.content, e, jobType) !== MILITARY_MODE.IGNORE) return null;
  const index = passIndexOf(world, ctx.tick);
  if (index === null) return combatDormantOn(world, ctx.tick) ? 'none' : null;

  const here = entityNode(world, terrain, e);
  const bank = terrain.componentOf(here);
  const ground = huntingGround(world, terrain, e);
  const center = ground?.anchorCell ?? here;
  const radius = ground?.radius ?? SIGHT_RADIUS_NODES;
  const heldByColleague = preyHeldByOthers(world, e);
  const givenUp = world.tryGet(e, UnreachableTargets)?.entries;
  const gaveUp = (t: Entity): boolean =>
    givenUp?.some((entry) => entry.target === t && entry.until > ctx.tick) ?? false;
  const lastResortOk = lastResortGate(
    terrain,
    index,
    center,
    radius,
    (t) => preyOnBank(world, ctx, terrain, t, jobType, bank),
    (t) => isLastResortAnimal(world, ctx, t),
  );
  let cutOff = false;
  const { x, y } = terrain.coordsOf(center);
  const found = index.nearest(
    x,
    y,
    0,
    radius,
    (t) => {
      if (!isHuntTarget(world, ctx, t, jobType)) return false;
      if (ground !== null && groundDistance(terrain, center, entityNode(world, terrain, t)) > radius)
        return false;
      if (heldByColleague(t)) return false;
      if (!preyOnBank(world, ctx, terrain, t, jobType, bank) || gaveUp(t)) {
        cutOff = true;
        return false;
      }
      return lastResortOk(t);
    },
    null,
    'hex',
  );
  if (found !== null) return 'game';
  return cutOff ? 'cutOff' : 'none';
}
