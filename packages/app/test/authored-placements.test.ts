import { describe, expect, it } from 'vitest';
import { type AuthoredJoinRows, resolveAuthoredPlacements } from '../src/slice/authored-placements.js';
import { AUTHORED_ENTITIES, AUTHORED_ROWS } from './support/authored-entities.js';
import { authoredMap } from './support/slice-maps.js';

/** The pure authored-entity join: a decoded map's `map.cif` StaticObjects → sim placements. */

describe('resolveAuthoredPlacements', () => {
  it('joins by name, passes half-cells verbatim, and stamps the 0-based players as owners', () => {
    const { placements, skipped, droppedGoods, skippedAnimals } = resolveAuthoredPlacements(
      AUTHORED_ENTITIES,
      AUTHORED_ROWS,
      authoredMap(),
    );
    expect(droppedGoods).toBe(1); // mystery_good
    expect(skippedAnimals).toBe(1); // the fixture deer: no animals lane in these rows
    expect(placements).toEqual([
      {
        kind: 'building',
        typeId: 30,
        tribe: 1,
        x: 8,
        y: 4,
        owner: 0,
        goods: [
          { good: 4, amount: 15 },
          { good: 9, amount: 3 },
        ],
      },
      { kind: 'building', typeId: 31, tribe: 1, x: 0, y: 0 }, // no owner: player out of range
      { kind: 'human', jobType: 7, tribe: 1, x: 3, y: 5, owner: 0 },
    ]);
    expect(skipped).toBe(3);
  });

  it('resolves the freehand role spellings the decoded maps really author via the normalized key', () => {
    // `Child_Male`-style casing, `coin maker`-style spacing and `hero_axe_???` suffixes all mean the
    // `jobtypes.ini` slug; an exact-string join dropped them (observed across content/maps/*.json).
    const freehandRows: AuthoredJoinRows = {
      ...AUTHORED_ROWS,
      jobs: [
        { typeId: 7, id: 'builder', name: 'builder' },
        { typeId: 14, id: 'coin_maker', name: 'coin_maker' },
        { typeId: 46, id: 'hero_axe', name: 'hero_axe' },
      ],
    };
    const freehandHumans = {
      buildings: [],
      humans: [
        { tribe: 'viking', role: 'BUILDER', player: 0, hx: 3, hy: 5 },
        { tribe: 'viking', role: 'coin maker', player: 0, hx: 5, hy: 5 },
        { tribe: 'viking', role: 'hero_axe_???', player: 0, hx: 7, hy: 5 },
      ],
      animals: [],
    };
    const { placements, skipped } = resolveAuthoredPlacements(freehandHumans, freehandRows, authoredMap());
    expect(placements.map((p) => (p.kind === 'human' ? p.jobType : -1))).toEqual([7, 14, 46]);
    expect(skipped).toBe(0);
  });

  it('joins setanimal species to animal tribes (id OR name, animals row required), one placement each', () => {
    const rows: AuthoredJoinRows = {
      ...AUTHORED_ROWS,
      tribes: [
        { typeId: 1, id: 'viking' }, // civilization — no animals row, never a species key
        { typeId: 10, id: 'cattle', name: 'cattle' },
        { typeId: 16, id: 'hares', name: 'hares' },
        { typeId: 18, id: 'evil_hares', name: 'evil hares' },
        { typeId: 12, id: 'deers', name: 'deers' }, // tribe row without an animals row
        { typeId: 35, id: 'butterflys', name: 'butterflys' }, // decorative swarm (hitpoints 0)
      ],
      animals: [
        { tribeType: 10, hitpointsAdult: 500 },
        { tribeType: 16, hitpointsAdult: 200 },
        { tribeType: 18, hitpointsAdult: 200 },
        { tribeType: 35, hitpointsAdult: 0 }, // the real butterflies: a swarm the sim never spawns
      ],
    };
    const entities = {
      buildings: [],
      humans: [{ tribe: 'viking', role: 'builder', player: 0, hx: 3, hy: 5 }],
      animals: [
        { species: 'hares', hx: 1, hy: 1 },
        { species: 'evil hares', hx: 2, hy: 1 }, // joins via the display NAME (id is evil_hares)
        { species: 'cattle ', hx: 3, hy: 1 }, // the trailing-space variant maps really author
        { species: 'deers', hx: 4, hy: 1 }, // no animals row → the sim would drop it: skip + count
        { species: 'gryphons', hx: 5, hy: 1 }, // unknown species → skip + count
        { species: 'hares', hx: 99, hy: 1 }, // out of bounds → skip + count
        { species: 'butterflys', hx: 6, hy: 1 }, // hitpoints-0 swarm → spawns nothing: skip + count
      ],
    };
    const { placements, skippedAnimals } = resolveAuthoredPlacements(entities, rows, authoredMap());
    expect(placements).toEqual([
      { kind: 'human', jobType: 7, tribe: 1, x: 3, y: 5, owner: 0 },
      { kind: 'animal', tribe: 16, x: 1, y: 1 },
      { kind: 'animal', tribe: 18, x: 2, y: 1 },
      { kind: 'animal', tribe: 10, x: 3, y: 1 },
    ]);
    expect(skippedAnimals).toBe(4);
  });

  it("resolves a gatherer's authored setproducedgood, dropping an unknown pick without its settler", () => {
    const gatherers = {
      buildings: [],
      humans: [
        { tribe: 'viking', role: 'builder', player: 0, hx: 3, hy: 5, producedGood: 'wheat' },
        // An unresolvable pick costs the pick, not the settler: it spawns gathering everything.
        { tribe: 'viking', role: 'builder', player: 0, hx: 5, hy: 5, producedGood: 'mystery_good' },
        { tribe: 'viking', role: 'builder', player: 0, hx: 7, hy: 5 },
      ],
      animals: [],
    };
    const { placements, skipped, droppedGoods, droppedPicks } = resolveAuthoredPlacements(
      gatherers,
      AUTHORED_ROWS,
      authoredMap(),
    );
    expect(placements.map((p) => (p.kind === 'human' ? p.gatherGood : -1))).toEqual([
      4,
      undefined,
      undefined,
    ]);
    expect(droppedPicks).toBe(1); // mystery_good — counted apart from a building's addgoods stock
    expect(droppedGoods).toBe(0);
    expect(skipped).toBe(0);
  });
});
