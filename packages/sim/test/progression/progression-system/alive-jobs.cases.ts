import { describe, expect, it } from 'vitest';
import { addPerson, Settler, setSettlerJob } from '../../../src/components/index.js';
import { Simulation } from '../../../src/index.js';
import { goodEnabled } from '../../../src/systems/index.js';
import { testContent } from '../../fixtures/content.js';
import { settlerAt } from '../../fixtures/settler.js';
import { ctxOf, MINER, WOODCUTTER } from './support.js';

/**
 * The `jobEnables` gate reads a memoized `tribe → living trades` table instead of scanning every Settler
 * per probe. These cases pin the property that makes the memo safe: it answers exactly what a fresh scan
 * would, with no within-tick staleness. Every probe below runs back to back inside one tick, so a memo
 * keyed on anything coarser than the Settler store's own generations would fail them.
 */

const VIKING = 1;
/** A tribe the fixture declares no record for - not the viking, and not wildlife (no `animaltypes`
 *  record), so a settler of it is an ordinary person of another civilization. */
const OTHER_TRIBE = 99;
/** The fixture gates producing PLANK on a living woodcutter (`jobEnablesGood 1 2`). */
const PLANK = 2;

describe('jobEnables gate: tracks the living trades within a single tick', () => {
  it('follows a spawn, a trade change, and a death with no tick boundary between probes', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const ctx = ctxOf(sim);
    expect(goodEnabled(sim.world, ctx, undefined, VIKING, PLANK)).toBe(false); // nobody alive holds the trade

    const cutter = settlerAt(sim, { jobType: WOODCUTTER, tribe: VIKING });
    expect(goodEnabled(sim.world, ctx, undefined, VIKING, PLANK)).toBe(true);

    setSettlerJob(sim.world, cutter, MINER); // retrained out of the enabling trade
    expect(goodEnabled(sim.world, ctx, undefined, VIKING, PLANK)).toBe(false);

    setSettlerJob(sim.world, cutter, WOODCUTTER);
    expect(goodEnabled(sim.world, ctx, undefined, VIKING, PLANK)).toBe(true);

    sim.world.destroy(cutter); // the tribe's last woodcutter dies mid-tick
    expect(goodEnabled(sim.world, ctx, undefined, VIKING, PLANK)).toBe(false);
    expect(sim.world.verifyCaches()).toEqual([]);
  });

  it('follows a whole-component overwrite, which carries the tribe the seam cannot change', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const ctx = ctxOf(sim);
    const cutter = settlerAt(sim, { jobType: WOODCUTTER, tribe: VIKING });
    expect(goodEnabled(sim.world, ctx, undefined, VIKING, PLANK)).toBe(true);

    // Re-`add` is the only way a settler's tribe can change, so the memo leans on it bumping the
    // membership generation even though the entity was already in the store.
    const cutterState = sim.world.get(cutter, Settler);
    addPerson(sim.world, cutter, {
      ...cutterState,
      experience: new Map(cutterState.experience),
      tribe: OTHER_TRIBE,
    });
    expect(goodEnabled(sim.world, ctx, undefined, VIKING, PLANK)).toBe(false);
    expect(sim.world.verifyCaches()).toEqual([]);
  });

  it('does not let another tribe woodcutter satisfy the gate', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const ctx = ctxOf(sim);
    settlerAt(sim, { jobType: WOODCUTTER, tribe: OTHER_TRIBE });

    expect(goodEnabled(sim.world, ctx, undefined, VIKING, PLANK)).toBe(false);
    expect(sim.world.verifyCaches()).toEqual([]);
  });

  it('leaves an idle settler out of the trades it once held', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const ctx = ctxOf(sim);
    const cutter = settlerAt(sim, { jobType: WOODCUTTER, tribe: VIKING });
    expect(goodEnabled(sim.world, ctx, undefined, VIKING, PLANK)).toBe(true);

    setSettlerJob(sim.world, cutter, null); // unemployed: a trade nobody works unlocks nothing
    expect(goodEnabled(sim.world, ctx, undefined, VIKING, PLANK)).toBe(false);
    expect(sim.world.verifyCaches()).toEqual([]);
  });

  it('the verifier flags an in-place trade write that skipped setSettlerJob', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const ctx = ctxOf(sim);
    const cutter = settlerAt(sim, { jobType: WOODCUTTER, tribe: VIKING });
    expect(goodEnabled(sim.world, ctx, undefined, VIKING, PLANK)).toBe(true); // builds the memo

    // What `readonly jobType` prevents in real code: a raw store write with no value-generation bump.
    (sim.world.get(cutter, Settler) as { jobType: number | null }).jobType = MINER;
    expect(sim.world.verifyCaches().join('\n')).toContain('aliveTribeJobs');

    setSettlerJob(sim.world, cutter, MINER); // the same trade through the seam - the next read rebuilds
    expect(goodEnabled(sim.world, ctx, undefined, VIKING, PLANK)).toBe(false);
    expect(sim.world.verifyCaches()).toEqual([]);
  });
});
