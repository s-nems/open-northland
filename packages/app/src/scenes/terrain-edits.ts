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

export const terrainEditsScene: SceneDefinition = {
  id: 'terrain-edits',
  seed: 61,
  terrain: grassTerrain(WIDTH, HEIGHT),
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
        const tints = sim.landscapeEdits().tints;
        return (
          tints.some((t) => t.hx === WEST.hx && t.hy === WEST.hy && t.value === BROWN_PALETTE_INDEX) &&
          tints.some((t) => t.hx === EAST.hx && t.hy === EAST.hy && t.value === GREEN_PALETTE_INDEX)
        );
      },
    },
  ],
};
