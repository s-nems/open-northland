import type { ColonyWildRun } from '../../../components/index.js';
import type { DeepReadonly } from '../../../ecs/world.js';
import { minutesToTicks } from '../game-phase.js';
import { seatWildThreats } from '../workforce/wild-threats.js';
import type { ColonyEnv, ColonyView } from './env.js';
import { standsOn } from './roster.js';

/** How long wild animals may go on attacking a colony before the seat gives it up (authored): time for its
 *  towers and garrison to answer a pack, short of feeding the pack party after party. */
export const WILD_GIVE_UP_TICKS = minutesToTicks(20);
/** How long a run of wild attacks outlasts the latest one seen (authored): past it the pack drew off or died. */
export const WILD_RUN_LAPSE_TICKS = minutesToTicks(10);

/** `run` while its latest attack lies within {@link WILD_RUN_LAPSE_TICKS} of `tick`, else null. */
function liveRun(run: DeepReadonly<ColonyWildRun> | null, tick: number): DeepReadonly<ColonyWildRun> | null {
  return run !== null && tick - run.seen < WILD_RUN_LAPSE_TICKS ? run : null;
}

/** Whether wild animals have attacked the colony lately: nobody but its garrison sails into the pack. */
export function underWildAttack(colony: ColonyView, tick: number): boolean {
  return liveRun(colony.wild, tick) !== null;
}

/** Whether wild animals the seat sees on the colony's land, about its buildings or at its people, have gone on
 *  attacking it for {@link WILD_GIVE_UP_TICKS} with no lapse. It keeps the colony's run of attacks; only a
 *  change writes. Costs the seat's wildlife scan. */
export function harried(env: ColonyEnv, colony: ColonyView): boolean {
  const { world, ctx, seat } = env;
  const attacked = seatWildThreats(world, ctx, seat, Number.POSITIVE_INFINITY).some((e) =>
    standsOn(world, ctx, e, colony.land),
  );
  const live = liveRun(colony.wild, ctx.tick);
  if (attacked) env.edit().wild = { since: live?.since ?? ctx.tick, seen: ctx.tick };
  else if (live === null && colony.wild !== null) env.edit().wild = null;
  const run = env.colony.wild;
  return run !== null && run.seen - run.since >= WILD_GIVE_UP_TICKS;
}
