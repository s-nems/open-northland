import { components, type GroupDestination, playerCommand } from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { JOB_SOLDIER_SWORD } from '../catalog/jobs.js';
import { spawnSettlerDirect } from '../game/sandbox/index.js';
import type { SceneDefinition } from './types.js';

const SOLDIERS = 1000;
const COLUMNS = 40;

/** One large player gesture through the same command path as a selected army. */
export const armyControlScene: SceneDefinition = {
  id: 'army-control',
  seed: 73,
  terrain: grassTerrain(120, 80),
  initialZoom: 0.5,
  build(sim) {
    const members: GroupDestination[] = [];
    for (let i = 0; i < SOLDIERS; i++) {
      const column = i % COLUMNS;
      const row = Math.floor(i / COLUMNS);
      const entity = spawnSettlerDirect(sim, JOB_SOLDIER_SWORD, 14 + column, 12 + row);
      sim.world.add(entity, components.WalkFacing, {
        direction: components.WALK_DIRECTION.E,
        target: components.WALK_DIRECTION.E,
      });
      members.push({ entity, x: 120 + column * 2, y: 24 + row * 2 });
    }
    sim.enqueue(playerCommand(0, { kind: 'attackMoveUnitGroup', members }));
  },
  runTicks: 1,
  checks: [
    {
      label: 'all 1000 soldiers receive their march and route in the first tick',
      predicate: (sim) =>
        [...sim.world.query(components.PlayerOrder, components.PathFollow)].length === SOLDIERS,
    },
    {
      label: 'one gesture carries the whole army without deferred path requests',
      predicate: (sim) =>
        sim.commands.log.filter(({ command }) => command.kind === 'attackMoveUnitGroup').length === 1 &&
        [...sim.world.query(components.PathRequest)].length === 0,
    },
  ],
};
