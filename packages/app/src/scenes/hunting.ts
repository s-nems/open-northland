import { cellAnchorNode, components, type Entity, type Simulation } from '@open-northland/sim';
import { ANIMAL_TRIBE_HARES, ANIMAL_TRIBE_SHEEP } from '../catalog/animal-tribes.js';
import { grassTerrain } from '../catalog/buildings.js';
import { HUNTER_GENERAL_XP_TRACK } from '../catalog/hunting.js';
import { JOB_HUNTER } from '../catalog/jobs.js';
import { spawnSandboxSettler } from '../game/sandbox/index.js';
import type { SceneDefinition } from './types.js';

/**
 * The hunter sign-off scene: one flag-bound hunter on open grass between a hare herd (small game) and
 * a sheep herd (last-resort livestock). Headless, it proves the full loop - the auto-planted work
 * flag, the paced shot (misses included), one kill carried home at a time, the carcass, and the
 * `hunter_general` XP accrual - plus the tiering: the hares are taken while the sheep herd outlives
 * the run. In the browser a human judges the bow-in-hand draw, the missed arrows, the herd bolting
 * off each release, the carcass decals and the bones left where a kill was picked clean, and the meat
 * heaping up around the hunter's flag.
 */

const MAP_W = 26;
const MAP_H = 20;

const HUNTER_CELL = { x: 8, y: 8 };
/** Both herds inside the hunter's auto-planted flag ground (default radius 24 nodes = 12 cells). */
const HARE_HERD_CELL = { x: 12, y: 8 };
const SHEEP_HERD_CELL = { x: 8, y: 12 };

/** The sandbox hare herd: 4 members × 1 meat each - the floor the yard check waits for. */
const HARE_MEAT_TOTAL = 4;

const { Settler, Stockpile, WorkFlag } = components;

function build(sim: Simulation): void {
  spawnSandboxSettler(sim, JOB_HUNTER, HUNTER_CELL.x, HUNTER_CELL.y);
  for (const herd of [
    { tribe: ANIMAL_TRIBE_HARES, cell: HARE_HERD_CELL },
    { tribe: ANIMAL_TRIBE_SHEEP, cell: SHEEP_HERD_CELL },
  ]) {
    const node = cellAnchorNode(herd.cell.x, herd.cell.y);
    sim.enqueue({ kind: 'spawnAnimalHerd', tribe: herd.tribe, x: node.hx, y: node.hy });
  }
}

function membersOf(sim: Simulation, tribe: number): Entity[] {
  const members: Entity[] = [];
  for (const e of sim.world.query(Settler)) {
    if (sim.world.get(e, Settler).tribe === tribe) members.push(e);
  }
  return members;
}

function theHunter(sim: Simulation): Entity | undefined {
  return [...sim.world.query(Settler)].find((e) => sim.world.get(e, Settler).jobType === JOB_HUNTER);
}

/** Total banked meat across every stockpile - hunting is this scene's only goods source, so the sum
 *  reads the yard heaps around the hunter's flag. */
function bankedMeat(sim: Simulation): number {
  const meatType = sim.content.goods.find((g) => g.id === 'meat')?.typeId;
  if (meatType === undefined) return 0;
  let total = 0;
  for (const e of sim.world.query(Stockpile)) {
    total += sim.world.get(e, Stockpile).amounts.get(meatType) ?? 0;
  }
  return total;
}

export const huntingScene: SceneDefinition = {
  id: 'hunting',
  seed: 43,
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  // Sized for the paced hunt: the 25-tick draw, the ~40% fresh hit rate, the herd scattering off every
  // release, and the one-kill-at-a-time carry all stretch the four-hare bag far past the raw kill time.
  runTicks: 2600,
  initialZoom: 0.8,
  checks: [
    {
      label: 'the hunter is flag-bound (spawn auto-planted its work flag)',
      predicate: (sim) => {
        const hunter = theHunter(sim);
        return hunter !== undefined && sim.world.has(hunter, WorkFlag);
      },
    },
    {
      label: 'every hare was hunted down (small game is the primary prey)',
      predicate: (sim) => membersOf(sim, ANIMAL_TRIBE_HARES).length === 0,
    },
    {
      label: 'the sheep herd outlives the run (livestock is last-resort prey)',
      predicate: (sim) => membersOf(sim, ANIMAL_TRIBE_SHEEP).length > 0,
    },
    {
      label: "the hares' meat was carried home to the flag yard",
      predicate: (sim) => bankedMeat(sim) >= HARE_MEAT_TOTAL,
    },
    {
      label: 'harvesting the carcasses trained hunter_general',
      predicate: (sim) => {
        const hunter = theHunter(sim);
        if (hunter === undefined) return false;
        const xp = sim.world.get(hunter, Settler).experience.get(HUNTER_GENERAL_XP_TRACK.typeId) ?? 0;
        return xp >= HARE_MEAT_TOTAL * HUNTER_GENERAL_XP_TRACK.experienceFactor;
      },
    },
  ],
};
