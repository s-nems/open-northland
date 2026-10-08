import { components, type Simulation } from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { placeBuiltSandboxBuilding } from '../game/sandbox/index.js';
import type { SceneDefinition } from './types.js';

const HEALTH = [100, 82, 60, 30, 8] as const;
const ROWS = [
  { type: 'home_level_00', tribe: 1, y: 5 },
  { type: 'headquarters', tribe: 1, y: 18 },
  { type: 'home_level_02', tribe: 3, y: 27 },
  { type: 'stock_01', tribe: 4, y: 35 },
] as const;

function build(sim: Simulation, health: readonly number[]): void {
  for (const { type, tribe, y } of ROWS) {
    for (const [column, hp] of health.entries()) {
      const entity = placeBuiltSandboxBuilding(sim, type, 6 + column * 7, y, 0, { tribe });
      const pool = sim.world.mut(entity, components.Health);
      pool.hitpoints = Math.max(1, Math.floor((pool.max * hp) / 100));
      if (hp < 100) sim.world.add(entity, components.Damaged, { lastHitTick: null });
    }
  }
}

function damageScene(id: string, health: readonly number[]): SceneDefinition {
  return {
    id,
    seed: 94,
    terrain: grassTerrain(40, 42),
    graphicTribes: [1, 3, 4],
    initialZoom: 0.65,
    build: (sim) => build(sim, health),
    runTicks: 120,
    checks: [
      {
        label: 'damage is cosmetic: unattended buildings retain every authored health level',
        predicate: (sim) => {
          const buildings = [...sim.world.query(components.Building, components.Health)];
          return (
            buildings.length === ROWS.length * health.length &&
            buildings.every((entity, i) => {
              const pool = sim.world.get(entity, components.Health);
              return (
                pool.hitpoints ===
                Math.max(1, Math.floor((pool.max * (health[i % health.length] ?? 100)) / 100))
              );
            })
          );
        },
      },
    ],
  };
}

export const buildingDamageScene = damageScene('building-damage', HEALTH);
export const buildingDamageVariantsScene = damageScene('building-damage-variants', [4, 4, 4, 4, 4]);
