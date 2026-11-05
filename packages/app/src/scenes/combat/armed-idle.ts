import { cellAnchorNode, components, nodeOfPosition, type Simulation } from '@open-northland/sim';
import { grassTerrain } from '../../catalog/buildings.js';
import { CIVILIZATIONS } from '../../catalog/civilizations.js';
import {
  JOB_ARCHER,
  JOB_ARCHER_LONG,
  JOB_SOLDIER_BROADSWORD,
  JOB_SOLDIER_SPEAR,
  JOB_SOLDIER_SPEAR_WOODEN,
  JOB_SOLDIER_SWORD,
} from '../../catalog/jobs.js';
import { HUMAN_PLAYER } from '../../game/rules.js';
import type { SceneDefinition } from '../types.js';

const { Position, Settler } = components;

/** One column per weapon class; the two spears side by side show their materials. */
const WEAPON_JOBS = [
  JOB_SOLDIER_SPEAR_WOODEN,
  JOB_SOLDIER_SPEAR,
  JOB_SOLDIER_SWORD,
  JOB_SOLDIER_BROADSWORD,
  JOB_ARCHER,
  JOB_ARCHER_LONG,
];

/** Post spacing and border, in cells: close enough that all 30 fit one screen at the starting zoom. */
const SPACING_X = 3;
const SPACING_Y = 4;
const MARGIN = 5;

const POSTS = CIVILIZATIONS.flatMap((tribe, row) =>
  WEAPON_JOBS.map((job, column) => ({
    tribe,
    job,
    node: cellAnchorNode(MARGIN + column * SPACING_X, MARGIN + row * SPACING_Y),
  })),
);

function build(sim: Simulation): void {
  for (const post of POSTS) {
    sim.enqueueSetup({
      kind: 'spawnSettler',
      tribe: post.tribe,
      jobType: post.job,
      owner: HUMAN_PLAYER,
      x: post.node.hx,
      y: post.node.hy,
    });
  }
}

/** Every soldier still stands on the node it was placed on, so the view shows only its idle clips. */
function everySoldierStandsAtItsPost(sim: Simulation): boolean {
  const standing = new Set<string>();
  for (const e of sim.world.query(Settler, Position)) {
    const settler = sim.world.get(e, Settler);
    const p = sim.world.get(e, Position);
    const node = nodeOfPosition(p.x, p.y);
    standing.add(`${settler.tribe}/${settler.jobType}/${node.hx},${node.hy}`);
  }
  return POSTS.every((post) => standing.has(`${post.tribe}/${post.job}/${post.node.hx},${post.node.hy}`));
}

export const armedIdleScene: SceneDefinition = {
  id: 'armed-idle',
  seed: 47,
  terrain: grassTerrain(
    MARGIN * 2 + SPACING_X * WEAPON_JOBS.length,
    MARGIN * 2 + SPACING_Y * CIVILIZATIONS.length,
  ),
  build,
  graphicTribes: CIVILIZATIONS,
  initialZoom: 0.95,
  runTicks: 600,
  checks: [
    {
      label: "every civilization's armed soldiers stand idle at their posts",
      predicate: everySoldierStandsAtItsPost,
    },
  ],
};
