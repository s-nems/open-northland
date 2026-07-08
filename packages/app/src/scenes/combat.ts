import type { Simulation } from '@vinland/sim';
import { components, fx } from '@vinland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { ENEMY_PLAYER, HUMAN_PLAYER } from '../game/rules.js';
import {
  JOB_ARCHER,
  JOB_ARCHER_LONG,
  JOB_SOLDIER_BROADSWORD,
  JOB_SOLDIER_SPEAR,
  JOB_SOLDIER_SWORD,
  WEAPON_BROADSWORD,
  WEAPON_LONG_BOW,
  WEAPON_SHORT_BOW,
  WEAPON_SPEAR,
  WEAPON_SWORD,
  spawnSandboxSettler,
} from '../game/sandbox/index.js';
import { blueOwnedSettlers, enemyLivingSettlers } from './sandbox-queries.js';
import type { SceneDefinition } from './types.js';

/**
 * The combat-animation sign-off scene — EVERY weapon class, fighting on DIFFERENT axes, so a human can
 * judge each decoded swing (spear / short sword / long sword / short bow / long bow) in many facings:
 * the sword duel closes east–west, the broadswords north–south, the spears on a diagonal, and the two
 * bow duels exchange visible arrows on a diagonal and a vertical. Duel groups are spaced so no group
 * sees another (melee sight 8; bow search = the weapon's maxRange 15/23), keeping each duel readable.
 *
 * Owner-hostility auto-engages the two players — no scripted orders; hitpoints are chosen so a kill
 * takes ~6–12 full swings depending on the weapon (the sandbox damage scale), so the fight lasts long
 * enough to watch whole animations. Both are named sandbox approximations — the original's human HP is
 * unreadable (calibration-pending, plan step 10). The headless half asserts only the deterministic
 * outcome; the pixels are the human's (see the checklist).
 */

const MAP_W = 44;
const MAP_H = 34;

/** Blue outlasts red (~10 vs ~7 swings to fall at sword damage): the winner is deterministic, red is
 *  wiped, and every duel still shows several full swings from BOTH sides before it resolves. */
const BLUE_HP = 400;
const RED_HP = 280;

/** One duellist to place: job + worn weapon + tile, per team. */
interface DuelPost {
  readonly job: number;
  readonly weapon: number;
  readonly blue: readonly { x: number; y: number }[];
  readonly red: readonly { x: number; y: number }[];
}

// Each group's blue/red posts sit within melee sight (8 tiles Manhattan) of their OWN opposite line,
// and every cross-group hostile pair is spaced STRICTLY beyond the farther side's acquire radius at
// spawn (melee sight 8; a bow's search = max(maxRange, 8) → 15 short / 23 long; the sim's ring search
// is INCLUSIVE, so 8 apart still sees). Nearest-first targeting is the second guarantee: even as lines
// close, each unit's own duel partner stays the nearest hostile until its duel resolves — after that,
// survivors MAY roam to the next group (fine: more facings to judge). Axes vary on purpose — the point
// of the scene is seeing the swing in many facings.
const DUELS: readonly DuelPost[] = [
  // Short swords, 2v2, closing WEST→EAST (facings E/W in the clash).
  {
    job: JOB_SOLDIER_SWORD,
    weapon: WEAPON_SWORD,
    blue: [
      { x: 3, y: 4 },
      { x: 3, y: 6 },
    ],
    red: [
      { x: 9, y: 4 },
      { x: 9, y: 6 },
    ],
  },
  // Broadswords (long sword), 2v2, closing NORTH→SOUTH (facings S/N). x ≥ 16 keeps the blue line 9
  // Manhattan from the red sword line (strictly beyond the inclusive sight 8).
  {
    job: JOB_SOLDIER_BROADSWORD,
    weapon: WEAPON_BROADSWORD,
    blue: [
      { x: 16, y: 2 },
      { x: 18, y: 2 },
    ],
    red: [
      { x: 16, y: 8 },
      { x: 18, y: 8 },
    ],
  },
  // Spears, 2v2, closing on a NW→SE diagonal (the in-between facings).
  {
    job: JOB_SOLDIER_SPEAR,
    weapon: WEAPON_SPEAR,
    blue: [
      { x: 4, y: 13 },
      { x: 6, y: 15 },
    ],
    red: [
      { x: 8, y: 17 },
      { x: 10, y: 19 },
    ],
  },
  // Short bows, 1v1 at standing fire range (band 3–15), arrows flying on a shallow diagonal. x ≥ 32
  // keeps the blue archer 16 Manhattan from the red broadsword line (strictly beyond its 15 search).
  {
    job: JOB_ARCHER,
    weapon: WEAPON_SHORT_BOW,
    blue: [{ x: 32, y: 6 }],
    red: [{ x: 40, y: 10 }],
  },
  // Long bows, 1v1 (band 4–23), arrows on a steeper diagonal in the far corner — 24+ Manhattan from
  // the short-bow duel so neither long bow can acquire across groups (23 is inclusive).
  {
    job: JOB_ARCHER_LONG,
    weapon: WEAPON_LONG_BOW,
    blue: [{ x: 34, y: 29 }],
    red: [{ x: 42, y: 32 }],
  },
];

