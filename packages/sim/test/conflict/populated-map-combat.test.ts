import { beforeEach, describe, expect, it } from 'vitest';
import { CurrentAtomic, Health, HerdMember, Position, Settler } from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { Simulation, type TerrainMap, fx, seedAnimalHerds } from '../../src/index.js';
import { testContent } from '../fixtures/content.js';

/**
 * **Populated-map combat scenario** — the end-to-end slice the plan Phase-4 "animals as
 * non-controllable tribes" item names ("a scenario/slice that *runs* a populated map end-to-end:
 * civ + seeded wildlife fighting via the combat drive"). Every piece is unit-tested in isolation
 * (the `seedAnimalHerds` populator, the `spawnAnimalHerd` command, the `combatSystem` targeting drive,
 * the `cleanupSystem` death reaper). This test wires them together as ONE integrated run through the
 * real `step()` schedule, the thing no unit test proves: the populator's commands fed through the
 * mutation seam place real seeded wildlife, an aggressive seeded herd engages a civilization combatant,
 * the fight is mutual, and a felled fighter is reaped — all in-order within ticks, deterministically.
 *
 * Fixture geometry: the BEAR (tribe 10) is an AGGRESSIVE animal (a herd of 3, searchForLeader, HP
 * 15000) wielding `test_bearfist` (40 net damage vs an unarmored target, range 2). The VIKING (tribe 1)
 * is a civilization whose woodcutter (job 1) wields `test_axe` (50 net damage, range 2). So a seeded
 * bear charges a nearby viking and the viking fights it back.
 *
 * The wildlife comes through the REAL populator+command path (`seedAnimalHerds` -> enqueued
 * `spawnAnimalHerd` -> `commandSystem`); the civilization combatant is placed directly (like the
 * combat-system unit test's `fighterAt`) because `spawnSettler` mints a settler WITHOUT a `Health`
 * pool — a civ becomes a *combatant* only once it carries `Health`, and settler-side Health stamping
 * is a separate future slice (soldiers/armor). What this scenario verifies is the integration of the
 * already-landed pieces, not a new mechanic.
 */

const VIKING = 1;
const WOODCUTTER = 1; // job 1 — test_axe binds here (tribe 1, job 1)
const BEAR = 10;
const GRASS = 0; // walkable landscape typeId

beforeEach(() => {
  Position.store.clear();
  Settler.store.clear();
  Health.store.clear();
  HerdMember.store.clear();
  CurrentAtomic.store.clear();
});

/** An all-grass (fully walkable) w×h terrain map. */
function grass(width: number, height: number): TerrainMap {
  return { width, height, typeIds: new Array(width * height).fill(GRASS) };
}

/** Place a civilization combatant (a settler with a Health pool) directly at (x,y). */
function vikingFighterAt(sim: Simulation, x: number, y: number, hitpoints: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Settler, {
    tribe: VIKING,
    jobType: WOODCUTTER,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
    experience: new Map<number, number>(),
  });
  sim.world.add(e, Health, { hitpoints, max: hitpoints });
  return e;
}

/** Total `settlerDied` events fired across `ticks` steps (events are cleared each tick — accumulate). */
function runAccumulatingDeaths(sim: Simulation, ticks: number, stopWhen: () => boolean): number {
  let deaths = 0;
  for (let i = 0; i < ticks && !stopWhen(); i++) {
    sim.step();
    deaths += sim.snapshot().events.filter((ev) => ev.kind === 'settlerDied').length;
  }
  return deaths;
}

