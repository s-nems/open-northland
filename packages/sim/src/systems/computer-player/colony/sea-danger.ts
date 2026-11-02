import type { HalfCellNode } from '../../../nav/halfcell.js';
import { nodeManhattan } from '../../../nav/halfcell.js';
import type { TerrainGraph } from '../../../nav/terrain/index.js';

// Where the seat's own line ships took fire. Only what a hull felt goes in, so nothing here reads what the
// seat has not seen. Figures are authored from arabskie_wyspy_wolna_gra_mieszana (seed 13), where three ships
// went down between (254,142) and (283,157) off a rival's coast.

/** How near a danger a course may pass, in Manhattan nodes: past the 30 of a tower's clearance. */
const DANGER_NODES = 45;
/** Hits this near one another are one danger. */
const SAME_DANGER_NODES = 40;
/** The most dangers a colony remembers: past these no way is left worth trying. */
const DANGERS_MOST = 4;
/** How often a course is tested, in nodes along it. */
const COURSE_STEP_NODES = 8;
/** How far off a danger a detour's turning point goes, nearest first. */
const DETOUR_NODES: readonly number[] = [70, 100, 130, 160];

type Node = Readonly<HalfCellNode>;

/** `dangers` with one more hit at `at`, or null when it adds nothing. */
export function withDanger(dangers: readonly Node[], at: Node): HalfCellNode[] | null {
  if (dangers.length >= DANGERS_MOST) return null;
  if (dangers.some((d) => nodeManhattan(d, at) <= SAME_DANGER_NODES)) return null;
  return [...dangers.map((d) => ({ hx: d.hx, hy: d.hy })), { hx: at.hx, hy: at.hy }];
}

/** The danger a straight course from `from` to `to` passes, or null. */
function dangerOn(dangers: readonly Node[], from: Node, to: Node): Node | null {
  const steps = Math.ceil(nodeManhattan(from, to) / COURSE_STEP_NODES);
  for (let i = 0; i <= steps; i++) {
    const at = {
      hx: from.hx + Math.floor(((to.hx - from.hx) * i) / Math.max(1, steps)),
      hy: from.hy + Math.floor(((to.hy - from.hy) * i) / Math.max(1, steps)),
    };
    const near = dangers.find((d) => nodeManhattan(d, at) <= DANGER_NODES);
    if (near !== undefined) return near;
  }
  return null;
}

/** A course clear of every danger: `via` a turning point of open water when the straight one is not. */
export interface ClearWay {
  readonly via: HalfCellNode | null;
}

/**
 * The way from `from` to `to` clear of `dangers`, the shortest detour of one turn off the danger the straight
 * course meets, or null when none is clear. Approximation: the courses are straight lines, and the ship's own
 * route over the water may bend away from them.
 */
export function clearWay(
  terrain: TerrainGraph,
  dangers: readonly Node[],
  from: Node,
  to: Node,
): ClearWay | null {
  const danger = dangerOn(dangers, from, to);
  if (danger === null) return { via: null };
  const span = Math.max(1, nodeManhattan(from, to));
  let best: { readonly via: HalfCellNode; readonly length: number } | null = null;
  for (const off of DETOUR_NODES) {
    for (const side of [1, -1]) {
      const via = {
        hx: danger.hx - Math.floor((side * off * (to.hy - from.hy)) / span),
        hy: danger.hy + Math.floor((side * off * (to.hx - from.hx)) / span),
      };
      if (!terrain.inBounds(via.hx, via.hy) || !terrain.isWater(terrain.nodeAt(via.hx, via.hy))) continue;
      if (dangerOn(dangers, from, via) !== null || dangerOn(dangers, via, to) !== null) continue;
      const length = nodeManhattan(from, via) + nodeManhattan(via, to);
      if (best === null || length < best.length) best = { via, length };
    }
  }
  return best === null ? null : { via: best.via };
}

/** Whether a line can still run between `berth` and `shore`. */
export function lineWayClear(
  terrain: TerrainGraph | undefined,
  dangers: readonly Node[],
  berth: Node | null,
  shore: Node | null,
): boolean {
  if (dangers.length === 0 || terrain === undefined || berth === null || shore === null) return true;
  return clearWay(terrain, dangers, berth, shore) !== null;
}