function build(sim: Simulation): void {
  for (const duel of DUELS) {
    for (const p of duel.blue) {
      spawnSandboxSettler(sim, duel.job, p.x, p.y, HUMAN_PLAYER, {
        hitpoints: BLUE_HP,
        weaponTypeId: duel.weapon,
      });
    }
    for (const p of duel.red) {
      spawnSandboxSettler(sim, duel.job, p.x, p.y, ENEMY_PLAYER, {
        hitpoints: RED_HP,
        weaponTypeId: duel.weapon,
      });
    }
  }
}

const { Owner, Position, Settler } = components;

/** A blue swordsman advanced past its start column (the aggressive approach happened, not a stand-off). */
function blueAdvanced(sim: Simulation): boolean {
  // Keyed by JOB, not array position, so reordering DUELS can't silently retarget the assertion; a
  // missing sword duel fails the check loudly instead of passing vacuously.
  const swordDuel = DUELS.find((d) => d.job === JOB_SOLDIER_SWORD);
  const swordStartX = swordDuel?.blue[0]?.x;
  if (swordStartX === undefined) return false;
  for (const e of sim.world.query(Settler, Owner, Position)) {
    if (sim.world.get(e, Owner).player !== HUMAN_PLAYER) continue;
    if (sim.world.get(e, Settler).jobType !== JOB_SOLDIER_SWORD) continue;
    if (fx.toInt(sim.world.get(e, Position).x) > swordStartX) return true;
  }
  return false;
}

export const combatScene: SceneDefinition = {
  id: 'combat',
  title: 'Walka — animacje ataku',
  summary:
    'Piec pojedynkow (wlocznia, krotki i dlugi miecz, krotki i dlugi luk) na roznych osiach natarcia — ' +
    'do oceny kazdego zamachu w wielu kierunkach. Niebiescy podchodza bojowym chodem i wygrywaja; ' +
    'lucznicy wymieniaja widoczne strzaly. Wrogosc wynika z gracza (kolor druzyny) — bez skryptow.',
  seed: 7,
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  runTicks: 2000,
  initialZoom: 0.8,
  checklist: [
    'Zamach kazdej broni gra sie W CALOSCI (bez uciecia w polowie) i jest zwrocony TWARZA w strone celu',
    'Kierunki: miecze walcza wschod-zachod, dwureczne polnoc-poludnie, wlocznie po przekatnej — kazdy zamach idzie we wlasciwa strone',
    'Miecznicy/wlocznicy podchodza „bojowym" chodem (bron gotowa, _agressive), nie zwyklym spacerem',
    'Lucznicy napinaja luk (krotki 12 klatek, dlugi 28 — wyraznie dluzszy) i wypuszczaja strzale w klatce zwolnienia',
    'Strzala jest WIDOCZNA w locie (minimalny grot — brak zdekodowanego spritu strzaly, znana luka) i trafia w cel',
    'Walka trwa kilka pelnych zamachow (nie blyskawiczny zgon); trafiony NIE ma animacji drgniecia (brak _attacked bobseq — luka danych)',
    'Druzyny rozroznialne kolorem; czerwoni gina, niebiescy przewazaja; przesun kamere by objac lucznikow po prawej',
  ],
  checks: [
    {
      label: 'the red squad is defeated (combat resolves deterministically)',
      predicate: (sim) => enemyLivingSettlers(sim) === 0,
    },
    {
      label: 'blue fighters survive the clash',
      // The shared owned-count query suffices: cleanupSystem reaps 0-HP settlers the same tick, so
      // every counted blue is alive by the time a check runs.
      predicate: (sim) => blueOwnedSettlers(sim) > 0,
    },
    {
      label: 'the blue swordsmen advanced from their start column into melee',
      predicate: blueAdvanced,
    },
  ],
};
