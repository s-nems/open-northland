import { type ContentSet, IR_VERSION, parseContentSet } from '@vinland/data';
import { beforeEach, describe, expect, it } from 'vitest';
import { Building, Position, Stockpile } from '../src/components/index.js';
import type { Entity } from '../src/ecs/world.js';
import type { SimEvent } from '../src/events.js';
import { ONE, Simulation, fx } from '../src/index.js';
import { type SystemContext, constructionSystem } from '../src/systems/index.js';

/**
 * Unit + integration tests for the ConstructionSystem — an under-construction building (`built < ONE`)
 * whose own stockpile holds its full `construction` material cost consumes the materials and flips to
 * `built = ONE`, emitting `buildingFinished`. A building type with an empty cost (the headquarters)
 * finishes on the first construction tick. WHO delivers the materials is the (deferred) transport path;
 * this proves the build-completion half.
 *
 * Content is built with `parseContentSet` (not the shared fixture) so the `construction` cost is explicit
 * and the golden slice — whose buildings carry no cost and are placed already-built — is untouched.
 */

const VIKING = 1;
const STONE = 1;
const WOOD = 2;
const HOUSE = 2; // a residence needing 2× stone + 1× wood to build
const HEADQUARTERS = 1; // free — empty construction cost

function constructionContent(): ContentSet {
  return parseContentSet({
    manifest: { version: IR_VERSION, generatedFrom: { game: 'synthetic-test-fixture' }, locale: 'eng' },
    goods: [
      { typeId: 0, id: 'none' },
      { typeId: STONE, id: 'stone' },
      { typeId: WOOD, id: 'wood' },
    ],
    jobs: [{ typeId: 0, id: 'idle' }],
    buildings: [
      { typeId: HEADQUARTERS, id: 'headquarters', kind: 'headquarters' }, // construction defaults to []
      {
        typeId: HOUSE,
        id: 'home_small',
        kind: 'home',
        homeSize: 2,
        // 2× stone + 1× wood — a repeat in the source good-id list encodes the amount.
        construction: [
          { goodType: STONE, amount: 2 },
          { goodType: WOOD, amount: 1 },
        ],
      },
    ],
  });
}

beforeEach(() => {
  Building.store.clear();
  Stockpile.store.clear();
  Position.store.clear();
});

function ctxOf(sim: Simulation): SystemContext {
  return { content: sim.content, rng: sim.rng, tick: sim.tick, events: sim.events };
}

/** Place an under-construction building (`built = 0`) holding the given starting materials. */
function placeSite(sim: Simulation, buildingType: number, stock: Record<number, number> = {}): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(0), y: fx.fromInt(0) });
  sim.world.add(e, Building, { buildingType, tribe: VIKING, built: fx.fromInt(0), level: 0 });
  sim.world.add(e, Stockpile, {
    amounts: new Map<number, number>(Object.entries(stock).map(([g, n]) => [Number(g), n])),
  });
  return e;
}

function finishedEvents(sim: Simulation): readonly SimEvent[] {
  return sim.events.current().filter((ev) => ev.kind === 'buildingFinished');
}

