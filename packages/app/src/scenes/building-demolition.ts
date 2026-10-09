import {
  components,
  constructionBillForType,
  type Entity,
  fx,
  type Simulation,
  type WorldSnapshot,
} from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { placeBuiltSandboxBuilding, placeSandboxSite } from '../game/sandbox/index.js';
import type { SceneDefinition, StageOrder } from './types.js';

function build(sim: Simulation): void {
  const examples = [
    { type: 'home_level_00', tribe: 1, x: 6, y: 7, hp: 8 },
    { type: 'home_level_02', tribe: 3, x: 13, y: 7, hp: 8 },
    { type: 'stock_01', tribe: 4, x: 20, y: 7, hp: 8 },
    { type: 'headquarters', tribe: 1, x: 6, y: 19, hp: 8 },
    { type: 'tower_00', tribe: 1, x: 13, y: 19, hp: 100 },
  ];
  for (const { type, tribe, x, y, hp } of examples) {
    const entity = placeBuiltSandboxBuilding(sim, type, x, y, 0, { tribe });
    const health = sim.world.mut(entity, components.Health);
    health.hitpoints = Math.max(1, Math.floor((health.max * hp) / 100));
    if (hp < 100) sim.world.add(entity, components.Damaged, { lastHitTick: null });
  }
  const site = placeSandboxSite(sim, 'home_level_00', 20, 19, 0);
  const building = sim.world.mut(site, components.Building);
  building.built = fx.fromFloat(0.55);
  sim.world.mut(site, components.UnderConstruction).labor = building.built;
  const stock = sim.world.mut(site, components.Stockpile).amounts;
  for (const line of constructionBillForType(sim.content.buildings, building.buildingType))
    stock.set(line.goodType, line.amount);
}

export function demolitionOrders(snapshot: WorldSnapshot): StageOrder[] {
  return snapshot.entities
    .filter((entity) => entity.components.Building !== undefined)
    .map((entity) => ({ by: 'viewer', command: { kind: 'demolish', building: entity.id as Entity } }));
}

export const buildingDemolitionScene: SceneDefinition = {
  id: 'building-demolition',
  seed: 95,
  terrain: grassTerrain(28, 26),
  graphicTribes: [1, 3, 4],
  initialZoom: 1,
  build,
  runTicks: 60,
  stages: [
    {
      id: 'demolition',
      focus: { x: 13, y: 12 },
      zoom: 1,
      actions: [{ label: 'demolish', kind: 'orders', orders: demolitionOrders }],
    },
  ],
  checks: [
    {
      label: 'damaged, intact and unfinished buildings remain available for demolition',
      predicate: (sim) => {
        const buildings = [...sim.world.query(components.Building)];
        const sites = buildings.filter((e) => sim.world.has(e, components.UnderConstruction));
        return (
          buildings.length === 6 &&
          sites.length === 1 &&
          sites.every((e) => sim.world.get(e, components.Building).built === fx.fromFloat(0.55))
        );
      },
    },
  ],
};
