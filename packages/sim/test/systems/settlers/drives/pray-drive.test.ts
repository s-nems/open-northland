import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  addCurrentAtomic,
  Building,
  CurrentAtomic,
  HomeQuality,
  MoveGoal,
  NeedOrder,
  Owner,
  Position,
  Residence,
  Resting,
  SettlerNeeds,
  UnderConstruction,
} from '../../../../src/components/index.js';
import type { Entity } from '../../../../src/ecs/world.js';
import { type Fixed, fx, ONE, positionOfNode, Simulation } from '../../../../src/index.js';
import { setHouseholdGoodUse } from '../../../../src/systems/family/home-quality.js';
import {
  atomicSystem,
  NEED_CRITICAL_THRESHOLD,
  NEED_SATED_THRESHOLD,
  needBar,
  plannerSystem,
} from '../../../../src/systems/index.js';
import { isServedAtHome } from '../../../../src/systems/settlers/drives/home-errands.js';
import { prayerStand } from '../../../../src/systems/settlers/drives/prayer-stand.js';
import { PlannerSpacing } from '../../../../src/systems/settlers/planner/spacing.js';
import { TEMPLE_PREFERRED_RANGE } from '../../../../src/systems/settlers/targets/stores/buildings.js';
import { NodeBuckets } from '../../../../src/systems/spatial/nodes.js';
import { testContent } from '../../../fixtures/content.js';
import { nextTickCtxOf } from '../../../fixtures/context.js';
import {
  cellOf,
  ctxOf,
  grassMap,
  justAbove,
  NEED_DRIVE_THRESHOLD,
  needsSettlerAt,
  treeAt,
} from '../../../fixtures/needs.js';
import { needsOf } from '../../../fixtures/settler.js';

