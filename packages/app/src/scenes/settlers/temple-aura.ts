import { components, ONE, type Simulation } from '@open-northland/sim';
import { grassTerrain } from '../../catalog/buildings.js';
import { CIVILIZATIONS } from '../../catalog/civilizations.js';
import { JOB_CIVILIST } from '../../catalog/jobs.js';
import { HUMAN_PLAYER } from '../../game/rules.js';
import { placeBuiltSandboxBuilding, spawnSettlerDirect } from '../../game/sandbox/index.js';
import type { SceneDefinition } from '../types.js';

const { Owner, Position, SettlerNeeds } = components;

/** One temple per civilization along a row, so their auras compare side by side. */
const TEMPLE_ROW_Y = 30;
const TEMPLE_FIRST_X = 12;
const TEMPLE_STEP_X = 12;
/** Friend both ways with you: an alliance, which your temples bless too. */
const ALLY_PLAYER = 1;
/** Neutral both ways: no alliance, so your temples pass its people by. */
const NEUTRAL_PLAYER = 2;
/** Your civilian by the third temple, well inside its blessing, and one far below every temple. */
const NEAR_AT = { x: 34, y: 34 } as const;
const FAR_AT = { x: 36, y: 64 } as const;
/** Either side of {@link NEAR_AT}, as deep inside the blessing. */
const ALLY_AT = { x: 38, y: 34 } as const;
const NEUTRAL_AT = { x: 32, y: 34 } as const;

function worshipper(sim: Simulation, x: number, y: number, owner: number = HUMAN_PLAYER): void {
  const settler = spawnSettlerDirect(sim, JOB_CIVILIST, x, y, owner);
  sim.world.mut(settler, SettlerNeeds).piety = ONE;
}

/** Whether some civilian of `owner` has had religion added since the scene filled every bar. */
function blessedAny(sim: Simulation, owner: number): boolean {
  return [...sim.world.query(SettlerNeeds, Owner)].some(
    (e) => sim.world.get(e, Owner).player === owner && sim.world.get(e, SettlerNeeds).piety < ONE,
  );
}

function build(sim: Simulation): void {
  CIVILIZATIONS.forEach((tribe, i) => {
    const x = TEMPLE_FIRST_X + i * TEMPLE_STEP_X;
    placeBuiltSandboxBuilding(sim, 'work_temple', x, TEMPLE_ROW_Y, HUMAN_PLAYER, { tribe });
  });
  worshipper(sim, NEAR_AT.x, NEAR_AT.y);
  worshipper(sim, FAR_AT.x, FAR_AT.y);
  worshipper(sim, ALLY_AT.x, ALLY_AT.y, ALLY_PLAYER);
  worshipper(sim, NEUTRAL_AT.x, NEUTRAL_AT.y, NEUTRAL_PLAYER);
  for (const [player, state] of [
    [ALLY_PLAYER, 'friend'],
    [NEUTRAL_PLAYER, 'neutral'],
  ] as const) {
    sim.enqueueSetup({ kind: 'setDiplomacy', from: HUMAN_PLAYER, to: player, state });
    sim.enqueueSetup({ kind: 'setDiplomacy', from: player, to: HUMAN_PLAYER, state });
  }
}

/** Select a temple to inspect the pale-blue blessing range. No civilian has a prayer drive; your ally's
 *  one beside yours is blessed too, the neutral one is not. */
export const templeAuraScene: SceneDefinition = {
  id: 'temple-aura',
  seed: 41,
  terrain: grassTerrain(80, 80),
  graphicTribes: CIVILIZATIONS,
  build,
  runTicks: 120,
  initialZoom: 0.4,
  needs: true,
  progression: false,
  checks: [
    {
      label: 'the nearby civilian gains religion without leaving for prayer',
      predicate: (sim) => blessedAny(sim, HUMAN_PLAYER),
    },
    {
      label: 'the distant civilian stays outside the blessing',
      predicate: (sim) =>
        [...sim.world.query(SettlerNeeds, Position)].some(
          (e) => sim.world.get(e, Position).y > ONE * 50 && sim.world.get(e, SettlerNeeds).piety === ONE,
        ),
    },
    {
      label: "your ally's civilian is blessed by your temple, the neutral one beside it is not",
      predicate: (sim) => blessedAny(sim, ALLY_PLAYER) && !blessedAny(sim, NEUTRAL_PLAYER),
    },
  ],
};
