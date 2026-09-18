import { components, playerCommand, type Simulation, systems } from '@open-northland/sim';
import { expect, it } from 'vitest';
import { HUMAN_PLAYER } from '../../src/game/rules.js';
import { BUILDING_WAREHOUSE_00, GOOD_STONE, GOOD_WOOD } from '../../src/game/sandbox/index.js';
import { createSceneSim } from '../../src/scenes/runtime.js';
import { TIMBER_TRIBUTE, tributeScene } from '../../src/scenes/tribute.js';
import { sceneAcceptance } from './scene-case.js';

sceneAcceptance(tributeScene, import.meta.url);

const { Building, Stockpile } = components;
const NEIGHBOUR_PLAYER = 1;
/** The scene enables its script from tick 0, so the load pass opens the tributes on tick 1. */
const LOAD_PASS = 1;

function warehousesHold(sim: Simulation, good: number): number {
  let total = 0;
  for (const e of sim.world.query(Building, Stockpile)) {
    if (sim.world.get(e, Building).buildingType !== BUILDING_WAREHOUSE_00) continue;
    total += sim.world.get(e, Stockpile).amounts.get(good) ?? 0;
  }
  return total;
}

/** The browser's pay button end to end: the seat command drains the warehouse and the next pass turns
 *  the neighbour friendly. */
it('paying the timber tribute empties the warehouse of it and buys the friendship', () => {
  const sim = createSceneSim(tributeScene);
  sim.run(LOAD_PASS);
  const before = sim.openTributes(HUMAN_PLAYER).find((t) => t.slot === TIMBER_TRIBUTE);
  expect(before?.payable).toBe(true);

  sim.enqueue(
    playerCommand(HUMAN_PLAYER, { kind: 'payTribute', player: HUMAN_PLAYER, slot: TIMBER_TRIBUTE }),
  );
  sim.run(systems.MISSION_EVALUATION_TICKS);

  // The demand left the warehouses as a whole: the wood from the one that held it, the stone from
  // the first in id order, which also held it all.
  const wood = before?.demands.find((d) => d.good === GOOD_WOOD);
  const stone = before?.demands.find((d) => d.good === GOOD_STONE);
  expect(warehousesHold(sim, GOOD_WOOD)).toBe((wood?.onHand ?? 0) - (wood?.amount ?? 0));
  expect(warehousesHold(sim, GOOD_STONE)).toBe((stone?.onHand ?? 0) - (stone?.amount ?? 0));
  expect(sim.openTributes(HUMAN_PLAYER).map((t) => t.slot)).not.toContain(TIMBER_TRIBUTE);
  expect(sim.diplomacyStance(NEIGHBOUR_PLAYER, HUMAN_PLAYER)).toBe('friend');
  expect(sim.diplomacyStance(HUMAN_PLAYER, NEIGHBOUR_PLAYER)).toBe('friend');
});
