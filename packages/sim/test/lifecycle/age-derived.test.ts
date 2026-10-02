import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { Age, addPerson, Health, Person, Position, Settler } from '../../src/components/index.js';
import { Rng } from '../../src/core/rng.js';
import type { Entity, World } from '../../src/ecs/world.js';
import { fx, Simulation } from '../../src/index.js';
import {
  ADULT_AGE_TICKS,
  ageTicksAt,
  BABY_FEMALE,
  BABY_MALE,
  CHILD_AGE_TICKS,
  CHILD_FEMALE,
  CHILD_MALE,
  CIVILIST_JOB,
  growthSystem,
  HUMAN_HITPOINTS,
  WOMAN_JOB,
} from '../../src/systems/index.js';
import { TEST_MANIFEST } from '../fixtures/content.js';
import { nextTickCtxOf } from '../fixtures/context.js';

// The derived age against the per-pass counter it replaces: one reference counter per growing settler,
// raised once per growth pass exactly as `Age.ticks` used to be, under the same births, script age
// changes and deaths, landing before and after the pass.

const VIKING = 1;
const SPAN_TICKS = 40_000;
const SEED = 20_251_003;
/** Roughly one birth, age change and death per this many ticks per side of the pass. */
const BIRTH_ODDS = 150;
const AGE_CHANGE_ODDS = 300;
const DEATH_ODDS = 900;
/** How close to a stage boundary a boundary-aimed age change lands. */
const BOUNDARY_REACH = 3;
/** A 40000-tick differential against the per-pass counter: slow by design, and slower on a loaded machine. */
const DIFFERENTIAL_TIMEOUT_MS = 60_000;

function growthContent(): ContentSet {
  return parseContentSet({
    manifest: TEST_MANIFEST,
    goods: [{ typeId: 0, id: 'none' }],
    jobs: [{ typeId: 0, id: 'idle' }],
    buildings: [],
    tribes: [{ typeId: VIKING, id: 'viking', jobEnables: [{ jobType: 0, kind: 'job', targetId: 0 }] }],
  });
}

interface Reference {
  ticks: number;
  male: boolean;
}

function stageAt(ref: Reference): number {
  if (ref.ticks < CHILD_AGE_TICKS) return ref.male ? BABY_MALE : BABY_FEMALE;
  return ref.male ? CHILD_MALE : CHILD_FEMALE;
}

function ageRevision(world: World, e: Entity): number {
  let revision = -1;
  world.forEachComponent(e, (name, _value, at) => {
    if (name === Age.name) revision = at;
  });
  return revision;
}

function aimedAge(rng: Rng): number {
  const boundary = rng.int(2) === 0 ? CHILD_AGE_TICKS : ADULT_AGE_TICKS;
  return rng.int(2) === 0 ? boundary - 1 - rng.int(BOUNDARY_REACH) : rng.int(ADULT_AGE_TICKS);
}

describe('derived age', () => {
  it('promotes and graduates every child on the tick the per-pass counter did, writing Age only on events', {
    timeout: DIFFERENTIAL_TIMEOUT_MS,
  }, () => {
    const sim = new Simulation({ seed: 3, content: growthContent() });
    const rng = new Rng(SEED);
    const refs = new Map<Entity, Reference>();
    let graduated = 0;
    let passWrites = 0;
    let events = 0;
    // Collected rather than asserted per tick: tens of thousands of expect calls dominate the run.
    const mismatches: string[] = [];
    const check = (holds: boolean, what: () => string): void => {
      if (!holds) mismatches.push(what());
    };

    const birth = (): void => {
      const e = sim.world.create();
      const male = rng.int(2) === 0;
      sim.world.add(e, Position, { x: fx.fromInt(0), y: fx.fromInt(0) });
      addPerson(sim.world, e, {
        tribe: VIKING,
        jobType: male ? BABY_MALE : BABY_FEMALE,
        hunger: fx.fromInt(0),
        fatigue: fx.fromInt(0),
        piety: fx.fromInt(0),
        enjoyment: fx.fromInt(0),
      });
      sim.world.add(e, Age, { ticks: 0, asOf: null });
      sim.world.add(e, Health, { hitpoints: HUMAN_HITPOINTS, max: HUMAN_HITPOINTS });
      refs.set(e, { ticks: 0, male });
    };
    const anyChild = (): [Entity, Reference] | undefined => {
      const living = [...refs];
      return living[rng.int(Math.max(1, living.length))];
    };
    const landEvents = (): void => {
      if (rng.int(BIRTH_ODDS) === 0) {
        birth();
        events++;
      }
      const changed = rng.int(AGE_CHANGE_ODDS) === 0 ? anyChild() : undefined;
      if (changed !== undefined) {
        const [e, ref] = changed;
        ref.ticks = aimedAge(rng);
        sim.world.add(e, Age, { ticks: ref.ticks, asOf: null });
        events++;
      }
      const dying = rng.int(DEATH_ODDS) === 0 ? anyChild() : undefined;
      if (dying !== undefined) {
        sim.world.destroy(dying[0]);
        refs.delete(dying[0]);
      }
    };
    const expectDerived = (tick: number): void => {
      for (const [e, ref] of refs) {
        const derived = ageTicksAt(sim.world.get(e, Age), tick);
        check(derived === ref.ticks, () => `tick ${tick} entity ${e}: age ${derived}, counter ${ref.ticks}`);
      }
    };

    for (let i = 0; i < SPAN_TICKS; i++) {
      const ctx = nextTickCtxOf(sim);
      landEvents();
      for (const e of sim.world.query(Age, Person)) {
        const ref = refs.get(e);
        if (ref !== undefined) ref.ticks += 1;
      }
      const revisions = new Map([...refs.keys()].map((e) => [e, ageRevision(sim.world, e)]));
      growthSystem(sim.world, ctx);
      for (const [e, ref] of refs) {
        if (ref.ticks >= ADULT_AGE_TICKS) {
          const job = sim.world.get(e, Settler).jobType;
          check(!sim.world.has(e, Age), () => `tick ${ctx.tick} entity ${e}: still growing`);
          check(
            job === (ref.male ? CIVILIST_JOB : WOMAN_JOB),
            () => `tick ${ctx.tick} entity ${e}: grew into ${job}`,
          );
          refs.delete(e);
          graduated++;
          continue;
        }
        const job = sim.world.get(e, Settler).jobType;
        check(job === stageAt(ref), () => `tick ${ctx.tick} entity ${e}: stage ${job} at ${ref.ticks}`);
        if (ageRevision(sim.world, e) !== revisions.get(e)) passWrites++;
      }
      expectDerived(ctx.tick);
      landEvents();
      expectDerived(ctx.tick);
    }
    expect(mismatches.slice(0, 5)).toEqual([]);
    expect(graduated).toBeGreaterThan(0);
    // A pass writes an age only to count the first pass after a birth or an age change.
    expect(passWrites).toBeGreaterThan(0);
    expect(passWrites).toBeLessThanOrEqual(events);
  });
});