/**
 * Unit + integration tests for the PRAY DRIVE - the planner choosing a `pray` atomic (id 12, the
 * original's `MAP_MOVEABLES_ATOMIC_ACTION_TYPE_PRAY`) when a settler's piety crosses the threshold,
 * WALKING TO A PRAYER SITE (its lit home, else a temple, else its headquarters) and
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

// The anchor-only fixtures use a south-west stand, one hex off the building.
function prayerNode(sim: Simulation, x: number) {
  return sim.terrain?.nodeAt(2 * x - 1, 1);
}

function standBefore(sim: Simulation, settler: Entity, x: number): void {
  Object.assign(sim.world.mut(settler, Position), positionOfNode(2 * x - 1, 1));
}

describe('prayDrive - the planner choosing to pray (target-bound: walk to a temple)', () => {
  it('automatically seeks prayer for a consuming trade without the authored religion flag', () => {
    const base = testContent();
    const content = parseContentSet({
      ...base,
      jobs: base.jobs.map((job) => (job.typeId === SMITH ? { ...job, needsReligion: false } : job)),
      tribes: base.tribes.map((tribe) =>
        tribe.typeId === VIKING
          ? {
              ...tribe,
              atomicBindings: [
                ...tribe.atomicBindings,
                { jobType: SMITH, atomicId: 24, animation: 'viking_chop' },
              ],
            }
          : tribe,
      ),
      atomicAnimations: base.atomicAnimations.map((clip) =>
        clip.id === 'viking_chop'
          ? { ...clip, events: [...clip.events, { at: 1, type: 4, value: -1500 }] }
          : clip,
      ),
    });
    const sim = new Simulation({ seed: 1, content, map: grassMap(6, 1) });
    const settler = settlerAt(sim, 0, 0, DEVOUT);
    templeAt(sim, 4, 0);
    plannerSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(settler, MoveGoal).cell).toBe(prayerNode(sim, 4));
  });

  it('walks to the nearest temple when piety crosses the threshold (no atomic yet - must arrive)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    const settler = settlerAt(sim, 0, 0, DEVOUT);
    templeAt(sim, 4, 0);
    // A tree to harvest exists, but the devout settler heads for the temple instead.
    treeAt(sim, 2, 0);

    plannerSystem(sim.world, ctxOf(sim));

    // Not on the temple yet: a MoveGoal to it, no atomic started.
    expect(sim.world.has(settler, CurrentAtomic)).toBe(false);
    expect(sim.world.get(settler, MoveGoal).cell).toBe(prayerNode(sim, 4));
    expect(sim.world.get(settler, MoveGoal).cell).not.toBe(cellOf(sim, 2, 0));
  });

  it('starts a pray atomic (duration from content) once standing one hex before the temple', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const settler = settlerAt(sim, 3, 0, DEVOUT);
    templeAt(sim, 3, 0);
    standBefore(sim, settler, 3);

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

describe('pray atomic - replenishing religion (AtomicSystem)', () => {
  it.each(['hunger', 'fatigue', 'no benefit'] as const)(
    'does not repeat prayer when there is %s',
    (reason) => {
      const base = testContent();
      const content =
        reason === 'no benefit'
          ? parseContentSet({
              ...base,
              atomicAnimations: base.atomicAnimations.map((clip) =>
                clip.id === 'viking_pray' ? { ...clip, events: [] } : clip,
              ),
            })
          : base;
      const sim = new Simulation({ seed: 1, content, map: grassMap(3, 1) });
      const settler = settlerAt(sim, 0, 0, DEVOUT);
      const temple = templeAt(sim, 0, 0);
      if (reason !== 'no benefit') sim.world.mut(settler, SettlerNeeds)[reason] = DEVOUT;
      addCurrentAtomic(sim.world, settler, {
        atomicId: PRAY_ATOMIC,
        duration: PRAY_CLIP_TICKS,
        effect: { kind: 'pray' },
        targetEntity: temple,
        targetTile: null,
      });
      for (let i = 0; i < PRAY_CLIP_TICKS; i++) atomicSystem(sim.world, nextTickCtxOf(sim));
      expect(sim.world.has(settler, CurrentAtomic)).toBe(false);
      expect(needsOf(sim, settler).piety).toBeGreaterThan(0);
    },
  );

  it('repeats the clip below the drive threshold until the reserve is full', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(3, 1) });
    const settler = settlerAt(sim, 0, 0, DEVOUT);
    const temple = templeAt(sim, 0, 0);
    addCurrentAtomic(sim.world, settler, {
      atomicId: PRAY_ATOMIC,
      duration: PRAY_CLIP_TICKS,
      effect: { kind: 'pray' },
      targetEntity: temple,
      targetTile: null,
    });

    for (let i = 0; i < PRAY_CLIP_TICKS; i++) atomicSystem(sim.world, nextTickCtxOf(sim));

    // One clip pays only its authored pulses; the visit continues even below the drive threshold.
    expect(needsOf(sim, settler).piety).toBe(fx.sub(DEVOUT, PRAYER));
    expect(needsOf(sim, settler).piety).toBeLessThan(NEED_DRIVE_THRESHOLD);
    expect(sim.world.get(settler, CurrentAtomic).effect.kind).toBe('pray');
    for (let i = 0; i < 100 && sim.world.has(settler, CurrentAtomic); i++)
      atomicSystem(sim.world, nextTickCtxOf(sim));
    expect(needsOf(sim, settler).piety).toBeLessThanOrEqual(0);
    expect(sim.world.has(settler, CurrentAtomic)).toBe(false);
  });

  it('lets a movement order interrupt a prayer visit before the reserve is full', () => {
    const sim = new Simulation({ seed: 1, content: oilContent(), map: grassMap(8, 2) });
    const home = litHomeAt(sim, 4);
    const settler = devoutAt(sim, 4, home);
    standBefore(sim, settler, 4);
    sim.step();
    expect(sim.world.get(settler, CurrentAtomic).effect.kind).toBe('pray');
    sim.enqueueSetup({ kind: 'moveUnit', entity: settler, x: 0, y: 0 });
    for (
      let i = 0;
      i <= PRAY_CLIP_TICKS && sim.world.tryGet(settler, CurrentAtomic)?.effect.kind === 'pray';
      i++
    )
      sim.step();
    expect(sim.world.tryGet(settler, CurrentAtomic)?.effect.kind).not.toBe('pray');
    expect(sim.world.get(settler, MoveGoal).cell).toBe(sim.terrain?.nodeAt(0, 0));
    expect(needsOf(sim, settler).piety).toBeGreaterThan(0);
  });
});

describe('pray drive - closing the forge→pray→relief loop through the real schedule', () => {
  it('a devout settler walks to the temple and fills its religion reserve', () => {
    const sim = new Simulation({ seed: 3, content: testContent(), map: grassMap(4, 1) });
    // Start near the threshold so it crosses within a short headless run; temple a couple cells away.
    const settler = settlerAt(sim, 0, 0, NEED_DRIVE_THRESHOLD);
    templeAt(sim, 3, 0);

    const peakPiety = needsOf(sim, settler).piety;
    let troughPiety = peakPiety;
    for (let i = 0; i < 400; i++) {
      sim.step();
      const p = needsOf(sim, settler).piety;
      if (p < troughPiety) troughPiety = p;
    }

    expect(troughPiety).toBeLessThanOrEqual(0);
    expect(sim.world.tryGet(settler, CurrentAtomic)?.effect.kind).not.toBe('pray');
    expect(peakPiety).toBeLessThanOrEqual(ONE); // never breached the pietyInRange ceiling
    expect(sim.checkInvariants()).toEqual([]);
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

/** A home of {@link PLAYER} holding oil, whose policy lets it burn. */
function litHomeAt(sim: Simulation, x: number): Entity {
  const home = ownedAt(sim, x, HOME_TYPE);
  sim.world.add(home, HomeQuality, { cooking: 0, rest: 0, piety: LIT });
  setHouseholdGoodUse(sim.world, ctxOf(sim), { player: PLAYER, effect: 'piety', allowed: true });
  return home;
}

