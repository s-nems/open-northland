import type { Entity, Simulation } from '@open-northland/sim';
import { cellAnchorNode, components, fx } from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { JOB_COLLECTOR, JOB_SCOUT } from '../catalog/jobs.js';
import { ENEMY_PLAYER, HUMAN_PLAYER } from '../game/rules.js';
import { GATHERERS, placeResourceNode, spawnSettlerDirect } from '../game/sandbox/index.js';
import type { SceneDefinition } from './types.js';

const MAP_W = 64;
const MAP_H = 16;
/** Tiles, not half-cell nodes. */
const SCOUT = { x: 5, y: 8 } as const;
/** Just past CHAIN_A's spacing circle; tile 7 would sit exactly on it and be rejected. */
const ERECT_AT = { x: 6, y: 8 } as const;
/** CHAIN_B sits on an ODD row so the pair straddles the half-cell stagger; a board drawn from an
 *  unstaggered node would be visibly off. */
const CHAIN_RADIUS_NODES = 12;
const CHAIN_A = { x: 16, y: 8 } as const;
const CHAIN_B = { x: 26, y: 7 } as const;
const LONE_POST = { x: 44, y: 8 } as const;
const ENEMY_POST = { x: 52, y: 4 } as const;
/** NEAR sits beyond the collector's own circle but inside CHAIN_B's; FAR is outside every circle. */
const COLLECTOR = { x: 4, y: 4 } as const;
const NEAR_TREE = { x: 30, y: 6 } as const;
const FAR_TREE = { x: 60, y: 2 } as const;
/** Walk ~26 tiles + fell the near tree, with margin. */
const RUN_TICKS = 1500;
const INITIAL_ZOOM = 1.1;

const { Owner, Position, Resource, Settler, Signpost, signpostNavigationEnabled } = components;

/** Stands a post directly, without the scout's erect command. */
function stampPost(sim: Simulation, x: number, y: number, navRadius: number, player = HUMAN_PLAYER): void {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Owner, { player });
  sim.world.add(e, Signpost, {
    navRadius,
    spacingRadius: components.SIGNPOST_SPACING_RADIUS_NODES,
  });
}

function treeAt(sim: Simulation, x: number, y: number): Entity | null {
  for (const e of sim.world.query(Resource, Position)) {
    const p = sim.world.get(e, Position);
    if (fx.toInt(p.x) === x && fx.toInt(p.y) === y) return e;
  }
  return null;
}

function build(sim: Simulation): void {
  sim.enqueue({ kind: 'setSignpostNavigation', enabled: true });
  const wood = GATHERERS.find((g) => g.id === 'wood');
  if (wood === undefined) throw new Error('signposts scene: no wood gatherer spec');
  placeResourceNode(sim, wood, NEAR_TREE.x, NEAR_TREE.y);
  placeResourceNode(sim, wood, FAR_TREE.x, FAR_TREE.y);
  stampPost(sim, CHAIN_A.x, CHAIN_A.y, CHAIN_RADIUS_NODES);
  stampPost(sim, CHAIN_B.x, CHAIN_B.y, CHAIN_RADIUS_NODES);
  stampPost(sim, LONE_POST.x, LONE_POST.y, CHAIN_RADIUS_NODES);
  stampPost(sim, ENEMY_POST.x, ENEMY_POST.y, CHAIN_RADIUS_NODES, ENEMY_PLAYER);
  spawnSettlerDirect(sim, JOB_COLLECTOR, COLLECTOR.x, COLLECTOR.y);
  const scout = spawnSettlerDirect(sim, JOB_SCOUT, SCOUT.x, SCOUT.y);
  const erectNode = cellAnchorNode(ERECT_AT.x, ERECT_AT.y);
  sim.enqueue({ kind: 'placeSignpost', entity: scout, x: erectNode.hx, y: erectNode.hy });
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
      label: 'the FAR tree (outside every circle) was never touched',
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
