/**
 * The sim's fixed-point overflow asserts are compiled out of the shipped game, so a benchmark runs
 * without them and reports what players run; `ON_BENCH_ASSERTS=on` keeps the development checks.
 * Every benchmark entry imports this module first: the sim reads the switch when it is evaluated.
 */
const raw = process.env.ON_BENCH_ASSERTS?.trim() ?? '';
if (!['', 'on', 'off'].includes(raw)) throw new Error(`ON_BENCH_ASSERTS must be on or off, got '${raw}'`);

/** Whether this run keeps the sim's overflow asserts. */
export const SIM_ASSERTS = raw === 'on';
(globalThis as { __SIM_ASSERTS__?: boolean }).__SIM_ASSERTS__ = SIM_ASSERTS;
