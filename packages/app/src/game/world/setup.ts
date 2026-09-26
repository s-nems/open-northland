import type { Simulation } from '@open-northland/sim';

/** The seam a world builder hands its assembly steps: commands that land before the first tick. */
export type WorldSetup = Pick<Simulation, 'enqueueSetup'>;
