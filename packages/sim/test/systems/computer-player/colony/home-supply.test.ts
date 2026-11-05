import { describe, expect, it } from 'vitest';
import { Settler } from '../../../../src/components/index.js';
import type { Entity } from '../../../../src/ecs/world.js';
import type { SeatEnv } from '../../../../src/systems/computer-player/colony/env.js';
import { workshopShelves } from '../../../../src/systems/computer-player/colony/home-supply.js';
import {
  aiSim,
  CIVILIST,
  ctxOf,
  entityOfBuilding,
  HQ_X,
  HQ_Y,
  IRON,
  JOINER,
  JOINERY_TYPE,
  placeHq,
  SEAT,
  spawnMen,
  VIKING,
  WOOD,
} from '../support.js';

/** The fixture joinery's wooden tool, made of wood alone; its iron tool takes iron too. */
const TOOL_WOODEN = 6;
/** What the fixture joinery's shelf holds of an input. */
const SHELF_UNITS = 5;

/** A seat with a standing joinery and, with `goods`, a joiner set to make them. */
function joinerySeat(goods: readonly number[] | null): {
  readonly env: Pick<SeatEnv, 'world' | 'ctx'>;
  readonly joinery: Entity;
} {
  const sim = aiSim();
  placeHq(sim);
  sim.enqueueSetup({
    kind: 'placeBuilding',
    buildingType: JOINERY_TYPE,
    x: HQ_X - 8,
    y: HQ_Y + 6,
    tribe: VIKING,
    owner: SEAT,
    force: true,
    underConstruction: false,
  });
  spawnMen(sim, 1);
  sim.step();
  const joinery = entityOfBuilding(sim, JOINERY_TYPE);
  const man = [...sim.world.query(Settler)].find((e) => sim.world.get(e, Settler).jobType === CIVILIST);
  if (man === undefined) throw new Error('setup: a spawned man expected');
  if (goods !== null) {
    sim.enqueueSetup({ kind: 'assignWorker', entity: man, building: joinery, jobPriority: [JOINER] });
    sim.enqueueSetup({ kind: 'setProductionGoods', entity: man, goods });
    sim.step();
  }
  return { env: { world: sim.world, ctx: ctxOf(sim) }, joinery };
}

describe("a workshop's input shelves", () => {
  it('hold the inputs of what its crew is set to make, not of every recipe', () => {
    const { env, joinery } = joinerySeat([TOOL_WOODEN]);
    const shelves = workshopShelves(env, [joinery]);
    expect(shelves.get(WOOD)).toBe(SHELF_UNITS);
    expect(shelves.has(IRON)).toBe(false);
  });

  it('are none while nobody works there', () => {
    const { env, joinery } = joinerySeat(null);
    expect(workshopShelves(env, [joinery]).size).toBe(0);
  });
});
