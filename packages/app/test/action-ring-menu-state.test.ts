import type { ContentSet } from '@open-northland/data';
import { components, fx, systems, type WorldSnapshot } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import {
  JOB_BUILDER,
  JOB_CHILD_MALE,
  JOB_COLLECTOR,
  JOB_HEROINE_BOW,
  JOB_HUNTER,
  JOB_SCOUT,
  JOB_SOLDIER,
  JOB_WOMAN,
} from '../src/catalog/jobs.js';
import { sandboxContent } from '../src/game/sandbox/index.js';
import { hasEligiblePartner } from '../src/game/snapshot.js';
import type { ActionCommandId } from '../src/hud/action-ring/index.js';
import { allowedActions } from '../src/view/unit-controls/action-ring/menu-state.js';
import { countingSnapshot, type Ent, snapshotOf } from './support/snapshot.js';

/**
 * Which orders the ring offers a selection: the per-settler gates mirror what each simulation command
 * accepts, and a selection of several intersects them and keeps only the group orders.
 */

/** One per process: every case here reads the same session content. */
const content = sandboxContent();

const TRIBE = 1;
const HOME = 50;
const WORKSHOP = 51;
const BARRACKS = 52;
const SITE = 53;
const FLAG = 54;
interface Opts {
  readonly female?: boolean;
  readonly child?: boolean;
  readonly spouse?: number;
  readonly growingChild?: number;
  readonly home?: boolean;
  readonly workplace?: boolean;
  readonly stance?: number;
  readonly drilling?: boolean;
  readonly site?: boolean;
  readonly workFlag?: boolean;
  readonly noRegeneration?: boolean;
  readonly tribe?: number;
  readonly unplaced?: boolean;
}

function settler(id: number, jobType: number, opts: Opts = {}): Ent {
  return {
    id,
    components: {
      Settler: { jobType, tribe: opts.tribe ?? TRIBE },
      ...(opts.unplaced === true ? {} : { Position: { x: fx.fromInt(id), y: fx.fromInt(id) } }),
      ...(opts.female === true ? { Female: {} } : {}),
      ...(opts.child === true ? { Age: { ticks: 0 } } : {}),
      ...(opts.spouse !== undefined
        ? { Marriage: { spouse: opts.spouse, child: opts.growingChild ?? null } }
        : {}),
      ...(opts.home === true ? { Residence: { home: HOME } } : {}),
      ...(opts.workplace === true ? { JobAssignment: { workplace: WORKSHOP } } : {}),
      ...(opts.stance !== undefined ? { Stance: { mode: opts.stance, anchorCell: null } } : {}),
      ...(opts.drilling === true ? { TrainingOrder: { house: BARRACKS, drillTicksLeft: 10 } } : {}),
      ...(opts.site === true ? { SiteAssignment: { site: SITE, pinned: true } } : {}),
      ...(opts.workFlag === true ? { WorkFlag: { flag: FLAG, radius: 24 } } : {}),
      ...(opts.noRegeneration === true ? { NoRegeneration: { prohibited: true } } : {}),
    },
  };
}

const allowed = (snapshot: WorldSnapshot, ids: readonly number[]): ActionCommandId[] =>
  [...allowedActions(content, snapshot, ids)].sort();

