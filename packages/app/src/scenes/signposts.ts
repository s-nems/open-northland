import type { Entity, Simulation } from '@open-northland/sim';
import { cellAnchorNode, components, fx, systems } from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { JOB_COLLECTOR, JOB_SCOUT } from '../catalog/jobs.js';
import { ENEMY_PLAYER, HUMAN_PLAYER } from '../game/rules.js';
import { GATHERERS, placeResourceNode, spawnSettlerDirect } from '../game/sandbox/index.js';
import type { SceneDefinition } from './types.js';

const MAP_W = 128;
const MAP_H = 16;
/** Tiles, not half-cell nodes; the sim's ranges are hex node distances, two nodes per tile E/W. */
const SCOUT = { x: 5, y: 8 } as const;
/** Ten tiles short of CHAIN_A: past its 16-node spacing, inside the 40-node link range. */
const ERECT_AT = { x: 6, y: 8 } as const;
/** CHAIN_A stands 28 hex nodes from the collector, inside its 50-node walk range; CHAIN_B 34 past A,
 *  inside the link range, on an ODD row so the pair straddles the half-cell stagger (a board drawn from
 *  an unstaggered node would be visibly off). */
const CHAIN_A = { x: 16, y: 8 } as const;
const CHAIN_B = { x: 32, y: 7 } as const;
/** 98 nodes past CHAIN_B: no link, its own group. */
const LONE_POST = { x: 80, y: 8 } as const;
const ENEMY_POST = { x: 90, y: 4 } as const;
/** NEAR sits 94 nodes from the collector, beyond its own range, but 36 from CHAIN_B; FAR is 66 from
 *  LONE_POST, outside every post's range. */
const COLLECTOR = { x: 4, y: 4 } as const;
const NEAR_TREE = { x: 50, y: 6 } as const;
const FAR_TREE = { x: 110, y: 2 } as const;
/** Walk ~48 tiles + fell the near tree, with margin. */
const RUN_TICKS = 2800;
/** Frames the collector's whole trip: the chain, the near tree and the lone post in one screen. */
const INITIAL_ZOOM = 0.55;

const { Owner, Position, Resource, Settler, Signpost, signpostNavigationEnabled } = components;

/** Stands a post on tile `(x, y)` directly, without the scout's erect command. */
function stampPost(sim: Simulation, x: number, y: number, player = HUMAN_PLAYER): void {
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('signposts scene: mapped sim');
  const anchor = cellAnchorNode(x, y);
  systems.createSignpost(sim.world, terrain, terrain.nodeAt(anchor.hx, anchor.hy), player);
}

function treeAt(sim: Simulation, x: number, y: number): Entity | null {
  for (const e of sim.world.query(Resource, Position)) {
    const p = sim.world.get(e, Position);
    if (fx.toInt(p.x) === x && fx.toInt(p.y) === y) return e;
  }
  return null;
}

function build(sim: Simulation): void {
  sim.enqueueSetup({ kind: 'setSignpostNavigation', enabled: true });
  const wood = GATHERERS.find((g) => g.id === 'wood');
  if (wood === undefined) throw new Error('signposts scene: no wood gatherer spec');
  placeResourceNode(sim, wood, NEAR_TREE.x, NEAR_TREE.y);
  placeResourceNode(sim, wood, FAR_TREE.x, FAR_TREE.y);
  stampPost(sim, CHAIN_A.x, CHAIN_A.y);
  stampPost(sim, CHAIN_B.x, CHAIN_B.y);
  stampPost(sim, LONE_POST.x, LONE_POST.y);
  stampPost(sim, ENEMY_POST.x, ENEMY_POST.y, ENEMY_PLAYER);
  spawnSettlerDirect(sim, JOB_COLLECTOR, COLLECTOR.x, COLLECTOR.y);
  const scout = spawnSettlerDirect(sim, JOB_SCOUT, SCOUT.x, SCOUT.y);
  const erectNode = cellAnchorNode(ERECT_AT.x, ERECT_AT.y);
  sim.enqueueSetup({ kind: 'placeSignpost', entity: scout, x: erectNode.hx, y: erectNode.hy });
}

export const signpostsScene: SceneDefinition = {
  id: 'signposts',
  seed: 11,
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  runTicks: RUN_TICKS,
  initialZoom: INITIAL_ZOOM,
  checks: [
    {
      label: 'signpost navigation confinement is ON (the scene opted in)',
      predicate: (sim) => signpostNavigationEnabled(sim.world),
    },
    {
      label: 'the scout ERECTED its commanded signpost (walk + one hammer swing, free and instant)',
      predicate: (sim) => {
        for (const e of sim.world.query(Signpost, Position)) {
          const p = sim.world.get(e, Position);
          if (fx.toInt(p.x) === ERECT_AT.x && fx.toInt(p.y) === ERECT_AT.y) return true;
        }
        return false;
      },
    },
    {
      label: 'five signposts stand (three of ours pre-placed + the erected one + a rival post)',
      predicate: (sim) => [...sim.world.query(Signpost)].length === 5,
    },
    {
      label: "the rival's post is owned by the enemy slot (per-player networks + red board lettering)",
      predicate: (sim) => {
        for (const e of sim.world.query(Signpost, Position)) {
          const p = sim.world.get(e, Position);
          if (fx.toInt(p.x) === ENEMY_POST.x && fx.toInt(p.y) === ENEMY_POST.y) {
            return sim.world.get(e, Owner).player === ENEMY_PLAYER;
          }
        }
        return false;
      },
    },
    {
      label: 'the collector reached the NEAR tree through the signpost chain (felled it)',
      predicate: (sim) => treeAt(sim, NEAR_TREE.x, NEAR_TREE.y) === null,
    },
    {
      label: 'the FAR tree (outside every range) was never touched',
      predicate: (sim) => {
        const tree = treeAt(sim, FAR_TREE.x, FAR_TREE.y);
        return tree !== null && sim.world.get(tree, Resource).remaining > 0;
      },
    },
    {
      label: 'the scout still wears its trade (job 27 - the hatted skin the browser shows)',
      predicate: (sim) => {
        for (const e of sim.world.query(Settler)) {
          if (sim.world.get(e, Settler).jobType === JOB_SCOUT) return true;
        }
        return false;
      },
    },
  ],
};
