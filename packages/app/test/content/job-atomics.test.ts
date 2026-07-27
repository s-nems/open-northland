import { resolveJobAtomics } from '@open-northland/data';
import { harvestJobsOf } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { ATTACK_ATOMIC, WHEAT_HARVEST_ATOMIC } from '../../src/catalog/atomics.js';
import { hasRealIr, loadContentUnderTest } from './helpers.js';

/**
 * The base-job chain over the REAL extracted job table — the join the fallback catalog cannot prove
 * (its jobs are all roots). `jobtypes.ini` `baseatomics` names a parent job, so most of the table
 * grants nothing directly: the armed soldiers, the sea trades and `adult_animal` carry an empty
 * `allowatomic` and are their base's set exactly. If an upstream rename or a re-extraction broke the
 * chain, every one of those jobs would silently lose its whole vocabulary instead of failing loudly.
 */
const CIVILIST = 6;
const SOLDIER_UNARMED = 31;
const SOLDIER_SPEAR_IRON = 33;
const HERO_SPEAR = 43;
const FARMER = 18;
const COLLECTOR = 8;

/** What `soldier_unarmed` (`jobtype 31` `forbidatomic`) denies itself out of `civilist`'s grants. */
const SOLDIER_DENIED = [11, 12, 13, 14, 15, 17, 20, 21, 44, 45, 78, 79];
/** Herb's harvest atomic — what the old misreading handed the whole soldier band as its only atomic. */
const HERB_HARVEST_ATOMIC = 31;

describe.runIf(hasRealIr())('job base-atomic chain over the real IR', () => {
  it('resolves a civilian trade to civilist plus its own grants', async () => {
    const { real } = await loadContentUnderTest();
    const atomics = resolveJobAtomics(real.jobs);
    const civilist = atomics.get(CIVILIST);
    const farmer = atomics.get(FARMER);
    expect(civilist?.size).toBeGreaterThan(0);
    for (const atomic of civilist ?? []) expect(farmer).toContain(atomic);
    expect(farmer).toContain(WHEAT_HARVEST_ATOMIC); // its own `allowatomic 29`
  });

  it('gives an armed soldier its unarmed base set, civilian atomics denied', async () => {
    const { real } = await loadContentUnderTest();
    const atomics = resolveJobAtomics(real.jobs);
    const unarmed = atomics.get(SOLDIER_UNARMED);
    const armed = atomics.get(SOLDIER_SPEAR_IRON);
    expect(unarmed).toContain(ATTACK_ATOMIC);
    expect(armed).toEqual(unarmed); // 32..41 grant nothing of their own
    for (const denied of SOLDIER_DENIED) expect(armed).not.toContain(denied);
    // The misreading this replaced handed every soldier the herb harvest as its only atomic.
    expect(armed).not.toContain(HERB_HARVEST_ATOMIC);
  });

  it('gives a hero its soldier class chain up to civilist', async () => {
    const { real } = await loadContentUnderTest();
    const atomics = resolveJobAtomics(real.jobs);
    expect(atomics.get(HERO_SPEAR)).toEqual(atomics.get(SOLDIER_SPEAR_IRON));
  });

  it('classifies only the gathering trades as flag gatherers, soldiers included in neither', async () => {
    const { real } = await loadContentUnderTest();
    const harvest = harvestJobsOf(real);
    expect(harvest).toContain(COLLECTOR);
    expect(harvest).not.toContain(SOLDIER_UNARMED);
    expect(harvest).not.toContain(HERO_SPEAR);
    expect(harvest).not.toContain(CIVILIST); // the chain must not make every trade a gatherer
  });
});
