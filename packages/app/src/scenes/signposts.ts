import type { Entity, Simulation } from '@open-northland/sim';
import { cellAnchorNode, components, fx, systems } from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { ENEMY_PLAYER, HUMAN_PLAYER, PRIMARY_TRIBE } from '../game/rules.js';
import { GATHERERS, JOB_COLLECTOR, JOB_SCOUT, placeResourceNode } from '../game/sandbox/index.js';
import type { SceneDefinition } from './types.js';

/**
 * The signposts scene: prove the scout-erected guidepost network end to end. A scout is ordered to
 * erect a signpost (walk → one build-guide hammer swing → the post rises, free and instant), signpost
 * navigation is ON, and a collector proves the confinement rule: the near tree sits beyond its local
 * circle but inside a reachable signpost chain (harvested), the far tree is outside every circle (never
 * touched). The browser half is where a human judges: the hatted scout skin, the hammer swing, the
 * wooden guidepost sprite, and the direction boards pointing between the two chained posts (none toward
 * the lone far post — a disconnected group).
 */

const MAP_W = 64;
const MAP_H = 16;
/** The scout and its commanded signpost spot (tiles). */
const SCOUT = { x: 6, y: 8 } as const;
/** One tile east of the scout — and just past CHAIN_A's 16-node spacing circle (a spot at tile 8 would
 *  sit exactly ON the circle and be rejected). */
const ERECT_AT = { x: 7, y: 8 } as const;
/** The pre-stamped chain (small circles so the scene fits disconnection on one screen) + a lone far
 *  post whose circle overlaps neither — the "two groups act separately" case. Radii are scene data. */
const CHAIN_RADIUS_NODES = 12;
const CHAIN_A = { x: 16, y: 8 } as const;
const CHAIN_B = { x: 26, y: 8 } as const;
const LONE_POST = { x: 44, y: 8 } as const;
/** A rival's post beside ours: signposts are per player (networks, spacing, selection, and the board
 *  lettering colour — red for the enemy slot vs the human's blue). */
const ENEMY_POST = { x: 52, y: 4 } as const;
/** The collector and its two trees: NEAR is beyond the 12-tile local circle but inside CHAIN_B's
 *  circle (reachable through the chain); FAR is outside every circle and must stay untouched. */
const COLLECTOR = { x: 4, y: 4 } as const;
const NEAR_TREE = { x: 30, y: 6 } as const;
const FAR_TREE = { x: 60, y: 2 } as const;
/** Walk ~26 tiles + fell the near tree, with margin. */
const RUN_TICKS = 1500;
const INITIAL_ZOOM = 1.1;

const { Owner, Position, Resource, Settler, Signpost, signpostNavigationEnabled } = components;

/** Spawn a settler of `jobType` directly (pre-tick-0) so the scene can address it in commands. */
function spawnUnit(sim: Simulation, jobType: number, x: number, y: number): Entity {
  const node = cellAnchorNode(x, y);
  const e = systems.createSettler(sim.world, sim.content, sim.rng, {
    jobType,
    x: node.hx,
    y: node.hy,
    tribe: PRIMARY_TRIBE,
    owner: HUMAN_PLAYER,
  });
  if (e === null) throw new Error('signposts scene: unknown job');
  return e;
}

/** Stamp a standing signpost directly (pre-tick-0) — the scene's pre-existing network fixture. */
function stampPost(sim: Simulation, x: number, y: number, navRadius: number, player = HUMAN_PLAYER): void {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Owner, { player });
  sim.world.add(e, Signpost, {
    navRadius,
    spacingRadius: components.SIGNPOST_SPACING_RADIUS_NODES,
  });
}

/** The Resource entity standing on tile (x,y), or null. */
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
  // The pre-existing network: two chained posts (overlapping circles) + a lone disconnected one.
  stampPost(sim, CHAIN_A.x, CHAIN_A.y, CHAIN_RADIUS_NODES);
  stampPost(sim, CHAIN_B.x, CHAIN_B.y, CHAIN_RADIUS_NODES);
  stampPost(sim, LONE_POST.x, LONE_POST.y, CHAIN_RADIUS_NODES);
  stampPost(sim, ENEMY_POST.x, ENEMY_POST.y, CHAIN_RADIUS_NODES, ENEMY_PLAYER);
  spawnUnit(sim, JOB_COLLECTOR, COLLECTOR.x, COLLECTOR.y);
  // The scout erects the fourth post on command: walk two tiles, one hammer swing, the post rises.
  const scout = spawnUnit(sim, JOB_SCOUT, SCOUT.x, SCOUT.y);
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
      label: 'the scout still wears its trade (job 27 — the hatted skin the browser shows)',
      predicate: (sim) => {
        for (const e of sim.world.query(Settler)) {
          if (sim.world.get(e, Settler).jobType === JOB_SCOUT) return true;
        }
        return false;
      },
    },
  ],
};
