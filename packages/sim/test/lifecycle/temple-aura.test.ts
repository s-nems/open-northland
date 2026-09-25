import { describe, expect, it } from 'vitest';
import { Building, Health, Owner, Position, Settler, UnderConstruction } from '../../src/components/index.js';
import { setNeedsEnabled } from '../../src/components/rules.js';
import { ULP } from '../../src/core/fixed.js';
import { TICKS_PER_SECOND } from '../../src/core/loop.js';
import type { Entity } from '../../src/ecs/world.js';
import { type Fixed, fx, ONE, Simulation } from '../../src/index.js';
import { positionOfNode } from '../../src/nav/halfcell.js';
import type { SystemContext } from '../../src/systems/index.js';
import { applyNeedUnits, NEED_SATED_THRESHOLD } from '../../src/systems/lifecycle/needs/index.js';
import {
  blessedHitpointCeiling,
  TEMPLE_AURA_HITPOINTS,
  TEMPLE_AURA_PIETY_UNITS,
  TEMPLE_AURA_RANGE,
  templeAuraSystem,
} from '../../src/systems/lifecycle/temple-aura.js';
import { SYSTEM_ORDER } from '../../src/systems/schedule.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
import { settlerAt } from '../fixtures/settler.js';
import { grassNodeMap } from '../fixtures/terrain.js';

const VIKING = 1;
const TEMPLE_TYPE = 3;
const SAWMILL_TYPE = 2;
/** The fixture headquarters: a prayer site, but not a temple, so it blesses nobody. */
const HEADQUARTERS_TYPE = 1;
const TEMPLE_HITPOINTS = 1000;
const OWNER = 0;
const RIVAL = 1;
/** A woodcutter: a trade that never prays, which the blessing still reaches. */
const WOODCUTTER = 1;
const POOL = 300;
/** A bar a little more worn than the sated level, so one blessing still applies. */
const WORN: Fixed = fx.add(NEED_SATED_THRESHOLD, ULP);
/** The row the temple and every settler stand on, so the hex distance is the column gap alone. */
const ROW = 0;

function fresh(): Simulation {
  return new Simulation({ seed: 1, content: testContent(), map: grassNodeMap(128, 4) });
}

function templeAt(sim: Simulation, hx: number, opts: { owner?: number; type?: number } = {}): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, positionOfNode(hx, ROW));
  sim.world.add(e, Building, { buildingType: opts.type ?? TEMPLE_TYPE, tribe: VIKING, built: ONE, level: 0 });
  sim.world.add(e, Owner, { player: opts.owner ?? OWNER });
  sim.world.add(e, Health, { hitpoints: TEMPLE_HITPOINTS, max: TEMPLE_HITPOINTS });
  return e;
}

function personAt(
  sim: Simulation,
  hx: number,
  opts: { owner?: number | null; hitpoints?: number; piety?: Fixed } = {},
): Entity {
  const e = settlerAt(sim, {
    jobType: WOODCUTTER,
    needs: { piety: opts.piety ?? WORN },
    position: positionOfNode(hx, ROW),
  });
  if (opts.owner !== null) sim.world.add(e, Owner, { player: opts.owner ?? OWNER });
  sim.world.add(e, Health, { hitpoints: opts.hitpoints ?? POOL, max: POOL });
  return e;
}

/** One pass of the system on the given tick. */
function blessAt(sim: Simulation, tick: number): void {
  const ctx: SystemContext = { ...ctxOf(sim), tick };
  templeAuraSystem(sim.world, ctx);
}

const hp = (sim: Simulation, e: Entity): number => sim.world.get(e, Health).hitpoints;
const piety = (sim: Simulation, e: Entity): Fixed => sim.world.get(e, Settler).piety;