describe('allowedActions - one settler', () => {
  it('offers nothing for an empty or non-settler selection', () => {
    expect(allowed(snapshotOf([]), [])).toEqual([]);
    expect(allowed(snapshotOf([settler(1, JOB_COLLECTOR)]), [99])).toEqual([]);
  });

  it('offers a lone collector the walk, needs, trade, place and strike orders but no releases', () => {
    const snapshot = snapshotOf([settler(1, JOB_COLLECTOR)]);
    expect(allowed(snapshot, [1])).toEqual(
      [
        'assignHome',
        'assignLearningPlace',
        'assignVehicle',
        'assignWorkArea',
        'assignWorkPlace',
        'attackAnimal',
        'attackBuilding',
        'attackInhabitants',
        'attackVehicle',
        'changeEquipment',
        'changeProfession',
        'eat',
        'goTo',
        'sleep',
      ].sort(),
    );
  });

  it('offers talk and prayer to the trades whose atomics allow them', () => {
    // The sandbox catalog binds no talk or pray atomic; the served content does, through `baseJob`.
    const talkative: ContentSet = {
      ...content,
      jobs: content.jobs.map((job) =>
        job.typeId === JOB_COLLECTOR
          ? {
              ...job,
              allowedAtomics: [...job.allowedAtomics, components.TALK_ATOMIC_ID, systems.PRAY_ATOMIC_ID],
            }
          : job,
      ),
    };
    const snapshot = snapshotOf([settler(1, JOB_COLLECTOR), settler(2, JOB_HUNTER)]);
    const collector = allowedActions(talkative, snapshot, [1]);
    expect(collector.has('talk')).toBe(true);
    expect(collector.has('pray')).toBe(true);
    const hunter = allowedActions(talkative, snapshot, [2]);
    expect(hunter.has('talk')).toBe(false);
    expect(hunter.has('pray')).toBe(false);
  });

  it('sends any adult at a settler, the other strikes at men and heroines, the position at fighters', () => {
    const man = allowedActions(content, snapshotOf([settler(1, JOB_COLLECTOR)]), [1]);
    expect(man.has('attackInhabitants')).toBe(true);
    expect(man.has('attackBuilding')).toBe(true);
    expect(man.has('attackPosition')).toBe(false);
    const woman = allowedActions(content, snapshotOf([settler(1, JOB_WOMAN, { female: true })]), [1]);
    expect(woman.has('attackInhabitants')).toBe(true);
    expect(woman.has('attackBuilding')).toBe(false);
    // The sandbox catalog holds no hero trade; the served content names every one of them `hero*`.
    const withHeroine: ContentSet = {
      ...content,
      jobs: content.jobs.map((job) =>
        job.typeId === JOB_WOMAN ? { ...job, id: 'heroine_bow_xena', typeId: JOB_HEROINE_BOW } : job,
      ),
    };
    const heroine = allowedActions(
      withHeroine,
      snapshotOf([settler(1, JOB_HEROINE_BOW, { female: true })]),
      [1],
    );
    expect(heroine.has('attackBuilding')).toBe(true);
    expect(heroine.has('attackPosition')).toBe(true);
    const child = allowedActions(content, snapshotOf([settler(1, JOB_CHILD_MALE, { child: true })]), [1]);
    expect(child.has('attackInhabitants')).toBe(false);
  });

  it('adds the release orders once a post, a home, a site or a drill is held', () => {
    const snapshot = snapshotOf([settler(1, JOB_COLLECTOR, { home: true, workplace: true })]);
    const set = allowedActions(content, snapshot, [1]);
    expect(set.has('removeHome')).toBe(true);
    expect(set.has('removeWorkPlace')).toBe(true);
    expect(set.has('removeBuildingSite')).toBe(false);
    expect(set.has('removeLearningPlace')).toBe(false);
    const pinned = allowedActions(content, snapshotOf([settler(1, JOB_BUILDER, { site: true })]), [1]);
    expect(pinned.has('removeBuildingSite')).toBe(true);
    const drilling = allowedActions(
      content,
      snapshotOf([settler(1, JOB_COLLECTOR, { drilling: true })]),
      [1],
    );
    expect(drilling.has('removeLearningPlace')).toBe(true);
  });

  it('keeps the trade orders from a woman', () => {
    const snapshot = snapshotOf([settler(1, JOB_WOMAN, { female: true })]);
    expect(allowed(snapshot, [1])).toEqual(
      ['assignHome', 'assignVehicle', 'attackInhabitants', 'changeEquipment', 'eat', 'goTo', 'sleep'].sort(),
    );
  });

  it('gives a growing child the walk, the vehicle and the needs alone', () => {
    const snapshot = snapshotOf([settler(1, JOB_CHILD_MALE, { child: true })]);
    expect(allowed(snapshot, [1])).toEqual(['assignVehicle', 'eat', 'goTo', 'sleep']);
  });

  it('shows the work area only once the gatherer carries a flag to draw it around', () => {
    const bare = allowedActions(content, snapshotOf([settler(1, JOB_COLLECTOR)]), [1]);
    expect(bare.has('assignWorkArea')).toBe(true);
    expect(bare.has('showWorkArea')).toBe(false);
    const flagged = allowedActions(content, snapshotOf([settler(1, JOB_COLLECTOR, { workFlag: true })]), [1]);
    expect(flagged.has('showWorkArea')).toBe(true);
  });

  it('offers a soldier the regeneration toggle that flips the state it is in', () => {
    const allowing = allowedActions(content, snapshotOf([settler(1, JOB_SOLDIER)]), [1]);
    expect(allowing.has('prohibitRegeneration')).toBe(true);
    expect(allowing.has('allowRegeneration')).toBe(false);
    const held = allowedActions(
      content,
      snapshotOf([settler(1, JOB_SOLDIER, { noRegeneration: true })]),
      [1],
    );
    expect(held.has('allowRegeneration')).toBe(true);
    expect(held.has('prohibitRegeneration')).toBe(false);
  });

  it('swaps the work area for the building site on a builder and adds the scout orders on a scout', () => {
    const builder = allowedActions(content, snapshotOf([settler(1, JOB_BUILDER)]), [1]);
    expect(builder.has('assignBuildingSite')).toBe(true);
    expect(builder.has('assignWorkArea')).toBe(false);
    expect(builder.has('showWorkArea')).toBe(false);
    const scout = allowedActions(content, snapshotOf([settler(1, JOB_SCOUT)]), [1]);
    expect(scout.has('erectSignpost')).toBe(true);
    expect(scout.has('explore')).toBe(true);
    expect(scout.has('assignBuildingSite')).toBe(false);
  });

  it('offers a soldier the attack position and every mode but the one it holds', () => {
    const snapshot = snapshotOf([settler(1, JOB_SOLDIER, { stance: systems.MILITARY_MODE.ATTACK })]);
    const set = allowedActions(content, snapshot, [1]);
    expect(set.has('attackPosition')).toBe(true);
    expect(set.has('attackInhabitants')).toBe(true);
    expect(set.has('attackMode')).toBe(false);
    expect(set.has('defenceMode')).toBe(true);
    expect(set.has('ignorantMode')).toBe(true);
    // Regeneration is never prohibited here, so the lone soldier is offered the prohibit toggle only.
    expect(set.has('prohibitRegeneration')).toBe(true);
    expect(set.has('allowRegeneration')).toBe(false);
    // A civilian never sees the military orders.
    const civil = allowedActions(content, snapshotOf([settler(1, JOB_COLLECTOR)]), [1]);
    expect(civil.has('attackPosition')).toBe(false);
    expect(civil.has('defenceMode')).toBe(false);
    expect(civil.has('prohibitRegeneration')).toBe(false);
  });
});

