import {
  cellAnchorNode,
  components,
  type Entity,
  fx,
  nodeOfPosition,
  type Simulation,
} from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { JOB_SOLDIER_SWORD } from '../catalog/jobs.js';
import { TERRAIN_BARREN } from '../catalog/terrain.js';
import { HUMAN_PLAYER } from '../game/rules.js';
import { ANIMAL_TRIBE_STAGS } from '../game/sandbox/content/catalog/animals.js';
import { spawnSettlerDirect } from '../game/sandbox/index.js';
import { goodBySlug } from './sandbox-queries.js';
import type { SceneDefinition } from './types.js';

const WIDTH = 30;
const HEIGHT = 20;
const DESTINATION_X = 26;
const RUN_TICKS = 220;

// Roughness is addressed on the half-cell lattice. A broad cross-map band makes each
// straight route enter and leave the fast patch; the southern diagonal crosses rough ground.
const roughness = Array.from({ length: WIDTH * HEIGHT * 4 }, (_, index) => {
  const hx = index % (WIDTH * 2);
  const hy = Math.floor(index / (WIDTH * 2));
  if (hx >= 20 && hx < 40 && hy >= 6 && hy < 20) return 1;
  if (hx >= 20 && hx < 40 && hy >= 22 && hy < 34) return 4;
  return 2;
});
const grass = grassTerrain(WIDTH, HEIGHT);
const terrainTypes = grass.typeIds.map((typeId, index) => {
  const x = index % WIDTH;
  const y = Math.floor(index / WIDTH);
  return x >= 10 && x < 20 && y >= 3 && y < 10 ? TERRAIN_BARREN : typeId;
});

const { Equipment, Owner, Position, Settler, StayPoint } = components;

function walkers(sim: Simulation): Entity[] {
  return [...sim.world.query(Settler, Owner, Position)].filter(
    (e) => sim.world.get(e, Owner).player === HUMAN_PLAYER,
  );
}

function march(sim: Simulation, y: number, shoes: boolean): Entity {
  const e = spawnSettlerDirect(sim, JOB_SOLDIER_SWORD, 3, y, HUMAN_PLAYER);
  if (shoes) {
    sim.world.add(e, Equipment, {
      boots: { goodType: goodBySlug(sim, 'shoes'), degreeOfUse: fx.fromInt(0) },
      tool: null,
      weapon: null,
      armor: null,
      misc: [null, null, null, null],
    });
  }
  const destination = cellAnchorNode(DESTINATION_X, y);
  sim.enqueueSetup({ kind: 'moveUnit', entity: e, x: destination.hx, y: destination.hy });
  return e;
}

function build(sim: Simulation): void {
  march(sim, 4, false);
  march(sim, 7, true);
  const diagonal = spawnSettlerDirect(sim, JOB_SOLDIER_SWORD, 3, 14, HUMAN_PLAYER);
  const destination = cellAnchorNode(25, 3);
  sim.enqueueSetup({ kind: 'moveUnit', entity: diagonal, x: destination.hx, y: destination.hy });
  const herd = cellAnchorNode(25, 15);
  sim.enqueueSetup({ kind: 'spawnAnimalHerd', tribe: ANIMAL_TRIBE_STAGS, x: herd.hx, y: herd.hy });
}

export const movementContinuityScene: SceneDefinition = {
  id: 'movement-continuity',
  seed: 43,
  terrain: { ...grass, typeIds: terrainTypes, roughness },
  build,
  runTicks: RUN_TICKS,
  initialZoom: 0.8,
  checks: [
    {
      label: 'the barefoot and shod walkers both cross the faster band',
      predicate: (sim) => {
        const humans = walkers(sim);
        return (
          humans.length === 3 &&
          humans.slice(0, 2).every((e) => sim.world.get(e, Position).x > fx.fromInt(10))
        );
      },
    },
    {
      label: 'the shod walker keeps boots equipped through the march',
      predicate: (sim) =>
        [...sim.world.query(Equipment)].some((e) => sim.world.get(e, Equipment).boots !== null),
    },
    {
      label: 'the diagonal walker has left the southern start line',
      predicate: (sim) => {
        // Build creates the two parallel walkers first, then the diagonal walker.
        const diagonal = walkers(sim)[2];
        return diagonal !== undefined && sim.world.get(diagonal, Position).y < fx.fromInt(13);
      },
    },
    {
      label: 'at least one stag moved away from its birth node',
      predicate: (sim) => {
        const terrain = sim.terrain;
        if (terrain === undefined) return false;
        return [...sim.world.query(StayPoint, Position)].some((e) => {
          const p = sim.world.get(e, Position);
          const current = nodeOfPosition(p.x, p.y);
          return terrain.nodeAtClamped(current.hx, current.hy) !== sim.world.get(e, StayPoint).cell;
        });
      },
    },
  ],
};
