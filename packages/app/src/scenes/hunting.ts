import { cellAnchorNode, components, type Entity, type Simulation } from '@open-northland/sim';
import { ANIMAL_TRIBE_HARES, ANIMAL_TRIBE_SHEEP } from '../catalog/animal-tribes.js';
import { grassTerrain } from '../catalog/buildings.js';
import { HUNT_PREY_BALANCE, HUNTER_GENERAL_XP_TRACK } from '../catalog/hunting.js';
import { JOB_HUNTER } from '../catalog/jobs.js';
import { buildSandboxAnimals } from '../game/sandbox/content/catalog/animals.js';
import { spawnSandboxSettler } from '../game/sandbox/index.js';
import type { SceneDefinition } from './types.js';

/**
 * The hunter sign-off scene: TWO flag-bound hunters on open grass between a hare herd (small game) and
 * a sheep herd (last-resort livestock). Headless, it proves the full loop - the auto-planted work
 * flags, the paced shot (misses included), one kill carried home at a time, the carcass, and the
 * `hunter_general` XP accrual - plus the tiering: the hares are taken while the sheep herd outlives
 * the run. Two hunters make it a deadlock tripwire for the colleague rules (one hunter per animal, one
 * hunter per kill): if either claim wedged a hunter, the bag would not come in.
 *
 * In the browser a human judges the bow-in-hand draw, the missed arrows, the herd bolting off each
 * release, the carcass decals vanishing once a kill is picked clean (animals leave no bones - only
 * humans do), the meat heaping up around each hunter's flag, and - the thing only a human can call -
 * whether the two hunters read as splitting the herd rather than one shadowing the other's kill.
 */

const MAP_W = 26;
const MAP_H = 20;

/** Two hunters, a few tiles apart so each auto-plants its own flag and both herds sit in both grounds. */
const HUNTER_CELLS = [
  { x: 8, y: 8 },
  { x: 8, y: 6 },
];
/** Both herds well inside the hunter's auto-planted flag ground (`HUNTER_WORK_FLAG_RADIUS`, 64 nodes). */
const HARE_HERD_CELL = { x: 12, y: 8 };
const SHEEP_HERD_CELL = { x: 8, y: 12 };

/** Every hare's meat banked - herd size x per-hare yield, read off the catalogs so the floor the
 *  yard check waits for cannot drift from what the scene actually spawns. */
const HARE_MEAT_TOTAL =
  (buildSandboxAnimals().find((a) => a.tribeType === ANIMAL_TRIBE_HARES)?.maximumGroupSize ?? 0) *
  (HUNT_PREY_BALANCE.find((s) => s.tribeType === ANIMAL_TRIBE_HARES)?.yields.meat ?? 0);

const { Settler, Stockpile, WorkFlag } = components;

function build(sim: Simulation): void {
  for (const at of HUNTER_CELLS) spawnSandboxSettler(sim, JOB_HUNTER, at.x, at.y);
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

function hunters(sim: Simulation): Entity[] {
  return [...sim.world.query(Settler)].filter((e) => sim.world.get(e, Settler).jobType === JOB_HUNTER);
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
  // release, the 5-stroke pluck (the extracted `baserepeatcounter`), and the one-kill-at-a-time carry
  // all stretch the four-hare bag far past the raw kill time.
  runTicks: 2600,
  initialZoom: 0.8,
  checks: [
    {
      label: 'both hunters are flag-bound (spawn auto-planted their work flags)',
      predicate: (sim) => {
        const crew = hunters(sim);
        return crew.length === HUNTER_CELLS.length && crew.every((e) => sim.world.has(e, WorkFlag));
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
      label: 'harvesting the carcasses trained hunter_general (summed - the bag splits across the crew)',
      predicate: (sim) => {
        const xp = hunters(sim).reduce(
          (sum, e) => sum + (sim.world.get(e, Settler).experience.get(HUNTER_GENERAL_XP_TRACK.typeId) ?? 0),
          0,
        );
        return xp >= HARE_MEAT_TOTAL * HUNTER_GENERAL_XP_TRACK.experienceFactor;
      },
    },
    {
      label: 'both hunters shared the work - neither was wedged off the bag by its colleague',
      predicate: (sim) =>
        hunters(sim).every(
          (e) => (sim.world.get(e, Settler).experience.get(HUNTER_GENERAL_XP_TRACK.typeId) ?? 0) > 0,
        ),
    },
  ],
};
