import {
  type CellTerrainMap,
  components,
  type Entity,
  FOG_STATE,
  playerCommand,
  type Simulation,
} from '@open-northland/sim';
import { GRASS } from '../catalog/buildings.js';
import { JOB_SCOUT } from '../catalog/jobs.js';
import { TERRAIN_IMPASSABLE } from '../catalog/terrain.js';
import { HUMAN_PLAYER } from '../game/rules.js';
import { spawnSettlerDirect } from '../game/sandbox/index.js';
import { createSceneSim } from './runtime.js';
import type { SceneDefinition } from './types.js';

/**
 * Two scouts on a large island under classic fog, a smaller island across a strait wider than their
 * sight. Select both scouts and press Explore in the action ring: they sweep every unseen corner of their
 * island but the thinnest scraps along its shore, and each reports in the messages once done. The far
 * island stays dark.
 */

const MAP_W = 120;
const MAP_H = 76;
const INITIAL_ZOOM = 0.6;
/** The island the scouts stand on, an ellipse in cells. */
const ISLAND = { cx: 40, cy: 38, rx: 35, ry: 30 } as const;
/** The island across the strait, out of the scouts' walk. */
const FAR_ISLAND = { cx: 108, cy: 38, rx: 8, ry: 12 } as const;
const SCOUTS = [
  { x: 38, y: 36 },
  { x: 42, y: 40 },
] as const;
/** Ticks the scouts take to appear: their spawn commands apply on the first tick. */
const SPAWN_TICKS = 1;
/** Both sweeps over the island, with margin. */
const SWEEP_TICKS = 30_000;
/** How deep in the fog, in cells, an unseen scrap of the island a finished sweep leaves may reach. */
const SCRAP_DEPTH = 3;

const { Settler } = components;

type Ellipse = { readonly cx: number; readonly cy: number; readonly rx: number; readonly ry: number };

function inside(e: Ellipse, x: number, y: number): boolean {
  return ((x - e.cx) / e.rx) ** 2 + ((y - e.cy) / e.ry) ** 2 <= 1;
}

function islandsTerrain(): CellTerrainMap {
  const typeIds = new Array<number>(MAP_W * MAP_H).fill(TERRAIN_IMPASSABLE);
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      if (inside(ISLAND, x, y) || inside(FAR_ISLAND, x, y)) typeIds[y * MAP_W + x] = GRASS;
    }
  }
  return { width: MAP_W, height: MAP_H, typeIds };
}

function build(sim: Simulation): void {
  for (const at of SCOUTS) spawnSettlerDirect(sim, JOB_SCOUT, at.x, at.y);
}

function scoutsOf(sim: Simulation): Entity[] {
  return sim.world.canonicalQuery(Settler).filter((e) => sim.world.get(e, Settler).jobType === JOB_SCOUT);
}

/** How far the unseen cell of `island` deepest in the fog lies from seen ground, in cells. */
function deepestUnseenIn(sim: Simulation, island: Ellipse): number {
  const seen = (x: number, y: number): boolean =>
    x >= 0 &&
    y >= 0 &&
    x < MAP_W &&
    y < MAP_H &&
    sim.fog?.stateAt(HUMAN_PLAYER, x, y) !== FOG_STATE.UNEXPLORED;
  const nearSeen = (x: number, y: number, d: number): boolean => {
    for (let dy = -d; dy <= d; dy++) for (let dx = -d; dx <= d; dx++) if (seen(x + dx, y + dy)) return true;
    return false;
  };
  let deepest = 0;
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      if (!inside(island, x, y) || seen(x, y)) continue;
      let depth = 1;
      while (depth < MAP_W && !nearSeen(x, y, depth)) depth++;
      deepest = Math.max(deepest, depth);
    }
  }
  return deepest;
}

function unexploredIn(sim: Simulation, island: Ellipse): number {
  let hidden = 0;
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      if (inside(island, x, y) && sim.fog?.stateAt(HUMAN_PLAYER, x, y) === FOG_STATE.UNEXPLORED) {
        hidden++;
      }
    }
  }
  return hidden;
}

/** The scouts that reported their island explored, how deep the island's unseen scraps reach and how much
 *  of the far island stayed hidden, re-simulating
 *  the scene with the ring click a player would make. */
function sweep(): { readonly reported: number; readonly islandDepth: number; readonly farIsland: number } {
  const sim = createSceneSim(scoutExploreScene);
  for (let i = 0; i < SPAWN_TICKS; i++) sim.step();
  const scouts = scoutsOf(sim);
  sim.enqueue(
    playerCommand(HUMAN_PLAYER, {
      kind: 'unitActionGroup',
      members: scouts.map((entity) => ({ entity })),
      action: { kind: 'explore' },
    }),
  );
  const reported = new Set<Entity>();
  for (let i = 0; i < SWEEP_TICKS && reported.size < scouts.length; i++) {
    sim.step();
    for (const ev of sim.events.current()) if (ev.kind === 'explorationFinished') reported.add(ev.entity);
  }
  return {
    reported: reported.size,
    islandDepth: deepestUnseenIn(sim, ISLAND),
    farIsland: unexploredIn(sim, FAR_ISLAND),
  };
}

export const scoutExploreScene: SceneDefinition = {
  id: 'scout-explore',
  seed: 29,
  terrain: islandsTerrain(),
  fog: 'classic',
  build,
  runTicks: SPAWN_TICKS,
  initialZoom: INITIAL_ZOOM,
  checks: [
    {
      label:
        'both scouts sweep their island but its thin scraps and report it, while the far island stays unseen',
      predicate: () => {
        const result = sweep();
        return result.reported === SCOUTS.length && result.islandDepth <= SCRAP_DEPTH && result.farIsland > 0;
      },
    },
  ],
};
