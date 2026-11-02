import { POPULATION_PHASE } from '../../ai-shared/cadence.js';
import type { ComputerModule } from '../index.js';

/** A seat's colony over the sea. It writes no state and issues no command while a seat holds none. */
export const colonyModule: ComputerModule = {
  id: 'colony',
  gate: 'houseBuild',
  phase: POPULATION_PHASE,
  run: () => [],
};
