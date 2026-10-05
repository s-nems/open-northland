import { cellAnchorNode, components, type Entity, fx, type Simulation, systems } from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { JOB_SCOUT, JOB_SOLDIER_SWORD } from '../catalog/jobs.js';
import { HUMAN_PLAYER } from '../game/rules.js';
import {
  BUILDING_HEADQUARTERS,
  placeBuiltSandboxBuilding,
  spawnSettlerDirect,
} from '../game/sandbox/index.js';
import { goodBySlug } from './sandbox-queries.js';
import type { SceneDefinition } from './types.js';

/**
 * Hunger breaks player orders. A scout with a Shift-queued run of signposts turns hungry a few seconds
 * in: it walks to the larder, eats, and erects the rest of the run. Below it two soldiers march east in
 * the same state: the one allowed to regenerate eats on the way, the one whose regeneration is
 * prohibited marches on hungry.
 */

const MAP_W = 72;
const MAP_H = 16;
const LARDER = { x: 14, y: 12 } as const;
const LARDER_RATIONS = 20;
const SCOUT = { x: 4, y: 3 } as const;
const POST_ROW = 3;
/** Tiles along the row; ten tiles is twenty nodes, past the sixteen-node signpost spacing. */
const POST_XS: readonly number[] = [12, 22, 32, 42];
const SOLDIER_ROWS = { allowed: 8, prohibited: 9 } as const;
const SOLDIER_X = 4;
const MARCH_X = 60;
/** Need reserve units short of the critical level, drained at one a tick: a few seconds of walking first. */
const UNITS_TO_CRITICAL = 48;
const NEED_RESERVE_UNITS = 10_000;
const RUN_TICKS = 2400;
const INITIAL_ZOOM = 0.8;

const { Position, SettlerNeeds, Signpost, Stockpile } = components;

function build(sim: Simulation): void {
  const larder = placeBuiltSandboxBuilding(sim, BUILDING_HEADQUARTERS, LARDER.x, LARDER.y, HUMAN_PLAYER);
  // By slug: the sandbox catalog carries the food goods at +100.
  sim.world.mut(larder, Stockpile).amounts.set(goodBySlug(sim, 'food_simple'), LARDER_RATIONS);

  const scout = hungry(sim, spawnSettlerDirect(sim, JOB_SCOUT, SCOUT.x, SCOUT.y, HUMAN_PLAYER));
  POST_XS.forEach((x, i) => {
    const node = cellAnchorNode(x, POST_ROW);
    sim.enqueueSetup({
      kind: 'placeSignpost',
      entity: scout,
      x: node.hx,
      y: node.hy,
      ...(i > 0 ? { queued: true } : {}),
    });
  });

  const goal = (y: number) => cellAnchorNode(MARCH_X, y);
  for (const [regenerates, y] of [
    [true, SOLDIER_ROWS.allowed],
    [false, SOLDIER_ROWS.prohibited],
  ] as const) {
    const soldier = hungry(sim, spawnSettlerDirect(sim, JOB_SOLDIER_SWORD, SOLDIER_X, y, HUMAN_PLAYER));
    if (!regenerates) sim.enqueueSetup({ kind: 'setRegeneration', entity: soldier, enabled: false });
    sim.enqueueSetup({ kind: 'moveUnit', entity: soldier, x: goal(y).hx, y: goal(y).hy });
  }
}

function hungry(sim: Simulation, e: Entity): Entity {
  const level = fx.sub(
    systems.NEED_CRITICAL_THRESHOLD,
    fx.div(fx.fromInt(UNITS_TO_CRITICAL), fx.fromInt(NEED_RESERVE_UNITS)),
  );
  systems.mutNeeds(sim.world, e, sim.tick).hunger = level;
  return e;
}

function settlerOnRow(sim: Simulation, y: number): Entity | undefined {
  for (const e of sim.world.query(components.Settler, Position)) {
    if (fx.toInt(sim.world.get(e, Position).y) === y) return e;
  }
  return undefined;
}

function hungerOf(sim: Simulation, e: Entity | undefined) {
  return e === undefined ? undefined : systems.needLevel(sim.world.get(e, SettlerNeeds), 'hunger', sim.tick);
}

function marchedOut(sim: Simulation, y: number): boolean {
  const e = settlerOnRow(sim, y);
  return e !== undefined && fx.toInt(sim.world.get(e, Position).x) === MARCH_X;
}

export const mealBreakScene: SceneDefinition = {
  id: 'meal-break',
  seed: 13,
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  runTicks: RUN_TICKS,
  initialZoom: INITIAL_ZOOM,
  needs: true,
  checks: [
    {
      label: 'the scout erected its whole queued run of signposts',
      predicate: (sim) => [...sim.world.query(Signpost)].length === POST_XS.length,
    },
    {
      label: 'the scout ate on the way (hunger back under the drive level)',
      predicate: (sim) => {
        const hunger = hungerOf(sim, settlerOnRow(sim, POST_ROW));
        return hunger !== undefined && hunger < systems.NEED_DRIVE_THRESHOLD;
      },
    },
    {
      label: 'the soldier allowed to regenerate ate and still reached its goal',
      predicate: (sim) => {
        const hunger = hungerOf(sim, settlerOnRow(sim, SOLDIER_ROWS.allowed));
        return (
          marchedOut(sim, SOLDIER_ROWS.allowed) &&
          hunger !== undefined &&
          hunger < systems.NEED_DRIVE_THRESHOLD
        );
      },
    },
    {
      label: 'the soldier with regeneration prohibited marched on hungry',
      predicate: (sim) => {
        const hunger = hungerOf(sim, settlerOnRow(sim, SOLDIER_ROWS.prohibited));
        return (
          marchedOut(sim, SOLDIER_ROWS.prohibited) &&
          hunger !== undefined &&
          hunger >= systems.NEED_CRITICAL_THRESHOLD
        );
      },
    },
  ],
};
