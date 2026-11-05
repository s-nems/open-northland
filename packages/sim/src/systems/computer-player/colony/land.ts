import type { HalfCellNode } from '../../../nav/halfcell.js';
import { interactionCell } from '../../settlers/targets/index.js';
import { networkLimitAt } from '../../signposts/index.js';
import {
  type AnchorGate,
  bothGates,
  knownAnd,
  knownResourceTest,
  limitResourceGate,
  nearestLiveResource,
  reachableResourceGate,
  reachableResourceTest,
  type WorkableTest,
  workableResourceTest,
} from '../live-resources.js';
import { collectorSpot, type FlagGround, flagGround } from '../workforce/flag-spots.js';
import type { ColonyEnv, SeatEnv } from './env.js';

/** Owner ruling: wood, iron, stone and clay depend on what lies on the colony's land: what it holds never
 *  sails out, what it lacks and needs does. */
export const LAND_GOOD_IDS = ['wood', 'stone', 'mud', 'iron'] as const;
export type LandGood = (typeof LAND_GOOD_IDS)[number];

/** Whether the land under `from` holds a live deposit of `goodType` the seat knows of. Costs a resource
 *  search, the whole good's on a land that holds none. */
export function landHolds(env: SeatEnv, from: HalfCellNode, goodType: number): boolean {
  const { world, ctx, terrain, seat } = env;
  const reachable = reachableResourceTest(
    world,
    ctx,
    terrain,
    from,
    workableResourceTest(world, ctx, terrain),
  );
  const known = knownResourceTest(world, ctx, seat);
  const gate = reachableResourceGate(ctx, terrain, from);
  return nearestLiveResource(world, goodType, from, knownAnd(known, reachable), gate) !== null;
}

/** The flag ground of the signposts round `origin`. */
export function flagGroundAt(env: ColonyEnv, origin: HalfCellNode): FlagGround {
  const { world, ctx, terrain, seat } = env;
  return flagGround(world, ctx, terrain, networkLimitAt(world, terrain, seat, origin.hx, origin.hy), 'aimed');
}

/** Which of a good's resources `origin`'s men may work: known to the seat and inside its reach. */
export function workableFrom(env: ColonyEnv, origin: HalfCellNode, ground: FlagGround): WorkableTest {
  const { world, ctx, terrain, seat } = env;
  const reachable = reachableResourceTest(
    world,
    ctx,
    terrain,
    origin,
    workableResourceTest(world, ctx, terrain),
  );
  const known = knownResourceTest(world, ctx, seat);
  const door = terrain.nodeAtClamped(origin.hx, origin.hy);
  const { limit } = ground;
  return (e) =>
    reachable(e) &&
    (known === null || known(e)) &&
    (limit === null || limit.allowsNode(interactionCell(world, ctx, terrain, e, door)));
}

/** {@link workableFrom}'s anchor gate. */
export function workableFromGate(
  env: ColonyEnv,
  origin: HalfCellNode,
  ground: FlagGround,
): AnchorGate | undefined {
  const { ctx, terrain } = env;
  return bothGates(
    reachableResourceGate(ctx, terrain, origin),
    limitResourceGate(ctx, terrain, ground.limit),
  );
}

/** Whether a flag on `goodType` can stand now: what the land holds past the signposts nobody digs. Costs a
 *  flag search. */
export function canDig(env: ColonyEnv, origin: HalfCellNode, goodType: number, ground: FlagGround): boolean {
  const workable = workableFrom(env, origin, ground);
  const gate = workableFromGate(env, origin, ground);
  return collectorSpot(env.world, ground, origin, goodType, new Set(), workable, undefined, gate) !== null;
}
