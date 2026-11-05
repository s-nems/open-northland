import { aiControlEntity, ComputerColony, colonyRuns } from '../../../components/index.js';
import type { PlayerCommand } from '../../../core/commands/index.js';
import type { World } from '../../../ecs/world.js';
import { moduleBeatDue, POPULATION_PHASE, WORKFORCE_EVERY_DECISIONS } from '../../ai-shared/cadence.js';
import type { SystemContext } from '../../context.js';
import { seatArchetype } from '../build-order/seat-order.js';
import type { ComputerModule } from '../index.js';
import { abandonColony, evacuate, evacuated, overrun } from './abandon.js';
import { type ColonyEnv, colonyEnv, type SeatEnv } from './env.js';
import { openNextColony } from './expansion.js';
import { releaseRoute, runRoute } from './goods/route.js';
import { stopPullOrders } from './goods/stop-pull.js';
import { recoverStrayShips, strayCrewsHome } from './sea/stray-ships.js';
import { runFerry } from './settlement/ferry.js';
import { foundColony } from './settlement/founding.js';
import { defendColony } from './settlement/garrison.js';
import { reviewOverflow } from './settlement/overflow.js';
import {
  afterLanding,
  chooseSite,
  claimScoutShip,
  fittingOut,
  landing,
  loading,
  returning,
  sailing,
  scouting,
} from './voyage/voyage.js';

/** Every how many decisions a seat surveys for a colony, its next or its first (authored): the survey's cost
 *  once a game minute. */
const SURVEY_EVERY_DECISIONS = 15;
/** Every how many decisions a colony reads the seat's held steps (authored): a game minute. */
const OVERFLOW_EVERY_DECISIONS = 15;

/** One colony's decision. */
function runOneColony(env: ColonyEnv): readonly PlayerCommand[] {
  const { ctx, seat, colony } = env;
  if (
    colony.phase !== 'abandoned' &&
    moduleBeatDue(ctx.tick - POPULATION_PHASE, seat, OVERFLOW_EVERY_DECISIONS)
  ) {
    reviewOverflow(env, colony);
  }
  switch (colony.phase) {
    case 'siteChosen':
      return claimScoutShip(env, colony);
    case 'scouting':
      return colony.scout === null ? [] : scouting(env, colony, colony.scout);
    case 'fittingOut':
      return fittingOut(env, colony);
    case 'loading':
      return loading(env, colony);
    case 'sailing':
      return sailing(env, colony);
    case 'landing':
      return landing(env, colony);
    case 'founding':
    case 'running': {
      const ships = [
        ...afterLanding(env, colony),
        ...runRoute(env),
        ...runFerry(env, env.colony),
        ...defendColony(env, env.colony),
      ];
      if (!moduleBeatDue(ctx.tick - POPULATION_PHASE, seat, WORKFORCE_EVERY_DECISIONS)) return ships;
      if (!overrun(env, colony))
        return [...ships, ...recoverStrayShips(env, colony), ...foundColony(env, colony)];
      abandonColony(env);
      return ships;
    }
    case 'returning':
      return returning(env, colony);
    case 'abandoned':
      return evacuate(env, colony);
    default:
      return [];
  }
}

function runColony(world: World, ctx: SystemContext, seat: number): readonly PlayerCommand[] {
  if (seatArchetype(world, seat) !== 'islands' || !colonyRuns(world, seat)) return [];
  const terrain = ctx.terrain;
  const carrier = aiControlEntity(world, seat);
  if (terrain === undefined || carrier === null) return [];
  const env: SeatEnv = { world, ctx, terrain, seat, carrier };
  const surveyDue = moduleBeatDue(ctx.tick - POPULATION_PHASE, seat, SURVEY_EVERY_DECISIONS);
  const state = world.tryGet(carrier, ComputerColony);
  if (state === undefined) {
    if (surveyDue) chooseSite(env);
    return [];
  }
  // A copy: a voyage that fails for good drops its colony off the list.
  const commands = [...state.colonies].flatMap((colony) => runOneColony(colonyEnv(env, colony)));
  const held = world.tryGet(carrier, ComputerColony);
  if (held !== undefined && moduleBeatDue(ctx.tick - POPULATION_PHASE, seat, WORKFORCE_EVERY_DECISIONS)) {
    commands.push(...stopPullOrders(env));
    // A berth at home a colony sails from: the seat's crews come home whether or not that colony stands.
    const berth = held.colonies.find((colony) => colony.berth !== null)?.berth ?? null;
    if (berth !== null) commands.push(...strayCrewsHome(env, berth));
  }
  // A seat with none under way, its colonies all lost and wound up, looks for a first one again.
  if (held !== undefined && surveyDue) {
    if (held.colonies.every(evacuated)) chooseSite(env);
    else openNextColony(env);
  }
  return commands;
}

/** The orders that let the seat's colonies go as its colony controller stops, before their state is dropped:
 *  each route released as an abandoned colony's is, and home's stop stores no longer pulling materials. */
export function releaseColonies(world: World, ctx: SystemContext, seat: number): PlayerCommand[] {
  const terrain = ctx.terrain;
  const carrier = aiControlEntity(world, seat);
  const state = carrier === null ? undefined : world.tryGet(carrier, ComputerColony);
  if (terrain === undefined || carrier === null || state === undefined) return [];
  const env: SeatEnv = { world, ctx, terrain, seat, carrier };
  const routes = [...state.colonies].flatMap((colony) => releaseRoute(colonyEnv(env, colony), colony));
  // With no route left standing, no store is wanted and every pull is lifted.
  return [...routes, ...stopPullOrders(env)];
}

/** A seat's colonies over the sea. It writes no state and issues no command while a seat holds none. */
export const colonyModule: ComputerModule = {
  id: 'colony',
  gate: 'houseBuild',
  phase: POPULATION_PHASE,
  run: runColony,
};
