import type { SeaDanger } from '../../../../components/index.js';
import type { PlayerCommand } from '../../../../core/commands/index.js';
import type { DeepReadonly, Entity } from '../../../../ecs/world.js';
import { type HalfCellNode, nodeManhattan } from '../../../../nav/halfcell.js';
import type { TerrainGraph } from '../../../../nav/terrain/index.js';
import { anchorNodeOf } from '../../../ai-shared/node-geometry.js';
import { minutesToTicks } from '../../game-phase.js';
import type { ColonyEnv, ColonyView } from '../env.js';
import { dock } from './moorings.js';

// Where the seat's own colony ships took fire. Only what a hull felt goes in, so nothing here reads what the
// seat has not seen. Figures are authored from arabskie_wyspy_wolna_gra_mieszana, where colony ships went
// down off a rival's coast.

/** How near a danger a course may pass, in Manhattan nodes: past the 30 of a tower's clearance. */
const DANGER_NODES = 45;
/** Hits this near one another are one danger. */
const SAME_DANGER_NODES = 40;
/** The most dangers a colony remembers: past these no way is left worth trying. */
const DANGERS_MOST = 4;
/** How long a danger is kept after its latest hit (authored: about two crossings there and back). Fire moves
 *  on, and a danger kept for good would leave a colony with no line for good. */
const DANGER_KEPT_TICKS = minutesToTicks(30);
/** How often a course is tested, in nodes along it. */
const COURSE_STEP_NODES = 8;
/** How far off a danger a detour's turning point goes, nearest first. */
const DETOUR_NODES: readonly number[] = [70, 100, 130, 160];

type Node = Readonly<HalfCellNode>;
type DangerView = DeepReadonly<SeaDanger>;

function copyOf(danger: DangerView): SeaDanger {
  return { at: { hx: danger.at.hx, hy: danger.at.hy }, seen: danger.seen };
}

/** `dangers` with a hit at `at` on `tick`: a danger near it seen again, or one more. Null when full. */
export function withDanger(dangers: readonly DangerView[], at: Node, tick: number): SeaDanger[] | null {
  const near = dangers.findIndex((d) => nodeManhattan(d.at, at) <= SAME_DANGER_NODES);
  if (near < 0 && dangers.length >= DANGERS_MOST) return null;
  const kept = dangers.map((d, i) => (i === near ? { ...copyOf(d), seen: tick } : copyOf(d)));
  if (near < 0) kept.push({ at: { hx: at.hx, hy: at.hy }, seen: tick });
  return kept;
}

/** The dangers still kept on `tick` ({@link DANGER_KEPT_TICKS}), or null when none has lapsed. */
export function withoutLapsed(dangers: readonly DangerView[], tick: number): SeaDanger[] | null {
  const kept = dangers.filter((d) => tick - d.seen < DANGER_KEPT_TICKS);
  return kept.length === dangers.length ? null : kept.map(copyOf);
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
 * course meets, or null when none is clear. A danger at either end is passed: no course reaches its mooring
 * or leaves where it lies round it. Approximation: the courses are straight lines, and the ship's own route
 * over the water may bend away from them.
 */
export function clearWay(
  terrain: TerrainGraph,
  known: readonly DangerView[],
  from: Node,
  to: Node,
): ClearWay | null {
  const dangers = known
    .map((d) => d.at)
    .filter((at) => nodeManhattan(at, from) > DANGER_NODES && nodeManhattan(at, to) > DANGER_NODES);
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

/** Whether a ship can still sail between `berth` and `shore`. */
export function lineWayClear(
  terrain: TerrainGraph | undefined,
  dangers: readonly DangerView[],
  berth: Node | null,
  shore: Node | null,
): boolean {
  if (dangers.length === 0 || terrain === undefined || berth === null || shore === null) return true;
  return clearWay(terrain, dangers, berth, shore) !== null;
}

/** The orders that sail `ship` for `to`, round the fire the colony's ships have met, and straight when no
 *  way is clear: a ship already out has to come in. */
export function sailOrders(
  env: ColonyEnv,
  colony: ColonyView,
  ship: Entity,
  to: DeepReadonly<HalfCellNode>,
): PlayerCommand[] {
  const from = anchorNodeOf(env.world, ship);
  const way = from === null ? null : clearWay(env.terrain, colony.dangers, from, to);
  if (way === null || way.via === null) return [dock(ship, to)];
  const { hx: x, hy: y } = way.via;
  return [
    { kind: 'moveVehicle', vehicle: ship, x, y },
    { kind: 'dockVehicle', vehicle: ship, x: to.hx, y: to.hy, queued: true },
  ];
}
