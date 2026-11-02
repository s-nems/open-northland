import { aiControlEntity, ComputerColony, colonyRuns } from '../../../components/index.js';
import type { PlayerCommand } from '../../../core/commands/index.js';
import type { World } from '../../../ecs/world.js';
import { moduleBeatDue, POPULATION_PHASE, WORKFORCE_EVERY_DECISIONS } from '../../ai-shared/cadence.js';
import type { SystemContext } from '../../context.js';
import { seatArchetype } from '../build-order/seat-order.js';
import type { ComputerModule } from '../index.js';
import { abandonColony, evacuate, overrun } from './abandon.js';
import { foundColony } from './founding.js';
import { runLine } from './line.js';
import { reviewOverflow } from './overflow.js';
import { recoverStrayShips } from './stray-ships.js';
import {
  afterLanding,
  type ColonyEnv,
  chooseSite,
  claimScoutShip,
  colonyEnv,
  fittingOut,
  landing,
  loading,
  returning,
  type SeatEnv,
  sailing,
  scouting,
} from './voyage.js';

/** Every how many decisions a seat with no colony surveys for one (authored): the survey's cost once a
 *  game minute. */
const SURVEY_EVERY_DECISIONS = 15;
/** Every how many decisions a colony reads the seat's held steps (authored): a game minute. */
const OVERFLOW_EVERY_DECISIONS = 15;

/** One colony's decision. */
function runOneColony(env: ColonyEnv): readonly PlayerCommand[] {
  const { ctx, seat, colony } = env;
  if (
    colony.phase !== 'abandoned' &&
    moduleBeatDue(ctx.tick - POPULATION_PHASE, seat, OVERFLOW_EVERY_DECISIONS)
  )
    reviewOverflow(env, colony);
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
      const ships = [...afterLanding(env, colony), ...runLine(env, colony)];
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
  const state = world.tryGet(carrier, ComputerColony);
  if (state === undefined) {
    if (moduleBeatDue(ctx.tick - POPULATION_PHASE, seat, SURVEY_EVERY_DECISIONS)) chooseSite(env);
    return [];
  }
  // A copy: a voyage that fails for good drops its colony off the list.
  return [...state.colonies].flatMap((colony) => runOneColony(colonyEnv(env, colony)));
}

/** A seat's colonies over the sea. It writes no state and issues no command while a seat holds none. */
export const colonyModule: ComputerModule = {
  id: 'colony',
  gate: 'houseBuild',
  phase: POPULATION_PHASE,
  run: runColony,
};
