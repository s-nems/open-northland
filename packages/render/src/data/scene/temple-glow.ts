import { type FootprintCell, footprintCellDx } from '@open-northland/data';
import {
  type EntitySnapshot,
  indexesOf,
  type SnapshotIndexSpec,
  type WorldSnapshot,
} from '@open-northland/sim';
import { frac } from '../effects/random.js';
import { halfCellToScreenX, halfCellToScreenY } from '../projection/index.js';

/** Whether a temple blesses the people around it this tick (its `TempleFire.blessing`); undefined for an
 *  entity the sim keeps no temple fire on, such as the headquarters. */
export function readTempleBlessing(components: Readonly<Record<string, unknown>>): boolean | undefined {
  const fire = components.TempleFire as { readonly blessing?: unknown } | undefined;
  return typeof fire?.blessing === 'boolean' ? fire.blessing : undefined;
}

const BLESSING_TEMPLES: SnapshotIndexSpec<Set<number>> = {
  name: 'blessing temples',
  reads: { values: ['TempleFire'] },
  empty: () => new Set(),
  add: (ids, entity) => {
    if (readTempleBlessing(entity.components) === true) ids.add(entity.id);
  },
  remove: (ids, entity) => {
    ids.delete(entity.id);
  },
  replace: (ids, _previous, next) => {
    if (readTempleBlessing(next.components) === true) ids.add(next.id);
    else ids.delete(next.id);
  },
};

/** The temples blessing this tick, kept per change: a player's temples are few, so a frame walks them
 *  all and culls each. A mirror edits the set in place as it advances, so read it within the frame. */
export function blessingTemplesOf(snapshot: WorldSnapshot): ReadonlySet<number> {
  return indexesOf(snapshot).get(BLESSING_TEMPLES);
}

/** The body cells (`footprint.blocked`, offsets from its anchor node) a house stands on, resolved from
 *  content by its type, tribe and record; undefined when the content knows none. */
export type HouseBodyOf = (house: EntitySnapshot) => readonly FootprintCell[] | undefined;

/** The flat ground a house stands on, in world px: its body's centre off the anchor, and half its width
 *  between the outermost cell centres. */
export interface HouseGround {
  dx: number;
  dy: number;
  halfWidth: number;
}

/** Write into `out` the ground of the body `cells` of a house anchored on node row `hy`, the odd-row
 *  shift applied as the sim stamps them; false for an empty body. */
export function houseGroundOf(cells: readonly FootprintCell[], hy: number, out: HouseGround): boolean {
  if (cells.length === 0) return false;
  const anchorX = halfCellToScreenX(0, hy);
  const anchorY = halfCellToScreenY(hy);
  let sumX = 0;
  let sumY = 0;
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  for (const cell of cells) {
    const x = halfCellToScreenX(footprintCellDx(hy, cell), hy + cell.dy) - anchorX;
    sumX += x;
    sumY += halfCellToScreenY(hy + cell.dy) - anchorY;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
  }
  out.dx = sumX / cells.length;
  out.dy = sumY / cells.length;
  out.halfWidth = (maxX - minX) / 2;
  return true;
}

const TAU = 2 * Math.PI;

/** The aura's slow breath: one swell every this many game seconds, between these shares of its full
 *  strength. Tuned by eye. */
const PULSE_SECONDS = 5;
const PULSE_LOW = 0.8;
const PULSE_HIGH = 1;

/** The share of its full strength a temple's aura shows at `seconds`, each temple breathing at its own
 *  phase from `seed`. */
export function templeGlowPulse(seconds: number, seed: number): number {
  const phase = seconds / PULSE_SECONDS + frac(seed, 0);
  const swell = 0.5 + 0.5 * Math.sin(TAU * phase);
  return PULSE_LOW + (PULSE_HIGH - PULSE_LOW) * swell;
}

/** Game seconds a crest takes from one crest's place to the next, and the radians a second the wall
 *  line's sway and the rays drift by. Tuned by eye. */
const CREST_SECONDS = 2.6;
const SWAY_DRIFT = 0.45;
const RAY_DRIFT = 0.3;

/** The aura's moving parts at `seconds`, each wrapped so a long game loses no precision on the GPU. */
export interface TempleAuraPhases {
  /** The crests' travel between two crest places, 0..1. */
  wave: number;
  /** The drift angles of the sway and the rays, radians in 0..TAU. */
  sway: number;
  rays: number;
}

export function templeAuraPhases(seconds: number, seed: number, out: TempleAuraPhases): TempleAuraPhases {
  out.wave = (seconds / CREST_SECONDS + frac(seed, 1)) % 1;
  out.sway = (seconds * SWAY_DRIFT + frac(seed, 2) * TAU) % TAU;
  out.rays = (seconds * RAY_DRIFT + frac(seed, 3) * TAU) % TAU;
  return out;
}