describe('where a devout settler prays: its holy fire, then a temple, then the headquarters', () => {
  it.each([
    [-3, 3, 7, 14],
    [3, 3, 14, 14],
    [-3, 0, 6, 10],
    [3, 0, 14, 10],
  ])('backs one hex away from an entrance at (%i, %i)', (dx, dy, x, y) => {
    const base = testContent();
    const content = parseContentSet({
      ...base,
      buildings: base.buildings.map((type) =>
        type.typeId === TEMPLE_TYPE
          ? { ...type, footprint: { blocked: [{ dx: 0, dy: 0 }], door: { dx, dy } } }
          : type,
      ),
    });
    const sim = new Simulation({ seed: 1, content, map: grassMap(12, 12) });
    const temple = templeAt(sim, 5, 5);
    Object.assign(sim.world.mut(temple, Position), positionOfNode(10, 10));
    const settler = devoutAt(sim, 1);
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('missing terrain');
    const spacing = PlannerSpacing.forTick(sim.world, ctxOf(sim), terrain);
    const stand = prayerStand(
      sim.world,
      ctxOf(sim),
      terrain,
      settler,
      temple,
      terrain.nodeAt(2, 0),
      spacing,
      null,
    );
    expect(stand).toBe(terrain.nodeAt(x, y));
    expect(
      prayerStand(sim.world, ctxOf(sim), terrain, settler, temple, terrain.nodeAt(x, y), spacing, null),
    ).toBe(stand);
  });

  it.each(['extinguished', 'destroyed', 'upgrading'] as const)(
    'ends prayer at an %s home before another religion pulse',
    (change) => {
      const sim = new Simulation({ seed: 1, content: oilContent(), map: grassMap(8, 1) });
      const home = litHomeAt(sim, 4);
      const settler = devoutAt(sim, 4, home);
      standBefore(sim, settler, 4);
      plannerSystem(sim.world, ctxOf(sim));
      expect(sim.world.get(settler, CurrentAtomic).effect.kind).toBe('pray');
      const before = needsOf(sim, settler).piety;
      if (change === 'extinguished') sim.world.mut(home, HomeQuality).piety = 0;
      else if (change === 'destroyed') sim.world.destroy(home);
      else sim.world.add(home, UnderConstruction, { labor: fx.fromInt(0) });
      atomicSystem(sim.world, nextTickCtxOf(sim));
      expect(sim.world.has(settler, CurrentAtomic)).toBe(false);
      expect(needsOf(sim, settler).piety).toBe(before);
    },
  );

  it('uses distinct exterior stands when the entrance is blocked and stays at an arrived stand', () => {
    const sim = new Simulation({ seed: 1, content: oilContent(), map: grassMap(8, 5) });
    const temple = ownedAt(sim, 4, TEMPLE_TYPE);
    const first = devoutAt(sim, 1);
    const second = devoutAt(sim, 2);
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('missing terrain');
    const door = cellOf(sim, 4, 0);
    const firstCell = cellOf(sim, 1, 0);
    const secondCell = cellOf(sim, 2, 0);
    if (door === undefined || firstCell === undefined || secondCell === undefined)
      throw new Error('missing node');
    const spacing = PlannerSpacing.overExplicit(
      sim.world,
      ctxOf(sim),
      terrain,
      new NodeBuckets(sim.world, [first, second]),
      new Set([door, terrain.nodeAt(7, 1)]),
    );
    const firstStand = prayerStand(sim.world, ctxOf(sim), terrain, first, temple, firstCell, spacing, null);
    expect(firstStand).not.toBeNull();
    expect(firstStand).not.toBe(door);
    if (firstStand === null) throw new Error('missing stand');
    expect(prayerStand(sim.world, ctxOf(sim), terrain, first, temple, firstStand, spacing, null)).toBe(
      firstStand,
    );
    spacing.claim(firstStand);
    const secondStand = prayerStand(
      sim.world,
      ctxOf(sim),
      terrain,
      second,
      temple,
      secondCell,
      spacing,
      null,
    );
    expect(secondStand).not.toBeNull();
    expect(secondStand).not.toBe(firstStand);
    expect(secondStand).not.toBe(door);
  });

  it('walks home to its burning holy fire past a nearer temple', () => {
    const sim = new Simulation({ seed: 1, content: oilContent(), map: grassMap(8, 1) });
    ownedAt(sim, 3, TEMPLE_TYPE);
    const settler = devoutAt(sim, 2, litHomeAt(sim, 6));

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(settler, MoveGoal).cell).toBe(prayerNode(sim, 6));
  });

  it('prays one hex before its own door without entering the home', () => {
    const sim = new Simulation({ seed: 1, content: oilContent(), map: grassMap(8, 1) });
    const home = litHomeAt(sim, 4);
    const settler = devoutAt(sim, 4, home);
    standBefore(sim, settler, 4);

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(settler, Resting)).toBe(false);
    expect(sim.world.get(settler, CurrentAtomic).effect).toEqual({ kind: 'pray' });
    expect(isServedAtHome(sim.world, settler)).toBe(false);
  });

  it('does not count a temple prayer said from its doorstep as a prayer at home', () => {
    const sim = new Simulation({ seed: 1, content: oilContent(), map: grassMap(8, 1) });
    const home = litHomeAt(sim, 4);
    const temple = ownedAt(sim, 4, TEMPLE_TYPE);
    const settler = devoutAt(sim, 4, home);
    sim.world.add(settler, Resting, { at: home });
    addCurrentAtomic(sim.world, settler, {
      atomicId: PRAY_ATOMIC,
      duration: PRAY_CLIP_TICKS,
      effect: { kind: 'pray' },
      targetEntity: temple,
      targetTile: null,
    });

    expect(isServedAtHome(sim.world, settler)).toBe(false);
  });

  it('passes its burning holy fire by for the temple when its trade never goes home', () => {
    const base = oilContent();
    const content = parseContentSet({
      ...base,
      jobs: base.jobs.map((job) => (job.typeId === SMITH ? { ...job, ignoresHomeHouse: true } : job)),
    });
    const sim = new Simulation({ seed: 1, content, map: grassMap(8, 1) });
    const temple = ownedAt(sim, 3, TEMPLE_TYPE);
    const settler = devoutAt(sim, 2, litHomeAt(sim, 6));

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(settler, CurrentAtomic).targetEntity).toBe(temple);
  });

  it('goes to the temple when its home fire is out', () => {
    const sim = new Simulation({ seed: 1, content: oilContent(), map: grassMap(8, 1) });
    const temple = ownedAt(sim, 3, TEMPLE_TYPE);
    const settler = devoutAt(sim, 2, ownedAt(sim, 6, HOME_TYPE));

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(settler, CurrentAtomic).targetEntity).toBe(temple);
  });

  it('keeps praying at its lit home when oil deliveries are forbidden', () => {
    const sim = new Simulation({ seed: 1, content: oilContent(), map: grassMap(8, 1) });
    ownedAt(sim, 3, TEMPLE_TYPE);
    const settler = devoutAt(sim, 2, litHomeAt(sim, 6));
    setHouseholdGoodUse(sim.world, ctxOf(sim), { player: PLAYER, effect: 'piety', allowed: false });

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(settler, MoveGoal).cell).toBe(prayerNode(sim, 6));
  });

  it('prays at its own headquarters when it has no temple, not at a rival one', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 1) });
    ownedAt(sim, 1, HQ_TYPE, RIVAL);
    ownedAt(sim, 6, HQ_TYPE);
    const settler = devoutAt(sim, 2);

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(settler, MoveGoal).cell).toBe(prayerNode(sim, 6));
  });

  it('prefers a temple to a nearer headquarters', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 1) });
    ownedAt(sim, 3, HQ_TYPE);
    ownedAt(sim, 7, TEMPLE_TYPE);
    const settler = devoutAt(sim, 2);

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(settler, MoveGoal).cell).toBe(prayerNode(sim, 7));
  });

  it('prays at a nearer headquarters when its nearest temple lies beyond the preferred range', () => {
    // A cell is two map points along a row, so a temple this many cells away is past the range.
    const farCells = TEMPLE_PREFERRED_RANGE / 2 + 2;
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(farCells + 4, 1) });
    ownedAt(sim, 5, HQ_TYPE);
    ownedAt(sim, 2 + farCells, TEMPLE_TYPE);
    const settler = devoutAt(sim, 2);

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(settler, MoveGoal).cell).toBe(prayerNode(sim, 5));
  });

  it('warns a human seat whose settler has nowhere to pray, and settles a computer seat one instead', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 1) });
    const human = settlerAt(sim, 2, 0, NEED_CRITICAL_THRESHOLD);
    sim.world.add(human, Owner, { player: PLAYER });
    const computer = settlerAt(sim, 4, 0, DEVOUT);
    sim.world.add(computer, Owner, { player: RIVAL });
    sim.enqueueSetup({ kind: 'setAiControl', player: RIVAL, enabled: true });

    sim.step();

    const missing = sim
      .snapshot()
      .events.flatMap((ev) => (ev.kind === 'prayerSiteMissing' ? [ev.entity] : []));
    expect(missing).toEqual([human]);
    expect(needsOf(sim, computer).piety).toBe(NEED_SATED_THRESHOLD);
  });

  it('warns no one while the bar searches below the level the HUD marks a need at', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 1) });
    devoutAt(sim, 2);

    sim.step();

    expect(sim.snapshot().events.some((ev) => ev.kind === 'prayerSiteMissing')).toBe(false);
  });

  it('warns a human seat whose ordered prayer finds nowhere to go, whatever its bar reads', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 1) });
    const settler = settlerAt(sim, 2, 0, NEED_SATED_THRESHOLD);
    sim.world.add(settler, Owner, { player: PLAYER });
    sim.world.add(settler, NeedOrder, { need: 'piety' });

    sim.step();

    const missing = sim
      .snapshot()
      .events.flatMap((ev) => (ev.kind === 'prayerSiteMissing' ? [ev.entity] : []));
    expect(missing).toEqual([settler]);
    expect(sim.world.get(settler, NeedOrder).need).toBe('piety');
  });

  it('warns nobody for an ownerless settler with nowhere to pray', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 1) });
    settlerAt(sim, 2, 0, DEVOUT);

    sim.step();

    expect(sim.snapshot().events.some((ev) => ev.kind === 'prayerSiteMissing')).toBe(false);
  });
});
