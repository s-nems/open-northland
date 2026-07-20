import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  Building,
  CurrentAtomic,
  MoveGoal,
  Position,
  Residence,
  Resting,
  Settler,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { cellAnchorNode, type Fixed, fx, ONE, Simulation } from '../../src/index.js';
import { aiSystem } from '../../src/systems/index.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf, grassMap, justAbove, NEED_THRESHOLD, needsSettlerAt } from './needs/support.js';

/**
 * The SLEEP-AT-HOME rung: a settler with a built house walks to its door, goes inside (hidden by the
 * `Resting` marker), sleeps the short at-home clip, and steps back out rested. The homeless keep the
 * open-ground rule (`rest-spot.ts`).
 *
 * Source basis: the data pairs every outdoor sleep clip with an at-home twin — `viking_civilist_sleep`
 * (`length 237`) beside `viking_civilist_sleep_home` (`length 50`), both pulsing the rest channel twice
 * at `+4000`. The fixture mirrors that shape at fixture scale (6 outdoors, 2 at home).
 */

const VIKING = 1;
const HOME_TYPE = 90;
const OUTDOOR_SLEEP_TICKS = 6; // the fixture's "viking_sleep" length
const HOME_SLEEP_TICKS = 2; // the fixture's "viking_sleep_home" length
const TIRED: Fixed = justAbove(NEED_THRESHOLD);

/** The shared fixture plus a `home` building type and the at-home sleep clip the rung resolves by name. */
function homeContent(): ContentSet {
  const base = testContent();
  return parseContentSet({
    ...base,
    buildings: [...base.buildings, { typeId: HOME_TYPE, id: 'home_small', kind: 'home', homeSize: 2 }],
    atomicAnimations: [
      ...base.atomicAnimations,
      { id: 'viking_sleep_home', name: 'viking_sleep_home', length: HOME_SLEEP_TICKS },
    ],
  });
}

function simWithHomes(): Simulation {
  return new Simulation({ seed: 1, content: homeContent(), map: grassMap(8, 6) });
}

/** A built home of `tribe` standing on cell (x, y). */
function homeAt(sim: Simulation, x: number, y: number, tribe = VIKING): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Building, { buildingType: HOME_TYPE, tribe, built: ONE, level: 0 });
  return e;
}

function tiredAt(sim: Simulation, x: number, y: number): Entity {
  return needsSettlerAt(sim, x, y, { fatigue: TIRED });
}

function nodeAt(sim: Simulation, cx: number, cy: number): number | undefined {
  const anchor = cellAnchorNode(cx, cy);
  return sim.terrain?.nodeAt(anchor.hx, anchor.hy);
}

describe('sleepAtHome — a housed settler goes to bed indoors', () => {
  it('sleeps inside on the spot, on the short at-home clip, when standing at its own door', () => {
    const sim = simWithHomes();
    const settler = tiredAt(sim, 3, 2);
    const home = homeAt(sim, 3, 2); // same cell — the settler is already on the door node
    sim.world.add(settler, Residence, { home });

    aiSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(settler, MoveGoal)).toBe(false);
    expect(sim.world.get(settler, Resting).at).toBe(home); // went in — the render hides it
    const atomic = sim.world.get(settler, CurrentAtomic);
    expect(atomic.effect).toEqual({ kind: 'sleep' });
    // The at-home clip, not the outdoor one — a bed indoors is worth the same rest in less time.
    expect(atomic.duration).toBe(HOME_SLEEP_TICKS);
  });

  it('walks to its own door rather than lying down where it stands', () => {
    const sim = simWithHomes();
    const settler = tiredAt(sim, 1, 2);
    const home = homeAt(sim, 5, 2);
    sim.world.add(settler, Residence, { home });

    aiSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(settler, CurrentAtomic)).toBe(false); // still walking, not yet asleep
    expect(sim.world.has(settler, Resting)).toBe(false); // not inside until it arrives
    expect(sim.world.get(settler, MoveGoal).cell).toBe(nodeAt(sim, 5, 2));
  });

  it('falls back to open ground for a homeless settler', () => {
    const sim = simWithHomes();
    const settler = tiredAt(sim, 3, 2);
    homeAt(sim, 5, 2); // a house stands, but this settler does not live in it

    aiSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(settler, Resting)).toBe(false); // slept outside, never went in
    const atomic = sim.world.get(settler, CurrentAtomic);
    expect(atomic.effect).toEqual({ kind: 'sleep' });
    expect(atomic.duration).toBe(OUTDOOR_SLEEP_TICKS);
  });

  it('falls back to open ground when the home is still a building site', () => {
    const sim = simWithHomes();
    const settler = tiredAt(sim, 3, 2);
    const site = homeAt(sim, 3, 2);
    sim.world.get(site, Building).built = fx.div(ONE, fx.fromInt(2)); // half-raised — no roof yet
    sim.world.add(settler, Residence, { home: site });

    aiSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(settler, Resting)).toBe(false);
    expect(sim.world.get(settler, CurrentAtomic).duration).toBe(OUTDOOR_SLEEP_TICKS);
  });

  it('comes back out rested — the marker is shed once the sleep completes', () => {
    const sim = simWithHomes();
    const settler = tiredAt(sim, 3, 2);
    const home = homeAt(sim, 3, 2);
    sim.world.add(settler, Residence, { home });

    // Long enough for the walk-in, the whole nap, and the re-plan that turfs it back out.
    for (let i = 0; i < 40; i++) sim.step();

    expect(sim.world.has(settler, Resting)).toBe(false); // stepped back outside
    expect(sim.world.get(settler, Settler).fatigue).toBeLessThan(TIRED); // and slept it off
    expect(sim.checkInvariants()).toEqual([]);
  });

  it('is byte-identical across two same-seed runs (determinism)', () => {
    const run = (): string => {
      const sim = simWithHomes();
      const settler = tiredAt(sim, 2, 2);
      const home = homeAt(sim, 4, 3);
      sim.world.add(settler, Residence, { home });
      for (let i = 0; i < 60; i++) sim.step();
      return sim.hashState();
    };
    expect(run()).toBe(run());
  });
});
