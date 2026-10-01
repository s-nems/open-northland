import { SUCCESSFUL_IF, systems } from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { JOB_SOLDIER_SWORD } from '../catalog/jobs.js';
import { HUMAN_PLAYER, PRIMARY_TRIBE } from '../game/rules.js';
import type { SceneDefinition } from './types.js';

const WIDTH = 24;
const HEIGHT = 16;
const WEST = { hx: 14, hy: 16 };
const EAST = { hx: 34, hy: 16 };
const RADIUS = 6;
const BROWN_PALETTE_INDEX = 64;
const GREEN_PALETTE_INDEX = 100;
/** The map author's own tint over the northern cell rows, as an `emvc` lane carries it. */
const AUTHORED_PALETTE_INDEX = 58;
const AUTHORED_ROWS = 4;
/** A node of an authored cell outside both scripted discs. */
const AUTHORED = { hx: 2, hy: 2 };

function authoredTints(): number[] {
  return Array.from({ length: WIDTH * HEIGHT }, (_, cell) =>
    Math.floor(cell / WIDTH) < AUTHORED_ROWS ? AUTHORED_PALETTE_INDEX : 0,
  );
}

export const terrainEditsScene: SceneDefinition = {
  id: 'terrain-edits',
  seed: 61,
  terrain: { ...grassTerrain(WIDTH, HEIGHT), tints: authoredTints() },
  landVertices: new Array<boolean>(WIDTH * HEIGHT * 4).fill(true),
  build: (sim) =>
    sim.enqueueSetup({
      kind: 'spawnSettler',
      jobType: JOB_SOLDIER_SWORD,
      tribe: PRIMARY_TRIBE,
      owner: HUMAN_PLAYER,
      x: WIDTH,
      y: HEIGHT,
    }),
  initialZoom: 0.8,
  missions: {
    missions: [
      {
        active: true,
        visible: false,
        successfullIf: SUCCESSFUL_IF.all,
        goals: [],
        results: [
          { opcode: 'SetCameraPosition', point: { hx: WIDTH, hy: HEIGHT } },
          { opcode: 'SetVertexColor', point: WEST, range: RADIUS, amount: BROWN_PALETTE_INDEX },
          { opcode: 'SetVertexColorOnLand', point: EAST, range: RADIUS, amount: GREEN_PALETTE_INDEX },
          { opcode: 'SetHouseBuildForbiddenArea', point: WEST, range: RADIUS, flag: true },
        ],
      },
    ],
  },
  runTicks: systems.MISSION_EVALUATION_TICKS,
  checks: [
    {
      label: 'both terrain regions retain their scripted palette entries',
      predicate: (sim) => {
        const { terrain } = sim;
        const tints = sim.landscapeEdits().tints;
        return (
          terrain !== undefined &&
          tints[terrain.nodeAt(WEST.hx, WEST.hy)] === BROWN_PALETTE_INDEX &&
          tints[terrain.nodeAt(EAST.hx, EAST.hy)] === GREEN_PALETTE_INDEX
        );
      },
    },
    {
      label: "the author's tint stays where no script wrote",
      predicate: (sim) => {
        const { terrain } = sim;
        return (
          terrain !== undefined &&
          sim.landscapeEdits().tints[terrain.nodeAt(AUTHORED.hx, AUTHORED.hy)] === AUTHORED_PALETTE_INDEX
        );
      },
    },
  ],
};
