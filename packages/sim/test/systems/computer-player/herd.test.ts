import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { Building, Livestock, Owner } from '../../../src/components/index.js';
import { contentIndex } from '../../../src/core/content-index.js';
import type { Simulation } from '../../../src/index.js';
import { positionOfNode } from '../../../src/index.js';
import { ownedBuildings } from '../../../src/systems/ai-shared/seat-roster.js';
import { decisionMemo } from '../../../src/systems/computer-player/build-order/memo.js';
import { entryStatus } from '../../../src/systems/computer-player/build-order/status.js';
import { AI_PROFILES } from '../../../src/systems/computer-player/difficulty.js';
import { HERD_PAIR, seatHerdKept } from '../../../src/systems/computer-player/herd.js';
import { DEFAULT_BUILD_ORDER } from '../../../src/systems/computer-player/index.js';
import { seatCraftPlans } from '../../../src/systems/computer-player/workforce/craft.js';
import type { StockCraftPlan } from '../../../src/systems/computer-player/workforce/craft-stock.js';
import { buildingStaffing } from '../../../src/systems/computer-player/workforce/staffing-plan.js';
import { SeatSupply } from '../../../src/systems/computer-player/workforce/supply.js';
import { attachToFarm } from '../../../src/systems/livestock/index.js';
import { settlerAt } from '../../fixtures/settler.js';
import {
  ANIMAL_FARM_TYPE,
  aiSim,
  BUILDER,
  ctxOf,
  entityOfBuilding,
  husbandryContent,
  placeAnimal,
  placeHq,
  SEAT,
  seatEconomy,
  spawnMen,
  VIKING,
} from './support.js';

/** The sheep's animal tribe this file adds beside the fixture's cow. */
const SHEEP_TRIBE = 14;
const RIVAL = SEAT + 1;

/** The husbandry fixture with a catchable sheep species beside its cattle. */
function herdContent(): ContentSet {
  const base = husbandryContent();
  return parseContentSet({
    ...base,
    tribes: [...base.tribes, { typeId: SHEEP_TRIBE, id: 'sheep' }],
    animals: [
      ...base.animals,
      { id: 'sheep', tribeType: SHEEP_TRIBE, catchable: true, warrantable: true, hitpointsAdult: 1000 },
    ],
  });
}

function placeSheep(sim: Simulation, x: number, y: number, player: number): void {
  const sheep = settlerAt(sim, { jobType: null, tribe: SHEEP_TRIBE, position: positionOfNode(x, y) });
  sim.world.add(sheep, Livestock, {});
  sim.world.add(sheep, Owner, { player });
}

/** A seat on {@link herdContent} with an animal farm, its strategy dressing the army in tunics. */
function farmSeat(): { sim: Simulation; content: ContentSet } {
  const content = herdContent();
  const sim = aiSim(1, content);
  placeHq(sim);
  sim.enqueueSetup({
    kind: 'placeBuilding',
    buildingType: ANIMAL_FARM_TYPE,
    x: 44,
    y: 16,
    tribe: VIKING,
    owner: SEAT,
  });
  spawnMen(sim, 6, BUILDER);
  sim.step();
  seatEconomy(sim, 'standard', ['naturalArms']);
  return { sim, content };
}

const ctxFor = (sim: Simulation, content: ContentSet) => ({ ...ctxOf(sim), content });

