import { describe, expect, it } from 'vitest';
import * as components from '../../../src/components/index.js';
import { Health, Settler } from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import { fx, ONE, Simulation } from '../../../src/index.js';
import {
  BABY_MALE,
  CHILD_MALE,
  GROWUP_TICKS,
  STARVATION_BITES_TO_DIE,
  STARVATION_DAMAGE_INTERVAL_TICKS,
} from '../../../src/systems/index.js';
import { testContent } from '../../fixtures/content.js';
import { settlerWithHunger } from './support.js';

describe('needsSystem — starvation (a pinned hunger drains hitpoints)', () => {
  /** A settler whose hunger is already pinned at ONE, carrying an explicit Health pool. */
  function starvingSettler(sim: Simulation, hitpoints: number): Entity {
    const e = settlerWithHunger(sim, ONE);
    sim.world.add(e, Health, { hitpoints, max: hitpoints });
    return e;
  }

  it('bites hitpoints on the interval beat only while hunger is pinned at ONE', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const starving = starvingSettler(sim, 300);
    const fed = settlerWithHunger(sim, fx.fromInt(0));
    sim.world.add(fed, Health, { hitpoints: 300, max: 300 });

    for (let i = 0; i < STARVATION_DAMAGE_INTERVAL_TICKS * 3; i++) sim.step();
    // 300/240 truncates to 1 → the 1-damage floor, one bite per interval; the fed settler is untouched.
    expect(sim.world.get(starving, Health).hitpoints).toBe(300 - 3);
    expect(sim.world.get(fed, Health).hitpoints).toBe(300);
    expect(sim.checkInvariants()).toEqual([]);
  });

  it('scales the bite with the pool so any pool empties in ~STARVATION_BITES_TO_DIE intervals', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const e = starvingSettler(sim, 2400);
    for (let i = 0; i < STARVATION_DAMAGE_INTERVAL_TICKS; i++) sim.step();
    expect(sim.world.get(e, Health).hitpoints).toBe(2400 - 2400 / STARVATION_BITES_TO_DIE);
  });

  it('starves a settler to death: the drained pool is reaped with a settlerDied event', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const e = starvingSettler(sim, 2); // two bites to die (fast-forward the death without 2400 ticks)
    let died = false;
    for (let i = 0; i < STARVATION_DAMAGE_INTERVAL_TICKS * 2 + 1 && !died; i++) {
      sim.step();
      died = sim.events.current().some((ev) => ev.kind === 'settlerDied' && ev.entity === e);
    }
    expect(died).toBe(true);
    expect(sim.world.has(e, Settler)).toBe(false); // reaped by cleanupSystem
  });

  it('exempts animals and jobless settlers (jobType null — no eat/graze path to save them)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const e = starvingSettler(sim, 300);
    sim.world.get(e, Settler).jobType = null;
    for (let i = 0; i < STARVATION_DAMAGE_INTERVAL_TICKS * 2; i++) sim.step();
    expect(sim.world.get(e, Health).hitpoints).toBe(300);
  });

  it('exempts a growing baby (Age carrier in a baby stage) — a cared-for newborn cannot self-feed', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    // A baby's jobType is an age-class id (non-null), so Age + a baby stage marks it as cared-for;
    // the AI planner runs no needs-drives for it, so without this exemption every borne baby would die
    // of hunger before its GROWUP_TICKS boundary and reproduction would be a death loop. Age matters:
    // an adult fixture whose synthetic job id collides with BABY_MALE must still starve.
    const e = starvingSettler(sim, 300);
    sim.world.get(e, Settler).jobType = BABY_MALE;
    sim.world.add(e, components.Age, { ticks: 0 });
    for (let i = 0; i < STARVATION_DAMAGE_INTERVAL_TICKS * 2; i++) sim.step();
    expect(sim.world.get(e, Health).hitpoints).toBe(300);
  });

  it('starves a pinned child (Age carrier in a child stage) — it self-feeds, so it bites like an adult', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    // A child runs the planner's eat drive (ai.ts); with no food anywhere its hunger pins and the
    // starvation bite applies — only the baby stage keeps the cared-for exemption.
    const e = starvingSettler(sim, 300);
    sim.world.get(e, Settler).jobType = CHILD_MALE;
    sim.world.add(e, components.Age, { ticks: GROWUP_TICKS });
    for (let i = 0; i < STARVATION_DAMAGE_INTERVAL_TICKS * 2; i++) sim.step();
    expect(sim.world.get(e, Health).hitpoints).toBe(300 - 2);
  });

  it('stops starving while needs are disabled', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const e = starvingSettler(sim, 300);
    sim.enqueue({ kind: 'setNeedsEnabled', enabled: false });
    for (let i = 0; i < STARVATION_DAMAGE_INTERVAL_TICKS * 2; i++) sim.step();
    expect(sim.world.get(e, Health).hitpoints).toBe(300);
  });
});
