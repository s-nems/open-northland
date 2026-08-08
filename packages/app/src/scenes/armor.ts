import type { Entity, Simulation } from '@open-northland/sim';
import { components, fx, systems } from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { JOB_SOLDIER_SWORD } from '../catalog/jobs.js';
import { spawnSettlerDirect } from '../game/sandbox/index.js';
import { goodBySlug } from './sandbox-queries.js';
import type { SceneDefinition } from './types.js';

const { Equipment, Health, MISC_EQUIP_SLOTS, Settler, Stance } = components;

/** West to east: bare hands first, then the four `armortypes.ini` tiers. */
const ARMOR_COLUMNS: readonly (string | null)[] = [
  null,
  'armor_wool',
  'armor_leather',
  'armor_chain',
  'armor_plate',
];
/** One row each, in the original's blue/red/yellow/cyan colour order. */
const PLAYERS: readonly number[] = [0, 1, 2, 3];
/** Parade geometry in cells. */
const GRID_X = 4;
const GRID_Y = 4;
const COL_STEP = 2;
const ROW_STEP = 2;

/** Dressed directly before tick 0 and stood down to IGNORE, so rival ownership never turns into a fight. */
function paradeSoldier(
  sim: Simulation,
  x: number,
  y: number,
  player: number,
  armorSlug: string | null,
): Entity {
  const e = spawnSettlerDirect(sim, JOB_SOLDIER_SWORD, x, y, player);
  sim.world.add(e, Equipment, {
    boots: null,
    tool: null,
    weapon: { goodType: goodBySlug(sim, 'sword_shord'), degreeOfUse: fx.fromInt(0) },
    armor: armorSlug === null ? null : { goodType: goodBySlug(sim, armorSlug), degreeOfUse: fx.fromInt(0) },
    misc: new Array(MISC_EQUIP_SLOTS).fill(null),
  });
  const stance = sim.world.mut(e, Stance);
  stance.mode = systems.MILITARY_MODE.IGNORE;
  stance.anchorCell = null;
  return e;
}

function build(sim: Simulation): void {
  for (const [row, player] of PLAYERS.entries()) {
    for (const [col, armorSlug] of ARMOR_COLUMNS.entries()) {
      paradeSoldier(sim, GRID_X + col * COL_STEP, GRID_Y + row * ROW_STEP, player, armorSlug);
    }
  }
}

/** Tallied by good type; the null key counts the bare column. */
function wornArmorCounts(sim: Simulation): Map<number | null, number> {
  const counts = new Map<number | null, number>();
  for (const e of sim.world.query(Equipment)) {
    const worn = sim.world.get(e, Equipment).armor;
    const key = worn === null ? null : worn.goodType;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

export const armorScene: SceneDefinition = {
  id: 'armor',
  seed: 11,
  terrain: grassTerrain(22, 14),
  build,
  runTicks: 4,
  // `cameraFor` only centres on the settler centroid at a non-default zoom, and the whole parade
  // must be on screen.
  initialZoom: 1.4,
  checks: [
    {
      label: 'every armor column is worn by one soldier per player row',
      predicate: (sim) => {
        const counts = wornArmorCounts(sim);
        return ARMOR_COLUMNS.every(
          (slug) => counts.get(slug === null ? null : goodBySlug(sim, slug)) === PLAYERS.length,
        );
      },
    },
    {
      label: 'rival owners hold the parade - every soldier keeps IGNORE and full health',
      predicate: (sim) =>
        [...sim.world.query(Settler)].every((e) => {
          const health = sim.world.tryGet(e, Health);
          const stance = sim.world.tryGet(e, Stance);
          return (
            health !== undefined &&
            health.hitpoints === health.max &&
            stance?.mode === systems.MILITARY_MODE.IGNORE
          );
        }),
    },
  ],
};