describe('constructionSystem', () => {
  it('does NOT finish a site missing some of its materials', () => {
    const sim = new Simulation({ seed: 1, content: constructionContent() });
    const e = placeSite(sim, HOUSE, { [STONE]: 1 }); // needs 2 stone + 1 wood, has only 1 stone
    constructionSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(e, Building).built).toBe(fx.fromInt(0)); // still under construction
    expect(finishedEvents(sim)).toHaveLength(0);
    // The partial materials are NOT consumed — the site keeps waiting on the rest.
    expect(sim.world.get(e, Stockpile).amounts.get(STONE)).toBe(1);
  });

  it('finishes a site once its full material cost is present, consuming the materials', () => {
    const sim = new Simulation({ seed: 1, content: constructionContent() });
    const e = placeSite(sim, HOUSE, { [STONE]: 2, [WOOD]: 1 });
    constructionSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(e, Building).built).toBe(ONE); // built
    expect(finishedEvents(sim)).toEqual([{ kind: 'buildingFinished', entity: e }]);
    // The materials are spent into the structure.
    expect(sim.world.get(e, Stockpile).amounts.get(STONE)).toBe(0);
    expect(sim.world.get(e, Stockpile).amounts.get(WOOD)).toBe(0);
  });

  it('leaves any surplus material beyond the cost in the stockpile', () => {
    const sim = new Simulation({ seed: 1, content: constructionContent() });
    const e = placeSite(sim, HOUSE, { [STONE]: 5, [WOOD]: 3 }); // cost 2 stone + 1 wood
    constructionSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(e, Building).built).toBe(ONE);
    expect(sim.world.get(e, Stockpile).amounts.get(STONE)).toBe(3); // 5 - 2
    expect(sim.world.get(e, Stockpile).amounts.get(WOOD)).toBe(2); // 3 - 1
  });

  it('finishes a free (empty-cost) building immediately', () => {
    const sim = new Simulation({ seed: 1, content: constructionContent() });
    const e = placeSite(sim, HEADQUARTERS); // construction cost []
    constructionSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(e, Building).built).toBe(ONE);
    expect(finishedEvents(sim)).toEqual([{ kind: 'buildingFinished', entity: e }]);
  });

  it('never revisits an already-built building', () => {
    const sim = new Simulation({ seed: 1, content: constructionContent() });
    const e = sim.world.create();
    sim.world.add(e, Building, { buildingType: HOUSE, tribe: VIKING, built: ONE, level: 0 });
    // A built house that happens to hold its materials must NOT re-consume them.
    sim.world.add(e, Stockpile, {
      amounts: new Map<number, number>([
        [STONE, 2],
        [WOOD, 1],
      ]),
    });
    constructionSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(e, Stockpile).amounts.get(STONE)).toBe(2); // untouched
    expect(finishedEvents(sim)).toHaveLength(0);
  });

  it('is deterministic — two runs from the same seed reach the same finished state', () => {
    const run = (): string => {
      const sim = new Simulation({ seed: 7, content: constructionContent() });
      placeSite(sim, HOUSE, { [STONE]: 2, [WOOD]: 1 });
      constructionSystem(sim.world, ctxOf(sim));
      return sim.hashState();
    };
    expect(run()).toBe(run());
  });
});

describe('placeBuilding underConstruction (CommandSystem)', () => {
  it('starts a building at built=0 with an empty hold, then the constructionSystem builds it once stocked', () => {
    const sim = new Simulation({ seed: 1, content: constructionContent() });
    sim.enqueue({
      kind: 'placeBuilding',
      buildingType: HOUSE,
      x: 0,
      y: 0,
      tribe: VIKING,
      underConstruction: true,
    });
    sim.step(); // commandSystem places the under-construction site
    const e = [...sim.world.query(Building)][0];
    expect(sim.world.get(e, Building).built).toBe(fx.fromInt(0)); // under construction
    expect(sim.world.get(e, Stockpile).amounts.size).toBe(0); // empty hold — accumulates deliveries

    // Stock the site with its materials (the deferred carrier-delivery, done by hand here) and step:
    // the constructionSystem finishes it.
    const stock = sim.world.get(e, Stockpile).amounts;
    stock.set(STONE, 2);
    stock.set(WOOD, 1);
    sim.step();
    expect(sim.world.get(e, Building).built).toBe(ONE);
  });

  it('places an already-built building (default) seeded from its stock initials', () => {
    const sim = new Simulation({ seed: 1, content: constructionContent() });
    sim.enqueue({ kind: 'placeBuilding', buildingType: HOUSE, x: 0, y: 0, tribe: VIKING }); // no flag
    sim.step();
    const e = [...sim.world.query(Building)][0];
    expect(sim.world.get(e, Building).built).toBe(ONE); // immediately built — the slice path
  });
});
