import { fx, type WorldSnapshot } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { JOB_COLLECTOR, JOB_SCOUT, JOB_WOMAN } from '../src/catalog/jobs.js';
import { sandboxContent } from '../src/game/sandbox/index.js';
import { hasEligiblePartner } from '../src/game/snapshot.js';
import { menuStateFor } from '../src/view/unit-controls/action-ring/menu-state.js';
import { countingSnapshot, type Ent, snapshotOf } from './support/snapshot.js';

/**
 * The action ring's erect-signpost button must offer exactly what `placeSignpost` accepts - both read the
 * content's scout role, so a content whose scout is not the catalog's job 27 keeps them in step. The
 * button is derived before the single-selection gate, so an empty snapshot exercises it on its own.
 */
const EMPTY: WorldSnapshot = { tick: 0, entities: [], events: [] };

/** One per process: every case here reads the same session content. */
const content = sandboxContent();

describe('action-ring erect-signpost gating', () => {
  it('offers the button on a uniform scout selection and nothing else', () => {
    expect(menuStateFor(content, EMPTY, [], JOB_SCOUT).erectSignpost).toBe(true);
    expect(menuStateFor(content, EMPTY, [], JOB_COLLECTOR).erectSignpost).toBe(false);
    // A mixed selection has no uniform job - the erect order takes several scouts, so it needs one.
    expect(menuStateFor(content, EMPTY, [], undefined).erectSignpost).toBe(false);
  });
});

const TRIBE = 1;
const SEEKER = 1;

/** An adult settler of `jobType`, positioned and of {@link TRIBE} unless the options say otherwise. */
function adult(
  id: number,
  jobType: number,
  opts: { female?: boolean; spouse?: number; tribe?: number; unplaced?: boolean } = {},
): Ent {
  return {
    id,
    components: {
      Settler: { jobType, tribe: opts.tribe ?? TRIBE },
      ...(opts.unplaced === true ? {} : { Position: { x: fx.fromInt(id), y: fx.fromInt(id) } }),
      ...(opts.female === true ? { Female: {} } : {}),
      ...(opts.spouse !== undefined ? { Marriage: { spouse: opts.spouse, child: null } } : {}),
    },
  };
}

// `canMarry` false drops the button from the ring's bottom arm (`menuForSettler`), it does not grey it.
describe('action-ring marry gating', () => {
  it('offers the button while an unmarried woman of the tribe stands somewhere', () => {
    const snapshot = snapshotOf([adult(SEEKER, JOB_COLLECTOR), adult(2, JOB_WOMAN, { female: true })]);
    expect(menuStateFor(content, snapshot, [SEEKER], JOB_COLLECTOR).canMarry).toBe(true);
  });

  it('drops it when the only woman is bound to a living husband', () => {
    const snapshot = snapshotOf([
      adult(SEEKER, JOB_COLLECTOR),
      adult(2, JOB_WOMAN, { female: true, spouse: 3 }),
      adult(3, JOB_COLLECTOR, { spouse: 2 }),
    ]);
    expect(menuStateFor(content, snapshot, [SEEKER], JOB_COLLECTOR).canMarry).toBe(false);
  });

  it('counts neither a foreign tribe woman nor one the snapshot has not placed', () => {
    const snapshot = snapshotOf([
      adult(SEEKER, JOB_COLLECTOR),
      adult(2, JOB_WOMAN, { female: true, tribe: TRIBE + 1 }),
      adult(3, JOB_WOMAN, { female: true, unplaced: true }),
    ]);
    expect(menuStateFor(content, snapshot, [SEEKER], JOB_COLLECTOR).canMarry).toBe(false);
  });
});

describe('hasEligiblePartner memo', () => {
  // No woman: the pass runs to the end instead of stopping at a match, the worst case the memo is for.
  const seeker = adult(SEEKER, JOB_COLLECTOR);
  const entities = [seeker, adult(2, JOB_COLLECTOR)];

  it('scans a snapshot object once, however many frames read it', () => {
    const { snapshot, scans } = countingSnapshot(snapshotOf(entities));
    expect(hasEligiblePartner(content, snapshot, seeker)).toBe(false);
    const scanned = scans();
    expect(scanned).toBeGreaterThan(0);
    expect(hasEligiblePartner(content, snapshot, seeker)).toBe(false);
    expect(scans()).toBe(scanned);
  });

  it('answers the next tick fresh instead of serving the last verdict', () => {
    expect(hasEligiblePartner(content, snapshotOf(entities), seeker)).toBe(false);
    // A woman comes of age: the new snapshot object must not inherit the previous one's "nobody".
    const grown = snapshotOf([...entities, adult(3, JOB_WOMAN, { female: true })]);
    expect(hasEligiblePartner(content, grown, seeker)).toBe(true);
  });
});