describe('allowedActions - family orders', () => {
  it('offers the wedding while an unmarried woman of the tribe stands somewhere', () => {
    const snapshot = snapshotOf([settler(1, JOB_COLLECTOR), settler(2, JOB_WOMAN, { female: true })]);
    expect(allowedActions(content, snapshot, [1]).has('marry')).toBe(true);
  });

  it('drops it while the seeker is off to drill, which the wedding order refuses', () => {
    const snapshot = snapshotOf([
      settler(1, JOB_COLLECTOR, { drilling: true }),
      settler(2, JOB_WOMAN, { female: true }),
    ]);
    expect(allowedActions(content, snapshot, [1]).has('marry')).toBe(false);
  });

  it('drops it when the only woman is bound to a living husband', () => {
    const snapshot = snapshotOf([
      settler(1, JOB_COLLECTOR),
      settler(2, JOB_WOMAN, { female: true, spouse: 3 }),
      settler(3, JOB_COLLECTOR, { spouse: 2 }),
    ]);
    expect(allowedActions(content, snapshot, [1]).has('marry')).toBe(false);
  });

  it('counts neither a foreign tribe woman nor one the snapshot has not placed', () => {
    const snapshot = snapshotOf([
      settler(1, JOB_COLLECTOR),
      settler(2, JOB_WOMAN, { female: true, tribe: TRIBE + 1 }),
      settler(3, JOB_WOMAN, { female: true, unplaced: true }),
    ]);
    expect(allowedActions(content, snapshot, [1]).has('marry')).toBe(false);
  });

  it('offers a wife both children while her husband lives and none of hers is growing', () => {
    const couple = [
      settler(1, JOB_WOMAN, { female: true, spouse: 2 }),
      settler(2, JOB_COLLECTOR, { spouse: 1 }),
    ];
    const wife = allowedActions(content, snapshotOf(couple), [1]);
    expect(wife.has('haveBoy')).toBe(true);
    expect(wife.has('haveGirl')).toBe(true);
    expect(wife.has('marry')).toBe(false);
    // The husband gets no child order, and a growing child blocks the next one.
    expect(allowedActions(content, snapshotOf(couple), [2]).has('haveBoy')).toBe(false);
    const raising = snapshotOf([
      settler(1, JOB_WOMAN, { female: true, spouse: 2, growingChild: 3 }),
      settler(2, JOB_COLLECTOR, { spouse: 1 }),
      settler(3, JOB_CHILD_MALE, { child: true }),
    ]);
    expect(allowedActions(content, raising, [1]).has('haveGirl')).toBe(false);
  });
});

