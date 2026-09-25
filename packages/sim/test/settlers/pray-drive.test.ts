import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  addCurrentAtomic,
  Building,
  CurrentAtomic,
  HomeQuality,
  MoveGoal,
  Owner,
  Position,
  Residence,
  Resting,
  Settler,
  UnderConstruction,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { type Fixed, fx, ONE, Simulation } from '../../src/index.js';
import { setHouseholdGoodUse } from '../../src/systems/family/home-quality.js';
import { atomicSystem, NEED_SATED_THRESHOLD, needBar, plannerSystem } from '../../src/systems/index.js';
import { isServedAtHome } from '../../src/systems/settlers/drives/home-errands.js';
import { testContent } from '../fixtures/content.js';
import {
  cellOf,
  ctxOf,
  grassMap,
  justAbove,
  NEED_DRIVE_THRESHOLD,
  needsSettlerAt,
  treeAt,
} from './needs/support.js';

/**
 * Unit + integration tests for the PRAY DRIVE - the planner choosing a `pray` atomic (id 12, the
 * original's `MAP_MOVEABLES_ATOMIC_ACTION_TYPE_PRAY`) when a settler's piety crosses the threshold,
 * WALKING TO A TEMPLE (the first target-bound need - unlike eat at a store / sleep in place) and
 * zeroing piety on completion, closing the NeedsSystem's rise→pray→reset loop.
 *
 * The viking tribe binds pray atomic 12 → "viking_pray" (length 7); the pray atomic id (12) is pinned
 * to the original `setatomic 6 12 "..._pray"` bindings, and the temple is the type content marks
 * `prayerSite: 'temple'` (the original's logictype 37).
 */

const VIKING = 1;
const TEMPLE_TYPE = 3;
/** The fixture smithy: a workplace with no workers, stock or recipe, like the temple, but no prayer site. */
const SMITHY_TYPE = 4;
/** The fixture's `needsReligionFlag` trade: only such a settler leaves its work to pray. */
const SMITH = 13;
/** A trade with no religion need, which the fixture also lets fell wood. */
const WOODCUTTER = 1;
/** The fixture pray clip's length, and what its five `event <at> 4 +800` pulses are worth. Each pulse
 *  converts to the bar on its own frame, so the prayer is five conversions, not one of their sum. */
const PRAY_CLIP_TICKS = 7;
const PRAYER: Fixed = fx.mul(needBar(800), fx.fromInt(5));
const PRAY_ATOMIC = 12;
// Just over the drive threshold - a settler this devout-overdue prays before any work.
const DEVOUT: Fixed = justAbove(NEED_DRIVE_THRESHOLD);
// Comfortably below the threshold - a piety-satisfied settler ignores the pray drive and works.
const PIOUS: Fixed = fx.div(ONE, fx.fromInt(2));

function settlerAt(
  sim: Simulation,
  x: number,
  y: number,
  piety: Fixed,
  fatigue = fx.fromInt(0),
  hunger = fx.fromInt(0),
): Entity {
  return needsSettlerAt(sim, x, y, { hunger, fatigue, piety }, SMITH);
}

function templeAt(sim: Simulation, x: number, y: number, buildingType = TEMPLE_TYPE): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Building, { buildingType, tribe: VIKING, built: ONE, level: 0 });
  return e;
}