describe('templeAuraSystem - the temple blesses its owner people once a game second', () => {
  it('adds hitpoints above the max and religion to a worn bar, on the second boundary only', () => {
    const sim = fresh();
    templeAt(sim, 10);
    const settler = personAt(sim, 12);

    blessAt(sim, TICKS_PER_SECOND + 1);
    expect(hp(sim, settler)).toBe(POOL);

    blessAt(sim, TICKS_PER_SECOND);
    expect(hp(sim, settler)).toBe(POOL + TEMPLE_AURA_HITPOINTS);
    expect(piety(sim, settler)).toBe(applyNeedUnits(WORN, TEMPLE_AURA_PIETY_UNITS));
  });

  it('reaches exactly its range in map points', () => {
    const sim = fresh();
    templeAt(sim, 10);
    const edge = personAt(sim, 10 + TEMPLE_AURA_RANGE);
    const beyond = personAt(sim, 10 + TEMPLE_AURA_RANGE + 1);

    blessAt(sim, 0);

    expect(hp(sim, edge)).toBe(POOL + TEMPLE_AURA_HITPOINTS);
    expect(hp(sim, beyond)).toBe(POOL);
  });

  it('blesses once a second however many temples reach the person', () => {
    const sim = fresh();
    templeAt(sim, 10);
    templeAt(sim, 14);
    const settler = personAt(sim, 12, { piety: ONE });

    blessAt(sim, 0);

    expect(hp(sim, settler)).toBe(POOL + TEMPLE_AURA_HITPOINTS);
    expect(piety(sim, settler)).toBe(applyNeedUnits(ONE, TEMPLE_AURA_PIETY_UNITS));
  });

  it("blesses only the temple owner's people", () => {
    const sim = fresh();
    templeAt(sim, 10);
    const rival = personAt(sim, 11, { owner: RIVAL });
    const unowned = personAt(sim, 12, { owner: null });

    blessAt(sim, 0);

    expect(hp(sim, rival)).toBe(POOL);
    expect(hp(sim, unowned)).toBe(POOL);
    expect(piety(sim, rival)).toBe(WORN);
  });

  it('gives nothing from a temple still being built, the headquarters or another building', () => {
    const sim = fresh();
    const site = templeAt(sim, 10);
    sim.world.mut(site, Building).built = fx.fromInt(0);
    sim.world.add(site, UnderConstruction, { labor: fx.fromInt(0) });
    templeAt(sim, 20, { type: SAWMILL_TYPE });
    templeAt(sim, 18, { type: HEADQUARTERS_TYPE });
    const settler = personAt(sim, 15);

    blessAt(sim, 0);
    expect(hp(sim, settler)).toBe(POOL);

    sim.world.remove(site, UnderConstruction);
    sim.world.mut(site, Building).built = ONE;
    blessAt(sim, TICKS_PER_SECOND);
    expect(hp(sim, settler)).toBe(POOL + TEMPLE_AURA_HITPOINTS);
  });

  it('stops blessing once the temple takes a wound, and resumes when it is whole again', () => {
    const sim = fresh();
    const temple = templeAt(sim, 10);
    const settler = personAt(sim, 12);
    sim.world.mut(temple, Health).hitpoints = TEMPLE_HITPOINTS - 1;

    blessAt(sim, 0);
    expect(hp(sim, settler)).toBe(POOL);

    sim.world.mut(temple, Health).hitpoints = TEMPLE_HITPOINTS;
    blessAt(sim, TICKS_PER_SECOND);
    expect(hp(sim, settler)).toBe(POOL + TEMPLE_AURA_HITPOINTS);
  });

  it('raises religion only while the bar is at or below the sated level', () => {
    const sim = fresh();
    templeAt(sim, 10);
    const sated = personAt(sim, 11, { piety: fx.sub(NEED_SATED_THRESHOLD, ULP) });
    const atLevel = personAt(sim, 12, { piety: NEED_SATED_THRESHOLD });

    blessAt(sim, 0);

    expect(piety(sim, sated)).toBe(fx.sub(NEED_SATED_THRESHOLD, ULP));
    expect(piety(sim, atLevel)).toBe(applyNeedUnits(NEED_SATED_THRESHOLD, TEMPLE_AURA_PIETY_UNITS));
  });

  it('raises hitpoints to the max plus half again and no further', () => {
    const sim = fresh();
    templeAt(sim, 10);
    const settler = personAt(sim, 12);
    const ceiling = blessedHitpointCeiling(POOL);

    for (let second = 0; second < 10; second++) blessAt(sim, second * TICKS_PER_SECOND);

    expect(ceiling).toBe(POOL + POOL / 2);
    expect(hp(sim, settler)).toBe(ceiling);
  });

  it('does not raise the dead', () => {
    const sim = fresh();
    templeAt(sim, 10);
    const body = personAt(sim, 12, { hitpoints: 0 });

    blessAt(sim, 0);

    expect(hp(sim, body)).toBe(0);
  });

  it('still heals with the needs mechanic off, but leaves the bars alone', () => {
    const sim = fresh();
    setNeedsEnabled(sim.world, false);
    templeAt(sim, 10);
    const settler = personAt(sim, 12);

    blessAt(sim, 0);

    expect(hp(sim, settler)).toBe(POOL + TEMPLE_AURA_HITPOINTS);
    expect(piety(sim, settler)).toBe(WORN);
  });

  it('keeps the surplus through the full schedule while the settler stays in range', () => {
    const sim = fresh();
    templeAt(sim, 10);
    const settler = personAt(sim, 12);

    for (let i = 0; i < 12 * TICKS_PER_SECOND; i++) sim.step();

    // Natural regeneration works only below the max, so nothing pulls the surplus back down.
    expect(hp(sim, settler)).toBe(blessedHitpointCeiling(POOL));
    expect(sim.checkInvariants()).toEqual([]);
  });

  it('keeps its temple list coherent as temples are finished and razed', () => {
    const sim = fresh();
    const site = templeAt(sim, 10);
    sim.world.add(site, UnderConstruction, { labor: fx.fromInt(0) });
    const other = templeAt(sim, 40);
    personAt(sim, 12);
    blessAt(sim, 0);

    sim.world.remove(site, UnderConstruction);
    sim.world.destroy(other);
    blessAt(sim, TICKS_PER_SECOND);

    expect(sim.world.verifyCaches()).toEqual([]);
  });

  it("runs after this tick's blows land", () => {
    const names = SYSTEM_ORDER.map((s) => s.name);
    expect(names.indexOf('projectile')).toBeLessThan(names.indexOf('templeAura'));
    expect(names.indexOf('combat')).toBeLessThan(names.indexOf('templeAura'));
  });

  it('is byte-identical across two same-seed runs', () => {
    const run = (): string => {
      const sim = fresh();
      templeAt(sim, 10);
      personAt(sim, 12);
      personAt(sim, 30, { piety: ONE });
      for (let i = 0; i < 5 * TICKS_PER_SECOND; i++) sim.step();
      return sim.hashState();
    };
    expect(run()).toBe(run());
  });
});