describe('the livestock a computer seat keeps', () => {
  it("reads a species kept from a pair, free stock and farm herds together, a rival's apart", () => {
    const { sim, content } = farmSeat();
    const kept = () => seatHerdKept(sim.world, ctxFor(sim, content), SEAT);
    expect(kept()).toBe('none');
    placeAnimal(sim, 4, 4, RIVAL);
    placeAnimal(sim, 5, 4, RIVAL);
    expect(kept()).toBe('none');
    const cow = placeAnimal(sim, 6, 4, SEAT);
    attachToFarm(sim.world, cow, entityOfBuilding(sim, ANIMAL_FARM_TYPE));
    expect(kept()).toBe('none'); // one cow is no pair
    placeAnimal(sim, 7, 4, SEAT);
    expect(kept()).toBe('cattle');
    placeSheep(sim, 8, 4, SEAT);
    expect(kept()).toBe('cattle');
    placeSheep(sim, 9, 4, SEAT);
    expect(kept()).toBe('both');
    expect(HERD_PAIR).toBe(2);
  });

  it('holds the animal farm step while it keeps no pair, and raises it once a pair is claimed', () => {
    const { sim, content } = farmSeat();
    const clothing = DEFAULT_BUILD_ORDER.lines.find((line) => line.id === 'clothing');
    const farmStep = clothing?.steps.find((s) => s.kind === 'place' && s.building === 'work_animal_farm');
    if (farmStep === undefined || farmStep.kind !== 'place') throw new Error('setup: no animal farm step');
    // The farm already placed meets the step, so ask for a second copy.
    const step = { ...farmStep, count: 2 };
    const status = () =>
      entryStatus(
        sim.world,
        ctxFor(sim, content),
        SEAT,
        ownedBuildings(sim.world, SEAT),
        step,
        decisionMemo(),
      );
    expect(status()).toBe('skip');
    placeAnimal(sim, 4, 4, SEAT);
    placeAnimal(sim, 5, 4, SEAT);
    expect(status()).toBe('unmet');
  });

  it('breeds and sews by the species it keeps, and switches as the herd grows', () => {
    const { sim, content } = farmSeat();
    const plans = () => seatCraftPlans(sim.world, ctxFor(sim, content), SEAT, AI_PROFILES.hard);
    const firstWant = () => (plans().work_sewery_01 as StockCraftPlan).wants[0]?.goods;

    placeAnimal(sim, 4, 4, SEAT);
    placeAnimal(sim, 5, 4, SEAT);
    // Cattle only: both breeders on cattle, and the tailors sew leather armour in the tunics' place.
    expect(plans().work_animal_farm).toEqual({ seats: [['cattle']] });
    expect(firstWant()).toEqual(['armor_leather']);

    placeSheep(sim, 6, 4, SEAT);
    placeSheep(sim, 7, 4, SEAT);
    // Both: one breeder of each, tunics for the army.
    expect(plans().work_animal_farm).toEqual({ seats: [['sheep'], ['cattle']] });
    expect(firstWant()).toEqual(['armor_wool']);
  });

  it('raises only sheep and sews tunics on a seat keeping sheep alone, whatever its side', () => {
    const { sim, content } = farmSeat();
    seatEconomy(sim, 'standard', ['ironArms']);
    placeSheep(sim, 6, 4, SEAT);
    placeSheep(sim, 7, 4, SEAT);
    const plans = seatCraftPlans(sim.world, ctxFor(sim, content), SEAT, AI_PROFILES.hard);
    expect(plans.work_animal_farm).toEqual({ seats: [['sheep']] });
    expect((plans.work_sewery_01 as StockCraftPlan).wants[0]?.goods).toEqual(['armor_wool']);
  });

  it('hires nobody at the animal farm while the seat keeps no pair', () => {
    const { sim, content } = farmSeat();
    const plan = () => {
      const ctx = ctxFor(sim, content);
      const owned = ownedBuildings(sim.world, SEAT);
      const farm = entityOfBuilding(sim, ANIMAL_FARM_TYPE);
      const type = contentIndex(content).buildings.get(sim.world.get(farm, Building).buildingType);
      if (type === undefined) throw new Error('setup: no farm type');
      const seat = {
        player: SEAT,
        owned,
        supply: SeatSupply.of(sim.world, ctx, SEAT, owned, DEFAULT_BUILD_ORDER),
        profile: AI_PROFILES.hard,
      };
      return buildingStaffing(sim.world, ctx, seat, farm, type, { operators: 0, carriers: 0 });
    };
    expect(plan()).toMatchObject({ operatorMin: 0, operatorTarget: 0, carrierTarget: 0 });
    placeAnimal(sim, 4, 4, SEAT);
    placeAnimal(sim, 5, 4, SEAT);
    expect(plan()).toMatchObject({ operatorMin: 2, operatorTarget: 2 });
  });
});
