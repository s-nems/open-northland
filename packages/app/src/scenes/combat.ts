import type { Simulation } from '@vinland/sim';
import { components, fx } from '@vinland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { ENEMY_PLAYER, HUMAN_PLAYER } from '../game/rules.js';
import {
  JOB_ARCHER,
  JOB_SOLDIER_SWORD,
  WEAPON_LONG_BOW,
  WEAPON_SHORT_BOW,
  WEAPON_SWORD,
  spawnSandboxSettler,
} from '../game/sandbox/index.js';
import { blueLivingSoldiers, enemyLivingSettlers } from './sandbox-queries.js';
import type { SceneDefinition } from './types.js';

/**
 * A small, READABLE combat-animation scene — the human sign-off surface for step 5 (warrior bodies +
 * combat animations). Unlike the busy 0.5-zoom sandbox, this frames two short facing lines close enough
 * to judge a single swing: blue swordsmen advance in the readied ("aggressive") gait and strike with a
 * sword swing FACING their target; two archers (long + short bow) draw and release an arrow at the hit
 * frame. It reuses ONLY the shared `game/sandbox/` content (sword + bow jobs/weapons) — spear/broadsword/
 * unarmed/woman swings are validated per-body in `?anim` until the battle scene (plan step 7) and the
 * barracks (step 8) give those classes a home. Owner-hostility auto-engages the two players, so no
 * explicit stance/attack command is scripted — the clash is emergent, like the sandbox.
 *
 * The headless half asserts only the deterministic OUTCOME (blue wins, red falls); the pixels — the swing
 * reading as a swing, the arrow release, the facing — are the human's to judge from the checklist.
 */

const MAP_W = 20;
const MAP_H = 14;

// Two lines ~6 tiles apart: inside the sight radius, so both sides SEE each other on tick 0 and close —
// the human watches the aggressive approach, then the swing. Blue outnumbers + outguns (archers + more
// HP) so the winner is deterministic and red is wiped, satisfying the mechanic check.
//
// Positions sit near the tile origin ON PURPOSE: the scene camera frames on the settler centroid of the
// INITIAL snapshot, but the spawn commands run on the first tick — so at frame-0 the scene is empty and
// the camera falls back to the tile origin. Keeping the clash near (0,0) lands it in that default frame;
// {@link SceneDefinition.initialZoom} < 1 tightens it to a readable close-up (any value ≠ 1 also lets the
// camera re-centre on the centroid once the human nudges it).
const BLUE_SWORD_X = 4;
const RED_SWORD_X = 10;
const LINE_YS = [4, 6, 8] as const;
const BLUE_ARCHER_X = 2;
const ARCHER_YS = [3, 9] as const;
const BLUE_HP = 400;
const RED_HP = 150;

function build(sim: Simulation): void {
  for (const y of LINE_YS) {
    spawnSandboxSettler(sim, JOB_SOLDIER_SWORD, BLUE_SWORD_X, y, HUMAN_PLAYER, {
      hitpoints: BLUE_HP,
      weaponTypeId: WEAPON_SWORD,
    });
    spawnSandboxSettler(sim, JOB_SOLDIER_SWORD, RED_SWORD_X, y, ENEMY_PLAYER, {
      hitpoints: RED_HP,
      weaponTypeId: WEAPON_SWORD,
    });
  }
  // A long-bow and a short-bow archer behind the blue line — two distinct bow draws + release cadences.
  spawnSandboxSettler(sim, JOB_ARCHER, BLUE_ARCHER_X, ARCHER_YS[0], HUMAN_PLAYER, {
    hitpoints: BLUE_HP,
    weaponTypeId: WEAPON_LONG_BOW,
  });
  spawnSandboxSettler(sim, JOB_ARCHER, BLUE_ARCHER_X, ARCHER_YS[1], HUMAN_PLAYER, {
    hitpoints: BLUE_HP,
    weaponTypeId: WEAPON_SHORT_BOW,
  });
}

const { Owner, Position, Settler } = components;

/** A blue swordsman advanced past its start column (the aggressive approach happened, not a stand-off). */
function blueAdvanced(sim: Simulation): boolean {
  for (const e of sim.world.query(Settler, Owner, Position)) {
    if (sim.world.get(e, Owner).player !== HUMAN_PLAYER) continue;
    if (sim.world.get(e, Settler).jobType !== JOB_SOLDIER_SWORD) continue;
    if (fx.toInt(sim.world.get(e, Position).x) > BLUE_SWORD_X) return true;
  }
  return false;
}

export const combatScene: SceneDefinition = {
  id: 'combat',
  title: 'Walka — animacje ataku',
  summary:
    'Mala czytelna scena do oceny animacji walki: niebiescy miecznicy podchodza bojowym chodem i zadaja ' +
    'cios zwrocony w strone wroga, a lucznicy (dlugi i krotki luk) napinaja luk i wypuszczaja strzale. ' +
    'Wrogosc wynika z gracza (kolor druzyny), wiec starcie jest emergentne — bez skryptowanego rozkazu.',
  seed: 7,
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  runTicks: 2000,
  initialZoom: 0.9,
  checklist: [
    'Miecznicy podchodza „bojowym" chodem (bron gotowa, _agressive), nie zwyklym spacerem',
    'Cios miecza czyta sie jako zamach i jest zwrocony TWARZA w strone celu (nie zawsze na SE)',
    'Lucznicy napinaja luk i wypuszczaja strzale w klatce trafienia — strzala leci i trafia (dlugi vs krotki luk)',
    'Zaatakowana jednostka NIE ma osobnej animacji drgniecia — po prostu traci HP (znana luka danych: brak _attacked bobseq u wikingow)',
    'Druzyny sa rozroznialne kolorem; czerwony oddzial ginie, niebieski przewaza',
  ],
  checks: [
    {
      label: 'the red squad is defeated (combat resolves deterministically)',
      predicate: (sim) => enemyLivingSettlers(sim) === 0,
    },
    {
      label: 'blue swordsmen survive the clash',
      predicate: (sim) => blueLivingSoldiers(sim) > 0,
    },
    {
      label: 'the blue swordsmen advanced from their start column into melee',
      predicate: blueAdvanced,
    },
  ],
};
