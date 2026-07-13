import { beforeEach, describe, expect, it } from 'vitest';
import {
  Building,
  Health,
  Position,
  Settler,
  Stockpile,
  UnderConstruction,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { clearComponentStores } from '../../src/harness/stores.js';
import { fx, ONE, Simulation } from '../../src/index.js';
import { testContent } from '../fixtures/content.js';

/**
 * The DEBUG / cheat commands the admin panel issues — `debugKill`, `debugSetNeeds`, `debugFillStockpile`
 * and `debugCompleteConstruction`. Each is a real serializable command applied through the ONE command
 * path (so it replays/hashes like any order), issued only by the debug panel. These prove the EFFECT of
 * each (the panel's own click→command wiring is browser-verified); the determinism/replay half is locked
 * by the fuzz-determinism generator (each variant is fuzzed there). Bad/wrong-kind targets must be a
 * recoverable no-op, exactly like `demolish`/`attackUnit`.
 */

const VIKING = 1;
const WORKPLACE = 2; // fixture building: stock slots goodType 1 (cap 20) + goodType 2 (cap 20)
const WORKPLACE_STOCK: readonly [number, number][] = [
  [1, 20],
  [2, 20],
];
const GRANARY = 6; // fixture building kind 'storage' — used as a construction-site body (no home upgrade)
const GRANARY_MAX_HP = 100;

/** Clear the WHOLE component namespace (module-level singletons) so runs can't leak into each other —
 *  a hand-picked subset would miss a component a future system adds (sim AGENTS.md). */

beforeEach(clearComponentStores);

function fresh(seed = 1): Simulation {
  return new Simulation({ seed, content: testContent() });
}

/** A killable UNIT: a settler carrying a Health pool at a tile (what `debugKill` gates on + drains). */
function unitWithHealth(sim: Simulation, hitpoints: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(3), y: fx.fromInt(3) });
  sim.world.add(e, Settler, {
    tribe: VIKING,
    jobType: null,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
    experience: new Map(),
  });
  sim.world.add(e, Health, { hitpoints, max: hitpoints });
  return e;
}

/** A bare Health entity with NO Settler — a stand-in non-settler (the wrong-kind target for the tools). */
function healthOnlyEntity(sim: Simulation, hitpoints: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(3), y: fx.fromInt(3) });
  sim.world.add(e, Health, { hitpoints, max: hitpoints });
  return e;
}

/** A settler carrying its four needs pre-set to `level` (a Fixed), so a debug-set is a visible change. */
function settlerWithNeeds(sim: Simulation, level: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(3), y: fx.fromInt(3) });
  sim.world.add(e, Settler, {
    tribe: VIKING,
    jobType: null,
    hunger: level,
    fatigue: level,
    piety: level,
    enjoyment: level,
    experience: new Map(),
  });
  return e;
}

describe('debugKill', () => {
  it('drains a Health pool to 0 so the CleanupSystem reaps the entity with a settlerDied event', () => {
    const sim = fresh();
    const victim = unitWithHealth(sim, 50);

    sim.enqueue({ kind: 'debugKill', target: victim });
    sim.step();

    expect(sim.world.has(victim, Health)).toBe(false); // reaped (destroyed), not a lingering 0-HP zombie
    expect(sim.events.current().some((ev) => ev.kind === 'settlerDied')).toBe(true);
  });

  it('a target with no Health (a finished building) is an untouched no-op', () => {
    const sim = fresh();
    const store = sim.world.create();
    sim.world.add(store, Building, { buildingType: GRANARY, tribe: VIKING, built: ONE, level: 0 });
    sim.world.add(store, Stockpile, { amounts: new Map() });

    sim.enqueue({ kind: 'debugKill', target: store });
    expect(() => sim.step()).not.toThrow();
    expect(sim.world.has(store, Building)).toBe(true); // still standing
  });

  it('a construction site (a Building that DOES carry Health) survives — killable is settler-only', () => {
    const sim = fresh();
    const site = sim.world.create();
    sim.world.add(site, Position, { x: fx.fromInt(3), y: fx.fromInt(3) });
    sim.world.add(site, Building, { buildingType: GRANARY, tribe: VIKING, built: fx.fromInt(0), level: 0 });
    sim.world.add(site, UnderConstruction, { labor: fx.fromInt(0) });
    sim.world.add(site, Stockpile, { amounts: new Map() });
    sim.world.add(site, Health, { hitpoints: 1, max: GRANARY_MAX_HP });

    sim.enqueue({ kind: 'debugKill', target: site });
    sim.step();

    // Gated on Settler: the site is NOT reaped by the kill (that would bypass demolish's worker-unbind
    // seam). It survives as a live building — its Health pool is never drained to 0. (This GRANARY has an
    // empty construction cost, so constructionSystem also finishes it this tick; the point here is only
    // that debugKill left it standing, not what its final HP is.)
    expect(sim.world.has(site, Building)).toBe(true);
    expect(sim.world.get(site, Health).hitpoints).toBeGreaterThan(0);
  });
});

