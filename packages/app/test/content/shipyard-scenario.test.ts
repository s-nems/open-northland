import {
  cellAnchorNode,
  components,
  halfCellMapFromCells,
  playerCommand,
  Simulation,
} from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { VIKING } from '../../src/catalog/buildings.js';
import { TERRAIN_IMPASSABLE, TERRAIN_OPEN } from '../../src/catalog/terrain.js';
import { HUMAN_PLAYER } from '../../src/game/rules.js';
import { hasRealIr, loadContentUnderTest } from './helpers.js';

/**
 * Shipbuilding over the REAL merged content, the way a player reaches it: a level-4 joinery on a shore,
 * its joiners picked onto the small ship through `setCraftGoods`, wood and leather in a warehouse. The
 * ship yard opens on the water beside the shop and its finished site becomes a moored ship. The sandbox
 * scene `?scene=vehicle-shipyard` proves the same loop on synthetic content only.
 */

const { Building, JobAssignment, Settler, Vehicle } = components;

const JOINERY_LEVEL_4 = 'work_joinery_03';
const WAREHOUSE = 'stock_00';
const JOINER = 'joiner';
const SHIP_SMALL = 'ship_small';
const MAP_W = 26;
const MAP_H = 20;
/** Cell rows above this are water; the ship yard's door lies south of its hull, so the shore runs along
 *  the north of the shop. */
const SHORE_Y = 8;
const JOINERY = { x: 12, y: 11 } as const;
const DEPOT = { x: 5, y: 14 } as const;
/** Spawn cells one row below each building's anchor, on open ground. */
const JOINER_CELLS = [
  { x: 11, y: 13 },
  { x: 13, y: 13 },
  { x: 15, y: 13 },
] as const;
const DEPOT_WOOD = 80;
const DEPOT_LEATHER = 20;
/** Headroom over the measured launch: seed 19 moors the ship by tick 3602 with three joiners. */
const RUN_TICKS = 6_000;
const SEED = 19;
const TICK_CHUNK = 100;

function shoreMap() {
  const typeIds = new Array<number>(MAP_W * MAP_H);
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) typeIds[y * MAP_W + x] = y < SHORE_Y ? TERRAIN_IMPASSABLE : TERRAIN_OPEN;
  }
  return halfCellMapFromCells({ width: MAP_W, height: MAP_H, typeIds });
}

describe.runIf(hasRealIr())('shipbuilding over real content', () => {
  it('a level-4 joinery on a shore launches a small ship its joiners were set to', async () => {
    const { merge } = await loadContentUnderTest();
    const content = merge.content;
    const joinery = content.buildings.find((b) => b.id === JOINERY_LEVEL_4);
    const warehouse = content.buildings.find((b) => b.id === WAREHOUSE);
    const joiner = content.jobs.find((j) => j.id === JOINER);
    const ship = content.goods.find((g) => g.id === SHIP_SMALL);
    const wood = content.goods.find((g) => g.id === 'wood');
    const leather = content.goods.find((g) => g.id === 'leather');
    const shipType = content.vehicles.find((v) => v.id === SHIP_SMALL);
    if (
      joinery === undefined ||
      warehouse === undefined ||
      joiner === undefined ||
      ship === undefined ||
      wood === undefined ||
      leather === undefined ||
      shipType === undefined
    )
      throw new Error('real content lost the shipwright catalog');
    expect(joinery.recipes.some((r) => r.outputs[0]?.goodType === ship.typeId)).toBe(true);

    const sim = new Simulation({ seed: SEED, content, map: shoreMap() });
    sim.enqueueSetup({ kind: 'setNeedsEnabled', enabled: false });
    sim.enqueueSetup({ kind: 'setProfessionProgression', enabled: false });
    const depot = cellAnchorNode(DEPOT.x, DEPOT.y);
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: warehouse.typeId,
      x: depot.hx,
      y: depot.hy,
      tribe: VIKING,
      owner: HUMAN_PLAYER,
      force: true,
      initialGoods: [
        { good: wood.typeId, amount: DEPOT_WOOD },
        { good: leather.typeId, amount: DEPOT_LEATHER },
      ],
    });
    const shop = cellAnchorNode(JOINERY.x, JOINERY.y);
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: joinery.typeId,
      x: shop.hx,
      y: shop.hy,
      tribe: VIKING,
      owner: HUMAN_PLAYER,
      force: true,
    });
    for (const cell of JOINER_CELLS) {
      const at = cellAnchorNode(cell.x, cell.y);
      sim.enqueueSetup({
        kind: 'spawnSettler',
        jobType: joiner.typeId,
        x: at.hx,
        y: at.hy,
        tribe: VIKING,
        owner: HUMAN_PLAYER,
      });
    }
    sim.step();
    const shopEntity = [...sim.world.query(Building)].find(
      (e) => sim.world.get(e, Building).buildingType === joinery.typeId,
    );
    if (shopEntity === undefined) throw new Error('the joinery was not placed');
    const joiners = [...sim.world.query(Settler)].filter(
      (e) => sim.world.get(e, Settler).jobType === joiner.typeId,
    );
    expect(joiners).toHaveLength(JOINER_CELLS.length);
    for (const e of joiners) {
      sim.enqueue(
        playerCommand(HUMAN_PLAYER, {
          kind: 'assignWorker',
          entity: e,
          building: shopEntity,
          jobPriority: [joiner.typeId],
        }),
      );
    }
    sim.step();
    for (const e of joiners) {
      expect(sim.world.tryGet(e, JobAssignment)?.workplace).toBe(shopEntity);
      sim.enqueue(playerCommand(HUMAN_PLAYER, { kind: 'setCraftGoods', entity: e, goods: [ship.typeId] }));
    }
    const shipsAfloat = () =>
      [...sim.world.query(Vehicle)].filter((e) => sim.world.get(e, Vehicle).vehicleType === shipType.typeId);
    while (sim.tick < RUN_TICKS && shipsAfloat().length === 0) sim.run(TICK_CHUNK);
    const [launched] = shipsAfloat();
    if (launched === undefined) throw new Error(`no ship by tick ${sim.tick}`);
    expect(sim.world.get(launched, Vehicle).moored).toBe(true);
    expect(sim.checkInvariants()).toEqual([]);
  }, 120_000);
});