describe('prayDrive - the planner choosing to pray (target-bound: walk to a temple)', () => {
  it('walks to the nearest temple when piety crosses the threshold (no atomic yet - must arrive)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    const settler = settlerAt(sim, 0, 0, DEVOUT);
    const temple = templeAt(sim, 4, 0);
    // A tree to harvest exists, but the devout settler heads for the temple instead.
    treeAt(sim, 2, 0);

    plannerSystem(sim.world, ctxOf(sim));

    // Not on the temple yet: a MoveGoal to it, no atomic started.
    expect(sim.world.has(settler, CurrentAtomic)).toBe(false);
    expect(sim.world.get(settler, MoveGoal).cell).toBe(cellOf(sim, 4, 0));
    // Temple is at (4,0); confirm the goal is the temple's cell, not the tree's.
    expect(sim.world.get(settler, MoveGoal).cell).toBe(
      cellOf(sim, fx.toInt(sim.world.get(temple, Position).x), 0),
    );
  });

  it('starts a pray atomic (duration from content) once standing on the temple', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const settler = settlerAt(sim, 3, 0, DEVOUT);
    templeAt(sim, 3, 0); // settler is already on the temple cell

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(settler, MoveGoal)).toBe(false); // already here - no walk
    const atomic = sim.world.get(settler, CurrentAtomic);
    expect(atomic.atomicId).toBe(PRAY_ATOMIC);
    expect(atomic.duration).toBe(7); // viking setatomic 12 -> "viking_pray" length 7
    expect(atomic.effect).toEqual({ kind: 'pray' });
  });

  it('ignores the pray drive below the threshold (a satisfied settler works normally)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const settler = settlerAt(sim, 0, 0, PIOUS);
    templeAt(sim, 4, 0);
    treeAt(sim, 3, 0);

    plannerSystem(sim.world, ctxOf(sim));

    // Headed for the wood, not the temple - the pray drive did not fire.
    expect(sim.world.has(settler, CurrentAtomic)).toBe(false);
    expect(sim.world.get(settler, MoveGoal).cell).toBe(cellOf(sim, 3, 0));
  });

  it('falls through to work when devout but no temple exists (piety has no satisfier)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const settler = settlerAt(sim, 0, 0, DEVOUT);
    treeAt(sim, 3, 0); // wood but no temple anywhere

    plannerSystem(sim.world, ctxOf(sim));

    // No temple to pray at: the settler works (heads for the tree) instead of stalling.
    expect(sim.world.has(settler, CurrentAtomic)).toBe(false);
    expect(sim.world.get(settler, MoveGoal).cell).toBe(cellOf(sim, 3, 0));
  });

  it('passes a temple still under construction by', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const settler = settlerAt(sim, 0, 0, DEVOUT);
    const site = templeAt(sim, 4, 0);
    sim.world.mut(site, Building).built = fx.fromInt(0);
    sim.world.add(site, UnderConstruction, { labor: fx.fromInt(0) });
    treeAt(sim, 3, 0);

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(settler, MoveGoal).cell).toBe(cellOf(sim, 3, 0)); // headed for the wood
  });

  it('does not take a workplace with no workers or recipe for a temple', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const settler = settlerAt(sim, 0, 0, DEVOUT);
    templeAt(sim, 4, 0, SMITHY_TYPE);
    treeAt(sim, 3, 0);

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(settler, MoveGoal).cell).toBe(cellOf(sim, 3, 0)); // headed for the wood
  });

  it('leaves a trade with no religion need at its work, however overdue its piety bar', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    // A woodcutter carries the same bar and can even spend it forging, but `jobtypes.ini` marks only the
    // joiner, armorer and smith `needsReligionFlag`, so no temple is ever an errand for him.
    const settler = needsSettlerAt(sim, 0, 0, { piety: DEVOUT }, WOODCUTTER);
    templeAt(sim, 4, 0);
    treeAt(sim, 3, 0);

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(settler, MoveGoal).cell).toBe(cellOf(sim, 3, 0)); // headed for the wood
  });

  it('sleeps before praying when both needs are over the threshold (sleep outranks pray)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    // Both devout AND tired; sleep is in place, so it resolves on the spot.
    const settler = settlerAt(sim, 3, 0, DEVOUT, DEVOUT);
    templeAt(sim, 3, 0);

    plannerSystem(sim.world, ctxOf(sim));

    const atomic = sim.world.get(settler, CurrentAtomic);
    expect(atomic.atomicId).toBe(8); // SLEEP - survival needs outrank devotion
    expect(atomic.effect.kind).toBe('sleep');
  });
});

describe('pray atomic - taking one prayer off piety (AtomicSystem)', () => {
  it('takes one prayer off piety and consumes no goods', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(3, 1) });
    const settler = settlerAt(sim, 0, 0, DEVOUT);
    addCurrentAtomic(sim.world, settler, {
      atomicId: PRAY_ATOMIC,
      duration: PRAY_CLIP_TICKS,
      effect: { kind: 'pray' },
      targetEntity: settler,
      targetTile: null,
    });

    for (let i = 0; i < PRAY_CLIP_TICKS; i++) atomicSystem(sim.world, ctxOf(sim));

    // A prayer is a partial refill, not a reset: a smith comes back to the temple every few items.
    expect(sim.world.get(settler, Settler).piety).toBe(fx.sub(DEVOUT, PRAYER));
    expect(sim.world.has(settler, CurrentAtomic)).toBe(false); // atomic done
  });
});

describe('pray drive - closing the forge→pray→relief loop through the real schedule', () => {
  it('a devout settler walks to the temple and a prayer comes off its piety', () => {
    const sim = new Simulation({ seed: 3, content: testContent(), map: grassMap(4, 1) });
    // Start near the threshold so it crosses within a short headless run; temple a couple cells away.
    const settler = settlerAt(sim, 0, 0, NEED_DRIVE_THRESHOLD);
    templeAt(sim, 3, 0);

    const peakPiety = sim.world.get(settler, Settler).piety;
    let troughPiety = peakPiety;
    for (let i = 0; i < 400; i++) {
      sim.step();
      const p = sim.world.get(settler, Settler).piety;
      if (p < troughPiety) troughPiety = p;
    }

    // The loop closed: the settler walked to the temple and one prayer came off the bar. Piety never
    // rises on its own, so the peak is where it started.
    expect(troughPiety).toBe(fx.sub(peakPiety, PRAYER));
    expect(peakPiety).toBeLessThanOrEqual(ONE); // never breached the pietyInRange ceiling
    expect(sim.checkInvariants()).toEqual([]);
  });

  it('is byte-identical across two same-seed runs (determinism)', () => {
    const run = (): string => {
      const sim = new Simulation({ seed: 5, content: testContent(), map: grassMap(4, 1) });
      settlerAt(sim, 0, 0, NEED_DRIVE_THRESHOLD);
      templeAt(sim, 3, 0);
      for (let i = 0; i < 400; i++) sim.step();
      return sim.hashState();
    };
    expect(run()).toBe(run());
  });
});

