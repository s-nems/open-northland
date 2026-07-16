import { type ContentSet, IR_VERSION, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { goodsGraph } from '../../src/systems/index.js';

/**
 * The goods-graph read model — `goodsGraph` surfaces the recipe-DAG IR (`GoodType.classification`
 * node layers + `GoodType.productionInputs` input edges, joined with the output side
 * `BuildingType.produces`/`recipe`) as one node per good. It is the HUD's fourth derived view, the
 * only one over content rather than world state: a pure, deterministic read, no mechanic added. These
 * tests pin the join — node layers, the input edges, the output-side producer list, and the empties.
 */

const NONE = 0;
const WOOD = 1; // raw (producedOnMap)
const PLANK = 2; // produced (producedInHouse), consumes wood
const STONE = 3; // raw, nothing makes or consumes it
const BREAD = 4; // produced, consumes flour + water; made by two building types
const FLOUR = 5; // produced + input good
const WATER = 6; // raw + input good

// A content set exercising every node layer and both join sides. The classification flags and
// productionInputs are the goods-graph IR; the buildings' produces/recipe are the output side.
function graphContent(): ContentSet {
  return parseContentSet({
    manifest: { version: IR_VERSION, generatedFrom: { game: 'synthetic-test-fixture' }, locale: 'eng' },
    goods: [
      { typeId: NONE, id: 'none' }, // unclassified — neither flag
      { typeId: WOOD, id: 'wood', classification: { producedOnMap: true } },
      {
        typeId: PLANK,
        id: 'plank',
        classification: { producedInHouse: true },
        productionInputs: [{ goodType: WOOD, amount: 2 }],
      },
      { typeId: STONE, id: 'stone', classification: { producedOnMap: true } },
      {
        typeId: BREAD,
        id: 'bread',
        classification: { producedInHouse: true },
        productionInputs: [
          { goodType: FLOUR, amount: 1 },
          { goodType: WATER, amount: 3 },
        ],
      },
      {
        typeId: FLOUR,
        id: 'flour',
        classification: { producedInHouse: true, inputGood: true },
        productionInputs: [{ goodType: WOOD, amount: 1 }],
      },
      { typeId: WATER, id: 'water', classification: { producedOnMap: true, inputGood: true } },
    ],
    jobs: [{ typeId: 0, id: 'idle' }],
    buildings: [
      // sawmill: produces plank via `produces` (output good list, the preferred output source).
      { typeId: 10, id: 'sawmill', kind: 'workplace', produces: [PLANK] },
      // mill: produces flour.
      { typeId: 11, id: 'mill', kind: 'workplace', produces: [FLOUR] },
      // bakery: produces bread, declared via materialized `recipes` (no `produces`) — the fallback.
      {
        typeId: 12,
        id: 'bakery',
        kind: 'workplace',
        recipes: [
          {
            inputs: [{ goodType: FLOUR, amount: 1 }],
            outputs: [{ goodType: BREAD, amount: 1 }],
            ticks: 20,
          },
        ],
      },
      // bakery2: a SECOND bread producer, to prove producedBy lists every producer, sorted.
      { typeId: 13, id: 'bakery2', kind: 'workplace', produces: [BREAD] },
      // warehouse: a non-producing building — must contribute no producer edge.
      { typeId: 14, id: 'warehouse', kind: 'headquarters' },
    ],
  });
}

describe('goodsGraph', () => {
  it('has one node per good', () => {
    const graph = goodsGraph(graphContent());
    expect(graph.size).toBe(7);
    for (const t of [NONE, WOOD, PLANK, STONE, BREAD, FLOUR, WATER]) {
      expect(graph.has(t)).toBe(true);
    }
  });

  it('assigns node layers from the classification flags', () => {
    const graph = goodsGraph(graphContent());
    expect(graph.get(WOOD)?.layer).toBe('raw'); // producedOnMap
    expect(graph.get(STONE)?.layer).toBe('raw');
    expect(graph.get(WATER)?.layer).toBe('raw');
    expect(graph.get(PLANK)?.layer).toBe('produced'); // producedInHouse
    expect(graph.get(FLOUR)?.layer).toBe('produced');
    expect(graph.get(BREAD)?.layer).toBe('produced');
    expect(graph.get(NONE)?.layer).toBe('unclassified'); // neither flag
  });

  it('marks the input goods', () => {
    const graph = goodsGraph(graphContent());
    expect(graph.get(FLOUR)?.inputGood).toBe(true);
    expect(graph.get(WATER)?.inputGood).toBe(true);
    expect(graph.get(WOOD)?.inputGood).toBe(false);
    expect(graph.get(PLANK)?.inputGood).toBe(false);
  });

  it('carries the input-side edges (productionInputs) in source order', () => {
    const graph = goodsGraph(graphContent());
    expect(graph.get(PLANK)?.inputs).toEqual([{ goodType: WOOD, amount: 2 }]);
    expect(graph.get(BREAD)?.inputs).toEqual([
      { goodType: FLOUR, amount: 1 },
      { goodType: WATER, amount: 3 },
    ]);
    expect(graph.get(WOOD)?.inputs).toEqual([]); // a raw good consumes nothing
  });

  it('joins the output side — which building types produce each good', () => {
    const graph = goodsGraph(graphContent());
    expect(graph.get(PLANK)?.producedBy).toEqual([10]); // sawmill, via `produces`
    expect(graph.get(FLOUR)?.producedBy).toEqual([11]); // mill
    expect(graph.get(BREAD)?.producedBy).toEqual([12, 13]); // bakery (recipe fallback) + bakery2, sorted
    expect(graph.get(WOOD)?.producedBy).toEqual([]); // raw — no producer
    expect(graph.get(STONE)?.producedBy).toEqual([]); // produced by nothing
  });

  it('is deterministic — identical content yields an identical graph', () => {
    const a = goodsGraph(graphContent());
    const b = goodsGraph(graphContent());
    expect([...a.entries()]).toEqual([...b.entries()]);
  });

  it('is empty for content with no goods', () => {
    const empty = parseContentSet({
      manifest: { version: IR_VERSION, generatedFrom: { game: 'synthetic-test-fixture' }, locale: 'eng' },
      goods: [],
      jobs: [{ typeId: 0, id: 'idle' }],
      buildings: [],
    });
    expect(goodsGraph(empty).size).toBe(0);
  });
});
