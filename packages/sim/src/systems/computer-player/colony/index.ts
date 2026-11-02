import {
  aiControlEntity,
  ComputerColony,
  type ComputerColonyState,
  colonyRuns,
} from '../../../components/index.js';
import type { PlayerCommand } from '../../../core/commands/index.js';
import type { World } from '../../../ecs/world.js';
import { moduleBeatDue, POPULATION_PHASE, WORKFORCE_EVERY_DECISIONS } from '../../ai-shared/cadence.js';
import type { SystemContext } from '../../context.js';
import { seatArchetype } from '../build-order/seat-order.js';
import type { ComputerModule } from '../index.js';
import { foundColony } from './founding.js';
import { runLine } from './line.js';
import {
  afterLanding,
  type ColonyEnv,
  chooseSite,
  claimScoutShip,
  fittingOut,
  landing,
  loading,
  returning,
  sailing,
  scouting,
} from './voyage.js';

/** Every how many decisions a seat with no colony surveys for one (authored): the survey's cost once a
 *  game minute. */
const SURVEY_EVERY_DECISIONS = 15;

function runColony(world: World, ctx: SystemContext, seat: number): readonly PlayerCommand[] {
  if (seatArchetype(world, seat) !== 'islands' || !colonyRuns(world, seat)) return [];
  const terrain = ctx.terrain;
  const carrier = aiControlEntity(world, seat);
  if (terrain === undefined || carrier === null) return [];
  const edit = (): ComputerColonyState => world.mut(carrier, ComputerColony);
  const env: ColonyEnv = { world, ctx, terrain, seat, carrier, edit };
  const colony = world.tryGet(carrier, ComputerColony);
  if (colony === undefined) {
    if (moduleBeatDue(ctx.tick - POPULATION_PHASE, seat, SURVEY_EVERY_DECISIONS)) chooseSite(env);
    return [];
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
      const ships = [...afterLanding(env, colony), ...runLine(env, world.get(carrier, ComputerColony))];
      if (!moduleBeatDue(ctx.tick - POPULATION_PHASE, seat, WORKFORCE_EVERY_DECISIONS)) return ships;
      return [...ships, ...foundColony(env, world.get(carrier, ComputerColony))];
    }
    case 'returning':
      return returning(env, colony);
    default:
      return [];
  }
}

/** A seat's colony over the sea. It writes no state and issues no command while a seat holds none. */
export const colonyModule: ComputerModule = {
  id: 'colony',
  gate: 'houseBuild',
  phase: POPULATION_PHASE,
  run: runColony,
};