describe('debugSetNeeds', () => {
  it('sets only the named needs (percent → 0..ONE Fixed); omitted needs are left untouched', () => {
    const sim = fresh();
    // Freeze needs first so the NeedsSystem's per-tick rise can't perturb the values we set.
    sim.enqueue({ kind: 'setNeedsEnabled', enabled: false });
    sim.step();

    const start = fx.fromInt(0); // a sentinel the omitted needs must keep
    const settler = settlerWithNeeds(sim, start);
    sim.enqueue({ kind: 'debugSetNeeds', target: settler, hunger: 100, fatigue: 50 });
    sim.step();

    const s = sim.world.get(settler, Settler);
    expect(s.hunger).toBe(ONE); // 100% → maxed
    expect(s.fatigue).toBe(fx.mulDiv(ONE, fx.fromInt(50), fx.fromInt(100))); // 50% → ONE/2
    expect(s.piety).toBe(start); // omitted — untouched
    expect(s.enjoyment).toBe(start); // omitted — untouched
  });

  it('a non-settler target is a no-op', () => {
    const sim = fresh();
    const notASettler = healthOnlyEntity(sim, 10);
    sim.enqueue({ kind: 'debugSetNeeds', target: notASettler, hunger: 100 });
    expect(() => sim.step()).not.toThrow();
  });
});

describe('debugFillStockpile', () => {
  it("fills every stock slot the building type declares to that slot's capacity", () => {
    const sim = fresh();
    const store = sim.world.create();
    sim.world.add(store, Building, { buildingType: WORKPLACE, tribe: VIKING, built: ONE, level: 0 });
    sim.world.add(store, Stockpile, { amounts: new Map() });

    sim.enqueue({ kind: 'debugFillStockpile', target: store });
    sim.step();

    const amounts = sim.world.get(store, Stockpile).amounts;
    for (const [goodType, capacity] of WORKPLACE_STOCK) expect(amounts.get(goodType)).toBe(capacity);
  });

  it('a non-building target is a no-op', () => {
    const sim = fresh();
    const settler = settlerWithNeeds(sim, fx.fromInt(0));
    sim.enqueue({ kind: 'debugFillStockpile', target: settler });
    expect(() => sim.step()).not.toThrow();
  });
});

describe('debugCompleteConstruction', () => {
  it('forces a construction site straight to built with full Health and a buildingFinished event', () => {
    const sim = fresh();
    const site = sim.world.create();
    sim.world.add(site, Position, { x: fx.fromInt(3), y: fx.fromInt(3) });
    sim.world.add(site, Building, { buildingType: GRANARY, tribe: VIKING, built: fx.fromInt(0), level: 0 });
    sim.world.add(site, UnderConstruction, { labor: fx.fromInt(0) }); // no labor, no delivered material
    sim.world.add(site, Stockpile, { amounts: new Map() });
    sim.world.add(site, Health, { hitpoints: 1, max: GRANARY_MAX_HP });

    sim.enqueue({ kind: 'debugCompleteConstruction', target: site });
    sim.step();

    expect(sim.world.get(site, Building).built).toBe(ONE);
    expect(sim.world.has(site, UnderConstruction)).toBe(false); // a finished building is a plain Building
    expect(sim.world.get(site, Health).hitpoints).toBe(GRANARY_MAX_HP); // ramped to full life
    expect(sim.events.current().some((ev) => ev.kind === 'buildingFinished' && ev.entity === site)).toBe(
      true,
    );
  });

  it('a target that is not a construction site (no UnderConstruction) is a no-op', () => {
    const sim = fresh();
    const built = sim.world.create();
    sim.world.add(built, Building, { buildingType: GRANARY, tribe: VIKING, built: ONE, level: 0 });
    sim.world.add(built, Stockpile, { amounts: new Map() });

    sim.enqueue({ kind: 'debugCompleteConstruction', target: built });
    expect(() => sim.step()).not.toThrow();
    expect(sim.world.has(built, UnderConstruction)).toBe(false);
  });
});
