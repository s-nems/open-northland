import { CurrentAtomic, ErectSignpostOrder, PlayerOrder, Settler } from '../../../components/index.js';
import type { PlayerCommand } from '../../../core/commands/index.js';
import type { World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import { isScoutJob } from '../../readviews/index.js';
import type { BuildOrderEntry } from '../build-order/entries.js';
import type { AiPlayerModule } from '../index.js';
import { ownedSettlers } from '../seat-roster.js';
import { nextLivestockCatch } from './livestock-catch.js';
import { nextSignpostTarget } from './signpost-coverage.js';

export { nextLivestockCatch, SCOUT_CATCH_RADIUS_NODES } from './livestock-catch.js';
export {
  nextSignpostTarget,
  SIGNPOST_LATTICE_SPACING_NODES,
  SIGNPOST_TARGET_TOLERANCE_NODES,
  signpostLatticeOffset,
} from './signpost-coverage.js';

/**
 * The GuideBuild module: the seat's one scout and the only issuer of its orders, so its two duties can
 * never order the same man in one decision. Signposts outrank the round-up (authored): a lattice target
 * is static, while an animal that wanders off is picked up again next decision.
 */
function runScout(
  world: World,
  ctx: SystemContext,
  player: number,
  order: readonly BuildOrderEntry[],
): readonly PlayerCommand[] {
  const scout = ownedSettlers(world, player).find((e) =>
    isScoutJob(ctx.content, world.get(e, Settler).jobType),
  );
  if (scout === undefined) return [];
  // CurrentAtomic has to be part of the busy test: both order markers are shed the moment a need drive
  // starts an atomic, so an eating scout would otherwise look order-free and be re-ordered every beat.
  if (world.has(scout, CurrentAtomic)) return [];
  if (world.has(scout, ErectSignpostOrder) || world.has(scout, PlayerOrder)) return []; // busy
  const post = nextSignpostTarget(world, ctx, player, order);
  if (post !== null) return [{ kind: 'placeSignpost', entity: scout, x: post.hx, y: post.hy }];
  const animal = nextLivestockCatch(world, ctx, player);
  if (animal === null) return [];
  return [{ kind: 'moveUnit', entity: scout, x: animal.hx, y: animal.hy }];
}

/** The scout module over the seat's build order, whose collector goods name the deposits the lattice
 *  reaches out to. */
export function scoutModule(order: readonly BuildOrderEntry[]): AiPlayerModule {
  return {
    id: 'guideBuild',
    run: (world, ctx, player) => runScout(world, ctx, player, order),
  };
}
