import { cellAnchorNode, components, ONE } from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { JOB_BUILDER } from '../catalog/jobs.js';
import { HUMAN_PLAYER, PRIMARY_TRIBE } from '../game/rules.js';
import {
  BUILDING_FARM,
  BUILDING_WAREHOUSE_00,
  buildingDef,
  placeSandboxBuilding,
  placeSandboxSite,
  spawnSandboxSettler,
} from '../game/sandbox/index.js';
import type { SceneDefinition } from './types.js';

const { Building, UnderConstruction } = components;

export const farmConstructionScene: SceneDefinition = {
  id: 'farm-construction',
  seed: 7,
  terrain: grassTerrain(30, 22),
  initialZoom: 2,
  runTicks: 8_000,
  build(sim) {
    const depot = cellAnchorNode(15, 16);
    const bill = buildingDef(sim, BUILDING_FARM)?.construction ?? [];
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: BUILDING_WAREHOUSE_00,
      x: depot.hx,
      y: depot.hy,
      tribe: PRIMARY_TRIBE,
      owner: HUMAN_PLAYER,
      force: true,
      initialGoods: bill.map((line) => ({ good: line.goodType, amount: line.amount * 4 })),
    });
    placeSandboxSite(sim, BUILDING_FARM, 12, 11);
    placeSandboxBuilding(sim, BUILDING_FARM, 17, 11);
    for (let i = 0; i < 4; i++)
      spawnSandboxSettler(sim, JOB_BUILDER, 14 + (i % 2), 8 + Math.floor(i / 2), HUMAN_PLAYER);
  },
  checks: [
    {
      label: 'the crew finishes the farm beside the completed reference',
      predicate: (sim) => {
        let farms = 0;
        for (const e of sim.world.query(Building)) {
          const b = sim.world.get(e, Building);
          if (b.buildingType !== BUILDING_FARM) continue;
          if (b.built !== ONE || sim.world.has(e, UnderConstruction)) return false;
          farms++;
        }
        return farms === 2;
      },
    },
  ],
};
