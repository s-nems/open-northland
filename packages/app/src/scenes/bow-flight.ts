import type { Entity, Simulation } from '@open-northland/sim';
import { cellAnchorNode, components, nodeOfPosition, systems } from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { JOB_ARCHER, JOB_SOLDIER_SWORD } from '../catalog/jobs.js';
import { ENEMY_PLAYER, HUMAN_PLAYER } from '../game/rules.js';
import { spawnSettlerDirect } from '../game/sandbox/index.js';
import type { SceneDefinition } from './types.js';

const MAP_W = 28;
const MAP_H = 24;
const TARGET_HITPOINTS = 100_000;

/**
 * Compact staggered-raster sight-lines: east, west, straight down the screen, and a reverse diagonal. Each
 * target is inside the short bow's ordinary range, while the four pairs are far enough apart that an
 * archer never substitutes another pair's target.
 */
const LANES = [
  { archer: { x: 8, y: 6 }, target: { x: 11, y: 6 } },
  { archer: { x: 20, y: 6 }, target: { x: 17, y: 6 } },
  { archer: { x: 8, y: 14 }, target: { x: 8, y: 18 } },
  { archer: { x: 20, y: 18 }, target: { x: 17, y: 14 } },
] as const;

const { Health, Owner, Position, Projectile, Settler, Stance } = components;

function build(sim: Simulation): void {
  for (const lane of LANES) {
    const target = spawnSettlerDirect(sim, JOB_SOLDIER_SWORD, lane.target.x, lane.target.y, ENEMY_PLAYER);
    const health = sim.world.mut(target, Health);
    health.hitpoints = TARGET_HITPOINTS;
    health.max = TARGET_HITPOINTS;
    const stance = sim.world.mut(target, Stance);
    stance.mode = systems.MILITARY_MODE.IGNORE;
    stance.anchorCell = null;

    const archer = spawnSettlerDirect(sim, JOB_ARCHER, lane.archer.x, lane.archer.y, HUMAN_PLAYER);
    sim.enqueueSetup({ kind: 'attackUnit', entity: archer, target });
  }
}

function combatants(sim: Simulation, owner: number): Entity[] {
  return [...sim.world.query(Settler, Owner, Health)].filter(
    (e) => sim.world.get(e, Owner).player === owner && sim.world.get(e, Health).hitpoints > 0,
  );
}

function archersHoldTheirLanes(sim: Simulation): boolean {
  const expected = new Set(
    LANES.map(({ archer }) => {
      const node = cellAnchorNode(archer.x, archer.y);
      return `${node.hx},${node.hy}`;
    }),
  );
  const archers = combatants(sim, HUMAN_PLAYER);
  return (
    archers.length === LANES.length &&
    archers.every((e) => {
      const node = nodeOfPosition(sim.world.get(e, Position).x, sim.world.get(e, Position).y);
      return expected.has(`${node.hx},${node.hy}`);
    })
  );
}

export const bowFlightScene: SceneDefinition = {
  id: 'bow-flight',
  seed: 41,
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  runTicks: 100,
  initialZoom: 1.1,
  checks: [
    {
      label: 'all four archers remain alive and firing from their authored lanes',
      predicate: archersHoldTheirLanes,
    },
    {
      label: 'every passive target has taken a real short-bow hit without falling',
      predicate: (sim) => {
        const targets = combatants(sim, ENEMY_PLAYER);
        return (
          targets.length === LANES.length &&
          targets.every((e) => sim.world.get(e, Health).hitpoints < TARGET_HITPOINTS)
        );
      },
    },
    {
      label: 'a volley is in flight at the acceptance tick',
      predicate: (sim) => [...sim.world.query(Projectile)].length > 0,
    },
  ],
};
