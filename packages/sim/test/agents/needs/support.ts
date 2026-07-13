import { Position, Resource, Settler } from '../../../src/components/index.js';
import { ZERO } from '../../../src/core/fixed.js';
import type { Entity } from '../../../src/ecs/world.js';
import {
  cellAnchorNode,
  type Fixed,
  fx,
  halfCellMapFromCells,
  type Simulation,
  type TerrainMap,
} from '../../../src/index.js';
import type { SystemContext } from '../../../src/systems/index.js';

const GRASS = 0;
const WOOD = 1;
const WOODCUTTER = 1;
const VIKING = 1;

export interface NeedLevels {
  readonly hunger?: Fixed;
  readonly fatigue?: Fixed;
  readonly piety?: Fixed;
  readonly enjoyment?: Fixed;
}

/** A cell-resolution grass strip converted through the sim's half-cell map seam. */
export function grassMap(width: number, height: number): TerrainMap {
  return halfCellMapFromCells({ width, height, typeIds: new Array(width * height).fill(GRASS) });
}

/** The terrain node at a visual cell anchor, when the simulation has a map. */
export function cellOf(sim: Simulation, x: number, y: number): number | undefined {
  const node = cellAnchorNode(x, y);
  return sim.terrain?.nodeAt(node.hx, node.hy);
}

/** A woodcutter with only the requested needs raised above their zero defaults. */
export function needsSettlerAt(sim: Simulation, x: number, y: number, needs: NeedLevels): Entity {
  const entity = sim.world.create();
  sim.world.add(entity, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(entity, Settler, {
    tribe: VIKING,
    jobType: WOODCUTTER,
    hunger: needs.hunger ?? ZERO,
    fatigue: needs.fatigue ?? ZERO,
    piety: needs.piety ?? ZERO,
    enjoyment: needs.enjoyment ?? ZERO,
    experience: new Map(),
  });
  return entity;
}

/** A harvestable fixture tree used to prove that a need drive outranks ordinary work. */
export function treeAt(sim: Simulation, x: number, y: number): Entity {
  const entity = sim.world.create();
  sim.world.add(entity, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(entity, Resource, { goodType: WOOD, remaining: 5, harvestAtomic: 24 });
  return entity;
}

/** The complete system context for direct system calls in need-drive tests. */
export function ctxOf(sim: Simulation): SystemContext {
  return {
    content: sim.content,
    rng: sim.rng,
    tick: sim.tick,
    events: sim.events,
    commands: sim.commands,
    ...(sim.terrain !== undefined ? { terrain: sim.terrain } : {}),
  };
}
