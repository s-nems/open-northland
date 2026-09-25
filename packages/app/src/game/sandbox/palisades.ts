import { fullStateBlockAreaCells, type LandscapeBlockArea, type LandscapeGfx } from '@open-northland/data';
import type { ScriptLandscapeType } from '@open-northland/sim';
import { CLOSED_GATE_LOGIC_ID, OPEN_GATE_LOGIC_ID, WALL_LOGIC_ID } from '../../content/palisade-rows.js';
import { GOOD_WOOD } from './ids/index.js';

export const PALISADE_WALL_GFX_INDEX = 691;
export const PALISADE_HORIZONTAL_GATE_CLOSED_GFX_INDEX = 697;
export const PALISADE_HORIZONTAL_GATE_OPEN_GFX_INDEX = 701;

const WALL_LOGIC_TYPE = 82;
const CLOSED_GATE_LOGIC_TYPE = 83;
const OPEN_GATE_LOGIC_TYPE = 84;
const PALISADE_MAX_HITPOINTS = 100;
const PALISADE_REPAIR_PER_STRIKE = 3;

/** Logic rows referenced by the fallback graphics below. These keep the sandbox ContentSet's
 * graphics-to-landscape join complete; collision and construction remain object-record rules. */
export function sandboxPalisadeLandscapeTypes(): Array<{
  typeId: number;
  id: string;
  walkable: boolean;
  buildable: boolean;
}> {
  return [
    { typeId: WALL_LOGIC_TYPE, id: WALL_LOGIC_ID, walkable: true, buildable: true },
    { typeId: CLOSED_GATE_LOGIC_TYPE, id: CLOSED_GATE_LOGIC_ID, walkable: true, buildable: true },
    { typeId: OPEN_GATE_LOGIC_TYPE, id: OPEN_GATE_LOGIC_ID, walkable: true, buildable: true },
  ];
}

const WALL_WALK: readonly LandscapeBlockArea[] = [[1, 0, 0, 1]];
const WALL_BUILD: readonly LandscapeBlockArea[] = [
  [1, -1, -1, 2],
  [1, -1, 0, 3],
  [1, -1, 1, 2],
];

interface SandboxPalisadeRecord {
  readonly index: number;
  readonly editName: string;
  readonly logicType: number;
  readonly walkBlockAreas: readonly LandscapeBlockArea[];
  readonly buildBlockAreas: readonly LandscapeBlockArea[];
  readonly gate?: { readonly open: boolean; readonly counterpartGfxIndex: number };
}

/**
 * The five post variants, three closed gate orientations, gatepost and three matching open gates from
 * the decoded `landscapes.cif` rows 691..702. The compact block-area tuples remain source-shaped so the
 * fallback ContentSet and the sim's script-landscape catalog cannot drift apart.
 */