const HQ_TYPE = 1;
const HOME_TYPE = 90;
const HOLY_OIL = 99;
const PLAYER = 0;
const RIVAL = 1;
/** One delivery's worth of burning holy fire. */
const LIT = 1000;

/** The shared fixture plus a home that burns holy oil for its residents' prayers. */
function oilContent(): ContentSet {
  const base = testContent();
  return parseContentSet({
    ...base,
    goods: [
      ...base.goods,
      {
        typeId: HOLY_OIL,
        id: 'holy_oil',
        homeQuality: {
          effect: 'piety',
          deliveryValue: LIT,
          capacity: 5000,
          useCost: 3,
          fetchBelow: 3000,
          minimumHomeLevel: 0,
        },
      },
    ],
    buildings: [...base.buildings, { typeId: HOME_TYPE, id: 'home_small', kind: 'home', homeSize: 2 }],
  });
}

function ownedAt(sim: Simulation, x: number, buildingType: number, player = PLAYER): Entity {
  const e = templeAt(sim, x, 0, buildingType);
  sim.world.add(e, Owner, { player });
  return e;
}

/** A devout smith of {@link PLAYER} at cell (x, 0), living in `home` when one is given. */
function devoutAt(sim: Simulation, x: number, home?: Entity): Entity {
  const e = settlerAt(sim, x, 0, DEVOUT);
  sim.world.add(e, Owner, { player: PLAYER });
  if (home !== undefined) sim.world.add(e, Residence, { home });
  return e;
}

function litHomeAt(sim: Simulation, x: number): Entity {
  const home = ownedAt(sim, x, HOME_TYPE);
  sim.world.add(home, HomeQuality, { cooking: 0, rest: 0, piety: LIT });
  return home;
}

describe('where a devout settler prays: its holy fire, then a temple, then the headquarters', () => {
  it('walks home to its burning holy fire past a nearer temple', () => {
    const sim = new Simulation({ seed: 1, content: oilContent(), map: grassMap(8, 1) });
    ownedAt(sim, 3, TEMPLE_TYPE);
    const settler = devoutAt(sim, 2, litHomeAt(sim, 6));

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(settler, MoveGoal).cell).toBe(cellOf(sim, 6, 0));
  });

  it('prays inside at its own door and stays in for the prayer', () => {
    const sim = new Simulation({ seed: 1, content: oilContent(), map: grassMap(8, 1) });
    const home = litHomeAt(sim, 4);
    const settler = devoutAt(sim, 4, home);

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(settler, Resting).at).toBe(home);
    expect(sim.world.get(settler, CurrentAtomic).effect).toEqual({ kind: 'pray' });
    expect(isServedAtHome(sim.world, settler)).toBe(true);
  });

  it('goes to the temple when its home fire is out', () => {
    const sim = new Simulation({ seed: 1, content: oilContent(), map: grassMap(8, 1) });
    ownedAt(sim, 3, TEMPLE_TYPE);
    const settler = devoutAt(sim, 2, ownedAt(sim, 6, HOME_TYPE));

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(settler, MoveGoal).cell).toBe(cellOf(sim, 3, 0));
  });

  it('goes to the temple when its player forbids burning holy oil', () => {
    const sim = new Simulation({ seed: 1, content: oilContent(), map: grassMap(8, 1) });
    ownedAt(sim, 3, TEMPLE_TYPE);
    const settler = devoutAt(sim, 2, litHomeAt(sim, 6));
    setHouseholdGoodUse(sim.world, ctxOf(sim), { player: PLAYER, effect: 'piety', allowed: false });

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(settler, MoveGoal).cell).toBe(cellOf(sim, 3, 0));
  });

  it('prays at its own headquarters when it has no temple, not at a rival one', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 1) });
    ownedAt(sim, 1, HQ_TYPE, RIVAL);
    ownedAt(sim, 6, HQ_TYPE);
    const settler = devoutAt(sim, 2);

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(settler, MoveGoal).cell).toBe(cellOf(sim, 6, 0));
  });

  it('prefers a temple to a nearer headquarters', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 1) });
    ownedAt(sim, 3, HQ_TYPE);
    ownedAt(sim, 7, TEMPLE_TYPE);
    const settler = devoutAt(sim, 2);

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(settler, MoveGoal).cell).toBe(cellOf(sim, 7, 0));
  });

  it('warns a human seat whose settler has nowhere to pray, and settles a computer seat one instead', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 1) });
    const human = devoutAt(sim, 2);
    const computer = settlerAt(sim, 4, 0, DEVOUT);
    sim.world.add(computer, Owner, { player: RIVAL });
    sim.enqueueSetup({ kind: 'setPlayerAi', player: RIVAL, enabled: true });

    sim.step();

    const missing = sim
      .snapshot()
      .events.flatMap((ev) => (ev.kind === 'prayerSiteMissing' ? [ev.entity] : []));
    expect(missing).toEqual([human]);
    expect(sim.world.get(computer, Settler).piety).toBe(NEED_SATED_THRESHOLD);
  });
});
