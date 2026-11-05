import { buildingFootprintFor, footprintCellDx } from '@open-northland/data';
import {
  adminCommand,
  cellAnchorNode,
  components,
  hexDistanceBetween,
  nodeOfPosition,
  positionOfNode,
  type Simulation,
} from '@open-northland/sim';
import { grassTerrain } from '../../catalog/buildings.js';
import { HUMAN_PLAYER, PRIMARY_TRIBE } from '../../game/rules.js';
import {
  BUILDING_HOME_00,
  spawnVehicleDirect,
  VEHICLE_CATAPULT,
  VEHICLE_HANDCART,
  VEHICLE_OXCART,
} from '../../game/sandbox/index.js';
import type { SceneDefinition } from '../types.js';

const { Building, Position } = components;
const PLOTS = [
  { x: 10, y: 12, type: VEHICLE_HANDCART },
  { x: 24, y: 12, type: VEHICLE_OXCART },
  { x: 38, y: 12, type: VEHICLE_CATAPULT },
];
const PLACE_TICK = 80;
const ORDER_SEQUENCE = 1_000_000;
// Synthetic headless footprint; the browser's decoded building supplies its actual shape.
const BODY = [
  { dx: 0, dy: 0 },
  { dx: 1, dy: 0 },
];

function build(sim: Simulation): void {
  const house = sim.content.buildings.find((b) => b.typeId === BUILDING_HOME_00);
  const footprint = house === undefined ? undefined : buildingFootprintFor(house, PRIMARY_TRIBE);
  const cell = footprint?.blocked[0];
  if (cell === undefined) throw new Error('the clearance scene needs a house body');
  for (const [i, plot] of PLOTS.entries()) {
    const at = cellAnchorNode(plot.x, plot.y);
    const e = spawnVehicleDirect(sim, plot.type, plot.x, plot.y);
    const pos = sim.world.mut(e, Position);
    const start = positionOfNode(at.hx + footprintCellDx(at.hy, cell), at.hy + cell.dy);
    pos.x = start.x;
    pos.y = start.y;
    sim.enqueueAt(
      adminCommand({
        kind: 'placeBuilding',
        buildingType: BUILDING_HOME_00,
        tribe: PRIMARY_TRIBE,
        owner: HUMAN_PLAYER,
        x: at.hx,
        y: at.hy,
        ignoreTechnology: true,
        underConstruction: true,
      }),
      PLACE_TICK,
      ORDER_SEQUENCE + i,
    );
  }
}

export const vehicleBuildingClearanceScene: SceneDefinition = {
  id: 'vehicle-building-clearance',
  seed: 17,
  terrain: grassTerrain(48, 24),
  contentExtras: {
    buildingFootprints: new Map([
      [
        BUILDING_HOME_00,
        {
          blocked: BODY,
          familyBody: BODY,
          reserved: BODY,
          door: { dx: -1, dy: 0 },
          workArea: [],
        },
      ],
    ]),
  },
  build,
  initialZoom: 0.8,
  runTicks: PLACE_TICK + 20,
  checks: [
    {
      label: 'all three houses can be placed over their vehicles',
      predicate: (sim) => [...sim.world.query(Building)].length === PLOTS.length,
    },
    {
      label: 'every vehicle stands clear of the foundations and doors',
      predicate: (sim) => {
        const cells = [...sim.world.query(Building, Position)].flatMap((e) => {
          const building = sim.world.get(e, Building);
          const type = sim.content.buildings.find((b) => b.typeId === building.buildingType);
          const fp =
            type === undefined ? undefined : buildingFootprintFor(type, building.tribe, building.record);
          if (fp === undefined) return [];
          const pos = sim.world.get(e, Position);
          const at = nodeOfPosition(pos.x, pos.y);
          return [...fp.blocked, ...(fp.door === undefined ? [] : [fp.door])].map((c) => ({
            hx: at.hx + footprintCellDx(at.hy, c),
            hy: at.hy + c.dy,
          }));
        });
        return sim.vehiclesOf(HUMAN_PLAYER).every((v) => {
          const type = sim.content.vehicles.find((t) => t.typeId === v.vehicleType);
          const at = v.at;
          return (
            at !== null &&
            type !== undefined &&
            cells.every((c) => hexDistanceBetween(at.hx, at.hy, c.hx, c.hy) > type.logicSize)
          );
        });
      },
    },
  ],
};