const PALISADE_RECORDS: readonly SandboxPalisadeRecord[] = [
  ...['wall_01', 'wall_02', 'wall_03', 'wall_04', 'wall_05'].map((editName, offset) => ({
    index: PALISADE_WALL_GFX_INDEX + offset,
    editName,
    logicType: WALL_LOGIC_TYPE,
    walkBlockAreas: WALL_WALK,
    buildBlockAreas: WALL_BUILD,
  })),
  {
    index: 696,
    editName: 'gate_01',
    logicType: CLOSED_GATE_LOGIC_TYPE,
    walkBlockAreas: [
      [1, -1, -2, 1],
      [1, -1, -1, 1],
      [1, 0, 0, 1],
      [1, 0, 1, 1],
      [1, 1, 2, 1],
    ],
    buildBlockAreas: [
      [1, -2, -3, 2],
      [1, -2, -2, 3],
      [1, -2, -1, 3],
      [1, -1, 0, 3],
      [1, -1, 1, 3],
      [1, 0, 2, 3],
      [1, 0, 3, 2],
    ],
    gate: { open: false, counterpartGfxIndex: 700 },
  },
  {
    index: PALISADE_HORIZONTAL_GATE_CLOSED_GFX_INDEX,
    editName: 'gate_02',
    logicType: CLOSED_GATE_LOGIC_TYPE,
    walkBlockAreas: [[1, -2, 0, 5]],
    buildBlockAreas: [
      [1, -3, -1, 6],
      [1, -3, 0, 7],
      [1, -3, 1, 6],
    ],
    gate: { open: false, counterpartGfxIndex: PALISADE_HORIZONTAL_GATE_OPEN_GFX_INDEX },
  },
  {
    index: 698,
    editName: 'gate_03',
    logicType: CLOSED_GATE_LOGIC_TYPE,
    walkBlockAreas: [
      [1, 1, -2, 1],
      [1, 0, -1, 1],
      [1, 0, 0, 1],
      [1, -1, 1, 1],
      [1, -1, 2, 1],
    ],
    buildBlockAreas: [
      [1, 0, -3, 2],
      [1, 0, -2, 3],
      [1, -1, -1, 3],
      [1, -1, 0, 3],
      [1, -2, 1, 3],
      [1, -2, 2, 3],
      [1, -2, 3, 2],
    ],
    gate: { open: false, counterpartGfxIndex: 702 },
  },
  {
    index: 699,
    editName: 'wall_torpfosten',
    logicType: WALL_LOGIC_TYPE,
    walkBlockAreas: WALL_WALK,
    buildBlockAreas: WALL_BUILD,
  },
  {
    index: 700,
    editName: 'gate_01_open',
    logicType: OPEN_GATE_LOGIC_TYPE,
    walkBlockAreas: [
      [1, -1, -2, 1],
      [1, 1, 2, 1],
    ],
    buildBlockAreas: [
      [1, -2, -3, 2],
      [1, -2, -2, 3],
      [1, -2, -1, 3],
      [1, -1, 0, 3],
      [1, -1, 1, 3],
      [1, 0, 2, 3],
      [1, 0, 3, 2],
    ],
    gate: { open: true, counterpartGfxIndex: 696 },
  },
  {
    index: PALISADE_HORIZONTAL_GATE_OPEN_GFX_INDEX,
    editName: 'gate_02_open',
    logicType: OPEN_GATE_LOGIC_TYPE,
    walkBlockAreas: [
      [1, -2, 0, 1],
      [1, 2, 0, 1],
    ],
    buildBlockAreas: [
      [1, -3, -1, 6],
      [1, -3, 0, 7],
      [1, -3, 1, 6],
    ],
    gate: { open: true, counterpartGfxIndex: PALISADE_HORIZONTAL_GATE_CLOSED_GFX_INDEX },
  },
  {
    index: 702,
    editName: 'gate_03_open',
    logicType: OPEN_GATE_LOGIC_TYPE,
    walkBlockAreas: [
      [1, 1, -2, 1],
      [1, -1, 2, 1],
    ],
    buildBlockAreas: [
      [1, 0, -3, 2],
      [1, 0, -2, 3],
      [1, -1, -1, 3],
      [1, -1, 0, 3],
      [1, -2, 1, 3],
      [1, -2, 2, 3],
      [1, -2, 3, 2],
    ],
    gate: { open: true, counterpartGfxIndex: 698 },
  },
];

/** Minimal graphics rows for the committed sandbox ContentSet. Browser-owned content replaces them. */
export function sandboxPalisadeGfx(): LandscapeGfx[] {
  return PALISADE_RECORDS.map((record) => ({
    index: record.index,
    editName: record.editName,
    editGroups: ['misc_walls'],
    logicType: record.logicType,
    maxValency: PALISADE_MAX_HITPOINTS,
    isWorkable: true,
    walkBlockAreas: record.walkBlockAreas.map((area) => [...area]),
    buildBlockAreas: record.buildBlockAreas.map((area) => [...area]),
    workAreas: [],
    frames: [],
    isStatic: false,
    loopAnimation: false,
    dynamicBackground: false,
    userFxMatrix: false,
  }));
}

/**
 * Shared fallback wall rules. Readable data pins max valency 100 and repairs +3 for walls, +1 for gates; one wood per
 * new anchor is the original's behavior. Gate pairing follows the
 * adjacent closed/open decoded records. Construction blocking after completion is an explicit adaptation.
 */
export function sandboxPalisadeTypes(): ScriptLandscapeType[] {
  return PALISADE_RECORDS.map((record) => ({
    typeId: record.index,
    walk: fullStateBlockAreaCells(record.walkBlockAreas),
    build: fullStateBlockAreaCells(record.buildBlockAreas),
    groups: [],
    wall: {
      maxHitpoints: PALISADE_MAX_HITPOINTS,
      repairPerStrike: record.gate === undefined ? PALISADE_REPAIR_PER_STRIKE : 1,
      construction: [{ goodType: GOOD_WOOD, amount: 1 }],
      ...(record.gate === undefined ? {} : { gate: { ...record.gate } }),
    },
  }));
}
