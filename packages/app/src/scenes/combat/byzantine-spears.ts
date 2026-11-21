import { cellAnchorNode, components, type Entity, type Simulation, systems } from '@open-northland/sim';
import { grassTerrain } from '../../catalog/buildings.js';
import { BYZANTINE } from '../../catalog/civilizations.js';
import { MONSTER_TRIBE_DRAGON } from '../../catalog/creatures.js';
import { JOB_SOLDIER_SPEAR, JOB_SOLDIER_SPEAR_WOODEN, JOB_SOLDIER_UNARMED } from '../../catalog/jobs.js';
import type { SceneDefinition } from '../types.js';

const HUMAN_SEAT = 0;
const MACHINE_SEAT = 1;

/** Two columns of trained Byzantine spears, a human seat's and a machine seat's, wood above iron in each,
 *  and a dragon on the machine seat beside them. */
const COLUMNS = [HUMAN_SEAT, MACHINE_SEAT] as const;
const DRAGON_COLUMN = COLUMNS.length;
/** Cell layout: columns this far apart from the first, rows likewise, the dragon between the rows, so the
 *  whole line fits the opening view. */
const FIRST_COLUMN_CELL = 3;
const COLUMN_STEP_CELLS = 4;
const FIRST_ROW_CELL = 5;
const ROW_STEP_CELLS = 5;
const LAIR_ROW_CELL = 7;

function build(sim: Simulation): void {
  sim.enqueueSetup({ kind: 'setDiplomacy', from: HUMAN_SEAT, to: MACHINE_SEAT, state: 'friend' });
  sim.enqueueSetup({ kind: 'setDiplomacy', from: MACHINE_SEAT, to: HUMAN_SEAT, state: 'friend' });
  sim.enqueueSetup({ kind: 'setAiControl', player: MACHINE_SEAT, enabled: true, mapAiEnabled: false });
  for (const [column, owner] of COLUMNS.entries()) {
    for (const [row, jobType] of [JOB_SOLDIER_SPEAR_WOODEN, JOB_SOLDIER_SPEAR].entries()) {
      const node = cellAnchorNode(
        FIRST_COLUMN_CELL + column * COLUMN_STEP_CELLS,
        FIRST_ROW_CELL + row * ROW_STEP_CELLS,
      );
      sim.enqueueSetup({ kind: 'spawnSettler', tribe: BYZANTINE, jobType, owner, x: node.hx, y: node.hy });
    }
  }
  const lair = cellAnchorNode(FIRST_COLUMN_CELL + DRAGON_COLUMN * COLUMN_STEP_CELLS, LAIR_ROW_CELL);
  sim.enqueueSetup({
    kind: 'spawnSettler',
    tribe: MONSTER_TRIBE_DRAGON,
    jobType: JOB_SOLDIER_UNARMED,
    owner: MACHINE_SEAT,
    x: lair.hx,
    y: lair.hy,
  });
}

const isDragon = (sim: Simulation, e: Entity): boolean =>
  sim.world.get(e, components.Settler).tribe === MONSTER_TRIBE_DRAGON;

export const byzantineSpearsScene: SceneDefinition = {
  id: 'byzantine-spears',
  seed: 37,
  terrain: grassTerrain(19, 16),
  graphicTribes: [1, BYZANTINE, MONSTER_TRIBE_DRAGON],
  initialZoom: 1.5,
  runTicks: 60,
  build,
  checks: [
    {
      label: 'every Byzantine spearman is a soldier of the common pool, whichever seat holds him',
      predicate: (sim) => {
        const units = [...sim.world.query(components.Settler, components.Owner, components.Health)];
        const spearmen = units.filter((e) => !isDragon(sim, e));
        return (
          spearmen.length === COLUMNS.length * 2 &&
          spearmen.every((e) => sim.world.get(e, components.Health).max === systems.HUMAN_HITPOINTS)
        );
      },
    },
    {
      label: "a dragon stands beside them with its own tribe's hitpoints",
      predicate: (sim) => {
        const dragons = [...sim.world.query(components.Settler, components.Health)].filter((e) =>
          isDragon(sim, e),
        );
        const pool = sim.content.tribes.find((t) => t.typeId === MONSTER_TRIBE_DRAGON)?.monster?.hitpoints;
        return (
          dragons.length === 1 &&
          pool !== undefined &&
          dragons.every((e) => sim.world.get(e, components.Health).max === pool)
        );
      },
    },
  ],
};