describe('populated-map combat scenario (civ vs seeded wildlife, end-to-end)', () => {
  it('seeds a real bear herd that the commandSystem actually places via step()', () => {
    const content = testContent();
    const map = grass(9, 1);
    // One BEAR herd at the first walkable cell (x=0): leader on the birth point, two scattered at x±1.
    const cmds = seedAnimalHerds(content, map, { tribes: [BEAR], maxHerds: 1 });
    expect(cmds).toHaveLength(1);
    expect(cmds[0]).toMatchObject({ kind: 'spawnAnimalHerd', tribe: BEAR, x: 0, y: 0 });

    const sim = new Simulation({ seed: 1, content, map });
    for (const c of cmds) sim.enqueue(c);
    sim.step(); // commandSystem applies the spawnAnimalHerd

    const herd = [...sim.world.query(Settler, Health, Position)];
    expect(herd).toHaveLength(3); // the bear's maximumGroupSize, each a Health-bearing combatant
    for (const e of herd) {
      expect(sim.world.get(e, Settler).tribe).toBe(BEAR);
      expect(sim.world.get(e, Settler).jobType).toBeNull(); // an animal isn't born into a trade
      expect(sim.world.get(e, Health).hitpoints).toBe(15000); // hitpointsAdult
      expect(sim.world.has(e, HerdMember)).toBe(true); // bear searchForLeader -> a led herd
    }
  });

  it('an aggressive seeded bear engages a nearby viking and the viking fights back (mutual fight)', () => {
    const content = testContent();
    const map = grass(9, 1);
    const sim = new Simulation({ seed: 1, content, map });
    // Seed the bear herd at x=0: leader on the birth point (x=0), the two pack members scattered to
    // x=+1 and the off-map raw x=-1 (clamped to the grid edge, x=0, on combat's cellAtClamped read).
    for (const c of seedAnimalHerds(content, map, { tribes: [BEAR], maxHerds: 1 })) sim.enqueue(c);
    // A viking combatant 2 cells from the bear leader's birth point — within both weapons' range 2.
    const viking = vikingFighterAt(sim, 2, 0, 1_000_000);

    sim.step(); // commandSystem places the herd this tick; combatSystem then picks targets

    // The viking is engaging a BEAR (it fights an aggressive animal BACK), and at least one bear is
    // engaging the viking (the unprovoked aggression drive) — the fight is mutual.
    const bears = new Set(
      [...sim.world.query(Settler)].filter((e) => sim.world.get(e, Settler).tribe === BEAR),
    );
    expect(sim.world.has(viking, CurrentAtomic)).toBe(true);
    const vikingEffect = sim.world.get(viking, CurrentAtomic).effect;
    expect(vikingEffect.kind).toBe('attack');
    // The viking's target is one of the seeded bears (50 damage with test_axe vs the bear's class 0).
    expect(vikingEffect).toMatchObject({ kind: 'attack', damage: 50 });
    if (vikingEffect.kind === 'attack') expect(bears.has(vikingEffect.target)).toBe(true);

    const bearsSwinging = [...bears].filter((e) => sim.world.has(e, CurrentAtomic));
    expect(bearsSwinging.length).toBeGreaterThan(0); // a bear charged the viking
    for (const bear of bearsSwinging) {
      const eff = sim.world.get(bear, CurrentAtomic).effect;
      expect(eff).toMatchObject({ kind: 'attack', target: viking, damage: 40 }); // test_bearfist vs class 0
    }
  });

  it('a lone viking is ground down by the bear pack and reaped (seed -> combat -> hit -> death)', () => {
    const content = testContent();
    const map = grass(9, 1);
    const sim = new Simulation({ seed: 1, content, map });
    for (const c of seedAnimalHerds(content, map, { tribes: [BEAR], maxHerds: 1 })) sim.enqueue(c);
    // A frail viking (200 HP) beside the herd — the pack's 40-per-hit swings outpace its 50-vs-15000.
    const viking = vikingFighterAt(sim, 1, 0, 200);

    const deaths = runAccumulatingDeaths(sim, 200, () => !sim.world.isAlive(viking));

    expect(sim.world.isAlive(viking)).toBe(false); // the bear pack felled the lone viking
    expect(deaths).toBe(1); // exactly one death announced for render/audio (the felled viking)
    // The bears survive (15000 HP each vs the viking's 50/hit — it can't grind a whole bear down in time).
    const bears = [...sim.world.query(Settler, Health)].filter(
      (e) => sim.world.get(e, Settler).tribe === BEAR,
    );
    expect(bears.length).toBeGreaterThan(0);
  });

  it('the populated-map skirmish is deterministic: two same-seed runs reach the same state hash', () => {
    const run = (): string => {
      Position.store.clear();
      Settler.store.clear();
      Health.store.clear();
      HerdMember.store.clear();
      CurrentAtomic.store.clear();
      const content = testContent();
      const map = grass(9, 1);
      const sim = new Simulation({ seed: 7, content, map });
      for (const c of seedAnimalHerds(content, map, { tribes: [BEAR], maxHerds: 1 })) sim.enqueue(c);
      vikingFighterAt(sim, 1, 0, 200);
      for (let i = 0; i < 60; i++) sim.step();
      return sim.hashState();
    };
    expect(run()).toBe(run());
  });
});