describe('allowedActions - several settlers', () => {
  it('drops the single-settler orders and keeps what every member allows', () => {
    const snapshot = snapshotOf([
      settler(1, JOB_SOLDIER, { stance: systems.MILITARY_MODE.ATTACK }),
      settler(2, JOB_SOLDIER, { stance: systems.MILITARY_MODE.DEFEND }),
    ]);
    // A group is offered all three modes and both regeneration toggles whatever each member holds.
    expect(allowed(snapshot, [1, 2])).toEqual(
      [
        'allowRegeneration',
        'attackAnimal',
        'attackBuilding',
        'attackInhabitants',
        'attackMode',
        'attackPosition',
        'attackVehicle',
        'changeProfession',
        'defenceMode',
        'eat',
        'ignorantMode',
        'prohibitRegeneration',
        'sleep',
      ].sort(),
    );
  });

  it('withholds an order one member refuses', () => {
    const snapshot = snapshotOf([settler(1, JOB_SOLDIER), settler(2, JOB_COLLECTOR)]);
    const set = allowedActions(content, snapshot, [1, 2]);
    expect(set.has('attackPosition')).toBe(false);
    expect(set.has('defenceMode')).toBe(false);
    // Both are adult men, so the strikes every adult may run survive the intersection.
    expect(set.has('attackInhabitants')).toBe(true);
    expect(set.has('changeProfession')).toBe(true);
  });
});

describe('hasEligiblePartner memo', () => {
  // No woman: the pass runs to the end instead of stopping at a match, the worst case the memo is for.
  const seeker = settler(1, JOB_COLLECTOR);
  const entities = [seeker, settler(2, JOB_COLLECTOR)];

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
    const grown = snapshotOf([...entities, settler(3, JOB_WOMAN, { female: true })]);
    expect(hasEligiblePartner(content, grown, seeker)).toBe(true);
  });
});
