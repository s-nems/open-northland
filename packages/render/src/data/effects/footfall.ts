import { cellOfNode } from '@open-northland/sim';
import type { SceneGround } from '../scene/index.js';

/**
 * What an adult human leaves where it steps onto a node, by the ground of that node's cell.
 *
 * Original behavior: on every node a human reaches, an adult of any tribe but the weresnakes raises a
 * particle chosen by the `trianglepatterntypes` logic types of the cell's two triangles: triangle A snow
 * (7) leaves `SnowSteps`, both triangles beach (8) leave `beachSteps`, and triangle A sand (4) kicks up
 * `Smoke.org` dust. Every other ground leaves nothing.
 */
export type FootfallKind = 'snowSteps' | 'beachSteps' | 'dust';

const NO_FOOTFALL = 0;
const SNOW_STEPS = 1;
const BEACH_STEPS = 2;
const DUST = 3;
const KIND_BY_CODE: readonly (FootfallKind | undefined)[] = [undefined, 'snowSteps', 'beachSteps', 'dust'];

/** The `trianglepatterntypes` logic types the original keys footfall on. */
const SAND_LOGIC_TYPE = 4;
const SNOW_LOGIC_TYPE = 7;
const BEACH_LOGIC_TYPE = 8;

/** A map's footfall per cell, row-major. */
export interface FootfallGround {
  readonly width: number;
  readonly height: number;
  readonly cells: Uint8Array;
}

function footfallCode(a: number | undefined, b: number | undefined): number {
  if (a === SNOW_LOGIC_TYPE) return SNOW_STEPS;
  if (a === BEACH_LOGIC_TYPE && b === BEACH_LOGIC_TYPE) return BEACH_STEPS;
  if (a === SAND_LOGIC_TYPE) return DUST;
  return NO_FOOTFALL;
}

/**
 * The footfall of every cell of `ground`, `logicTypes` giving each pattern of its dictionary its logic
 * type; `null` when no cell leaves anything.
 */
export function footfallGround(
  ground: SceneGround,
  logicTypes: readonly (number | undefined)[],
  width: number,
  height: number,
): FootfallGround | null {
  const cells = new Uint8Array(width * height);
  let any = false;
  for (let i = 0; i < cells.length; i++) {
    const a = ground.a[i];
    const b = ground.b[i];
    const code = footfallCode(
      a === undefined ? undefined : logicTypes[a],
      b === undefined ? undefined : logicTypes[b],
    );
    cells[i] = code;
    if (code !== NO_FOOTFALL) any = true;
  }
  return any ? { width, height, cells } : null;
}

/** What a step onto node `(hx, hy)` leaves, through the original's node-to-cell rule. */
export function footfallAt(ground: FootfallGround, hx: number, hy: number): FootfallKind | undefined {
  const { cx, cy } = cellOfNode(hx, hy);
  if (cx < 0 || cy < 0 || cx >= ground.width || cy >= ground.height) return undefined;
  return KIND_BY_CODE[ground.cells[cy * ground.width + cx] ?? NO_FOOTFALL];
}

const FULL_TURN_DEGREES = 360;
const QUARTER_TURN_DEGREES = 90;
const THREE_QUARTER_TURN_DEGREES = 270;

/**
 * The heading from one lattice node to another in whole degrees, 0 north and turning clockwise,
 * measured on the node lattice with each odd row's stagger counted. Original behavior: this is the
 * angle a directional effect takes its valency from.
 */
export function stepHeadingDegrees(fromHx: number, fromHy: number, toHx: number, toHy: number): number {
  const dx = 2 * toHx + (toHy & 1) - (2 * fromHx + (fromHy & 1));
  const dy = 2 * toHy - 2 * fromHy;
  if (dy === 0) return dx < 0 ? THREE_QUARTER_TURN_DEGREES : QUARTER_TURN_DEGREES;
  const degrees = Math.trunc((Math.atan2(dy, dx) * 180) / Math.PI) + QUARTER_TURN_DEGREES;
  return ((degrees % FULL_TURN_DEGREES) + FULL_TURN_DEGREES) % FULL_TURN_DEGREES;
}

/** The valency of `count` spread over a full turn that a print stepped along `degrees` shows. */
export function stepValency(degrees: number, count: number): number {
  return Math.floor((degrees * count) / FULL_TURN_DEGREES);
}

/**
 * Source basis `particeleffects.cif` logic types 2 and 3: a print lives `lifetime` 160 ticks and is born
 * at `startLifeTime` 120 of them, and the original draws it with the share of its life left as opacity,
 * so it appears at three quarters and fades out over 120 ticks.
 */
const PRINT_LIFETIME_TICKS = 160;
export const PRINT_SHOWN_TICKS = 120;

/** A print's opacity `age` ticks after the step; 0 once it is gone. */
export function printAlpha(age: number): number {
  if (age < 0 || age >= PRINT_SHOWN_TICKS) return 0;
  return (PRINT_SHOWN_TICKS - age) / PRINT_LIFETIME_TICKS;
}

/**
 * How far apart, in lattice steps, two sightings of a walker may lie and still be one walk. A walker
 * crosses a node in several ticks, so a drawn frame sees at most a step or two between snapshots; a
 * longer jump is a door, a boarding or a teleport, which leaves no print.
 */
export const MAX_STEP_NODES = 2;
