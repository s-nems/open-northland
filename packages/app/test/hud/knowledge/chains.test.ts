import { describe, expect, it } from 'vitest';
import { createKnowledgeBase } from '../../../src/hud/knowledge/base.js';
import {
  billOf,
  buildingsCosting,
  downstreamOf,
  edges,
  inputsOf,
  outputsOf,
  producersOf,
  rawCost,
  recipesOf,
  sourceNameOf,
  upstreamOf,
  usesOf,
} from '../../../src/hud/knowledge/chains.js';
import type { KnowledgeBase } from '../../../src/hud/knowledge/model.js';
import { GOOD, knowledgeContent } from '../../support/knowledge-content.js';

const base = (): KnowledgeBase => createKnowledgeBase(knowledgeContent());

function good(knowledge: KnowledgeBase, id: string) {
  const row = knowledge.goodById.get(id);
  if (row === undefined) throw new Error(`no good ${id}`);
  return row;
}

describe('goods chains', () => {
  it('joins each good to the recipes making and spending it', () => {
    const knowledge = base();
    expect(recipesOf(knowledge, GOOD.flour).map((s) => s.building.id)).toEqual(['work_mill_00']);
    expect(usesOf(knowledge, GOOD.wheat).map((s) => s.building.id)).toEqual(['work_mill_00']);
  });

  it("counts a recipe naming a meal among the dish's uses", () => {
    const knowledge = base();
    const outputs = usesOf(knowledge, GOOD.bread).flatMap((s) => s.recipe.outputs.map((o) => o.goodType));
    expect(outputs).toEqual([GOOD.amulet_food]);
  });

  it('lists the buildings filling a good with no recipe, never its recipe makers', () => {
    const knowledge = base();
    expect(producersOf(knowledge, GOOD.water).map((b) => b.id)).toEqual(['work_well_00']);
    expect(producersOf(knowledge, GOOD.flour)).toEqual([]);
  });

  it('finds the buildings a good pays for', () => {
    expect(buildingsCosting(base(), GOOD.wood).map((b) => b.id)).toEqual(['work_bakery_00', 'handcart']);
  });

  it('draws recipe, slaughter, vehicle and hunt edges once each', () => {
    const graph = edges(base());
    const has = (from: number, to: number) => graph.filter((e) => e.from === from && e.to === to);
    expect(has(GOOD.wheat, GOOD.flour).map((e) => e.kind)).toEqual(['recipe']);
    expect(has(GOOD.cattle, GOOD.leather).map((e) => e.kind)).toEqual(['slaughter']);
    expect(has(GOOD.wood, GOOD.handcart).map((e) => e.kind)).toEqual(['recipe']);
    expect(has(GOOD.prey, GOOD.meat).map((e) => e.kind)).toEqual(['hunt']);
    expect(has(GOOD.prey, GOOD.leather).map((e) => e.kind)).toEqual(['hunt']);
    expect(has(GOOD.sheep, GOOD.meat).map((e) => e.kind)).toEqual(['slaughter']);
  });

  it('reads a good on both sides of the graph', () => {
    const knowledge = base();
    expect(inputsOf(knowledge, GOOD.flour).map((e) => e.from)).toEqual([GOOD.wheat]);
    expect(outputsOf(knowledge, GOOD.flour).map((e) => e.to)).toEqual([GOOD.bread]);
    expect([...upstreamOf(knowledge, GOOD.bread)].sort()).toEqual([GOOD.wheat, GOOD.flour].sort());
    expect(downstreamOf(knowledge, GOOD.wheat)).toEqual(new Set([GOOD.flour, GOOD.bread, GOOD.amulet_food]));
  });

  it('multiplies amounts down to the raw goods, a vehicle through its yard', () => {
    const knowledge = base();
    expect(rawCost(knowledge, GOOD.bread)).toEqual(new Map([[GOOD.wheat, 6]]));
    expect(rawCost(knowledge, GOOD.handcart)).toEqual(new Map([[GOOD.wood, 7]]));
    expect(rawCost(knowledge, GOOD.wood)).toEqual(new Map([[GOOD.wood, 1]]));
  });

  it('bills a card from its recipe, or lists alternatives where only edges feed it', () => {
    const knowledge = base();
    expect(billOf(knowledge, good(knowledge, 'bread'))).toEqual([
      { good: good(knowledge, 'flour'), amount: 3, alternative: false },
    ]);
    expect(billOf(knowledge, good(knowledge, 'meat')).map((i) => [i.good.id, i.alternative])).toEqual([
      ['prey', false],
      ['sheep', true],
      ['cattle', true],
    ]);
  });

  it('names who brings a raw good in: the building first, else the trade', () => {
    const knowledge = base();
    expect(sourceNameOf(knowledge, good(knowledge, 'water'))).toBe(
      knowledge.buildingById.get('work_well_00')?.name,
    );
    expect(sourceNameOf(knowledge, good(knowledge, 'wood'))).toBe(knowledge.jobById.get('collector')?.name);
    expect(sourceNameOf(knowledge, good(knowledge, 'iron'))).toBe('');
  });
});
