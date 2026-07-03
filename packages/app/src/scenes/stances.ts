import { type ContentSet, IR_VERSION, parseContentSet } from '@vinland/data';
import { type Entity, type Simulation, components, fx, systems } from '@vinland/sim';
import { GRASS, VIKING, grassTerrain } from '../catalog/buildings.js';
import type { SceneDefinition } from './types.js';

/**
 * Acceptance scene: **military stances** — a raid on a working settlement, staging all four
 * `MILITARY_MODE`s at once so a human can watch each behavior in one run:
 *
 *  - **Soldiers (ATTACK)** — the town's stronger squad charges the raider army and wins.
 *  - **Civilians (FLEE)** — a knot of civilians RUNS from a chasing raider, outpacing it (the run gait):
 *    the gap to the pursuer grows, it never catches them.
 *  - **Scout (IGNORE)** — stands its ground far from the fray; it never auto-engages.
 *  - **Defender (DEFEND)** — holds an anchored post: it engages a raider that steps into its small
 *    defend radius but never chases past its leash, returning to the post.
 *
 * The four encounters are in separated map regions (each pair of hostiles > the sight radius from the
 * others) so the behaviors don't cross-contaminate — and each raider group is a DIFFERENT player, so a
 * check about one group ("the army is wiped") never counts another group's units.
 *
 * The headless half proves the MECHANICS (the town wins, the flee gap grows, the scout is unmoved, the
 * defender stays on its post); the browser half lets a human watch the modes play out. NOTE: attack /
 * flee ANIMATIONS are still missing (step 5) — you see units converge, run, hold, and HP fall / bodies
 * vanish, but not swing/run poses yet.
 */

const COIN = 3; // the good the viking tech edge unlocks (makes VIKING a playable civ, not an animal tribe)
const SWORD = 7;
const CIVILIAN = 1;
const SCOUT = 27; // jobtypes.ini scout (default IGNORE)
const SOLDIER = 34; // jobtypes.ini soldier_sword_short (in the 31..41 soldier band → default ATTACK)

// Players: the town (its soldiers/civilians/scout/defender) and THREE separate raider players, one per
// encounter, so a per-encounter check never miscounts another encounter's units.
const TOWN = 0;
const ARMY = 1; // the raider army the town soldiers fight
const CHASER = 2; // the lone raider the civilians flee from
const MARCHER = 3; // the lone raider that tests the defender's leash

const MAP_W = 64;
const MAP_H = 32;

const { MILITARY_MODE, DEFEND_LEASH_TILES } = systems;
const { Health, Owner, Position, Settler, Stance } = components;

// --- layout (kept as constants so the checks read against the same numbers the build places) ----------
const SCOUT_AT = { x: 4, y: 30 } as const;
const DEFENDER_AT = { x: 16, y: 26 } as const;
/** Civilians start here (fleeing LEFT); the chaser starts CHASER_GAP tiles to their right. */
const CIVILIANS_AT = [
  { x: 40, y: 4 },
  { x: 42, y: 4 },
  { x: 41, y: 5 },
] as const;
const CHASER_AT = { x: 46, y: 4 } as const;
/** The closest civilian↔chaser distance at spawn — the flee check asserts the gap GREW beyond it. */
const INITIAL_FLEE_GAP = 4; // chaser x=46, nearest civilian x=42

function content(): ContentSet {
  return parseContentSet({
    manifest: {
      version: IR_VERSION,
      generatedFrom: { game: 'synthetic-stances-scene' },
      locale: 'eng',
    },
    goods: [
      { typeId: 0, id: 'none' },
      { typeId: COIN, id: 'coin' },
    ],
    jobs: [
      { typeId: 0, id: 'idle' },
      { typeId: CIVILIAN, id: 'civilian' },
      { typeId: SCOUT, id: 'scout' },
      { typeId: SOLDIER, id: 'soldier' },
    ],
    buildings: [],
    landscape: [{ typeId: GRASS, id: 'grass', walkable: true, buildable: true }],
    // A short-reach sword (band [1,2], 50 damage vs unarmored) bound to the soldier job — every fighter
    // (town soldiers, army, chaser, marcher, defender) wields it; the fights are decided by count/HP.
    weapons: [
      {
        typeId: SWORD,
        id: 'viking_sword',
        tribeType: VIKING,
        jobType: SOLDIER,
        minRange: 1,
        maxRange: 2,
        damage: { '0': 50 },
      },
    ],
    tribes: [
      {
        typeId: VIKING,
        id: 'viking',
        atomicBindings: [{ jobType: SOLDIER, atomicId: 81, animation: 'viking_attack' }],
        // a tech edge, so VIKING reads as a playable CIVILIZATION (not an animal tribe).
        jobEnables: [{ jobType: SOLDIER, kind: 'good', targetId: COIN }],
      },
    ],
    atomicAnimations: [{ id: 'viking_attack', name: 'viking_attack', length: 8 }],
  });
}

/** Directly place an owned combatant in an explicit stance (full control over the mode — the DEFENDER
 *  needs DEFEND, which no job defaults to). Mirrors what `spawnSettler` stamps: Position/Settler/Health/
 *  Owner + the given Stance (anchored on its own tile for DEFEND). */
function place(
  sim: Simulation,
  x: number,
  y: number,
  player: number,
  jobType: number,
  mode: number,
  hitpoints: number,
): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Settler, {
    tribe: VIKING,
    jobType,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
    experience: new Map<number, number>(),
  });
  sim.world.add(e, Health, { hitpoints, max: hitpoints });
  sim.world.add(e, Owner, { player });
  const anchorCell =
    mode === MILITARY_MODE.DEFEND && sim.terrain !== undefined ? sim.terrain.cellAtClamped(x, y) : null;
  sim.world.add(e, Stance, { mode, anchorCell });
  return e;
}

function build(sim: Simulation): void {
  // Scout (IGNORE) — alone in a far corner; it never auto-engages and nothing reaches it.
  place(sim, SCOUT_AT.x, SCOUT_AT.y, TOWN, SCOUT, MILITARY_MODE.IGNORE, 300);

  // Combat — the town's stronger squad (4 × tough) vs the raider army (3 × frail): the town wins.
  for (const p of [
    { x: 24, y: 15 },
    { x: 24, y: 16 },
    { x: 24, y: 17 },
    { x: 25, y: 16 },
  ]) {
    place(sim, p.x, p.y, TOWN, SOLDIER, MILITARY_MODE.ATTACK, 400);
  }
  for (const p of [
    { x: 30, y: 15 },
    { x: 30, y: 16 },
    { x: 30, y: 17 },
  ]) {
    place(sim, p.x, p.y, ARMY, SOLDIER, MILITARY_MODE.ATTACK, 150);
  }

  // Flee — civilians run LEFT from a chasing raider (the CHASER player). The run gait keeps them ahead.
  for (const c of CIVILIANS_AT) place(sim, c.x, c.y, TOWN, CIVILIAN, MILITARY_MODE.FLEE, 150);
  place(sim, CHASER_AT.x, CHASER_AT.y, CHASER, SOLDIER, MILITARY_MODE.ATTACK, 300);

  // Defend — a defender holds an anchored post; a frail marcher (the MARCHER player) steps into its
  // radius, gets engaged, and dies — the defender never chases past its leash and returns to the post.
  place(sim, DEFENDER_AT.x, DEFENDER_AT.y, TOWN, SOLDIER, MILITARY_MODE.DEFEND, 600);
  place(sim, 22, 26, MARCHER, SOLDIER, MILITARY_MODE.ATTACK, 80);
}

// --- check helpers -----------------------------------------------------------------------------------
function tileOf(sim: Simulation, e: Entity): { x: number; y: number } {
  const p = sim.world.get(e, Position);
  return { x: fx.toInt(p.x), y: fx.toInt(p.y) };
}

function tileDist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

/** Living (Health > 0) settlers owned by `player`. */
function livingOf(sim: Simulation, player: number): Entity[] {
  const out: Entity[] = [];
  for (const e of sim.world.query(Settler, Owner, Health)) {
    if (sim.world.get(e, Owner).player === player && sim.world.get(e, Health).hitpoints > 0) out.push(e);
  }
  return out;
}

/** Town units of a given stance mode (alive). */
function townWithStance(sim: Simulation, mode: number): Entity[] {
  return livingOf(sim, TOWN).filter((e) => sim.world.get(e, Stance).mode === mode);
}

export const stancesScene: SceneDefinition = {
  id: 'stances',
  title: 'Postawy wojskowe — atak / obrona / ignoruj / ucieczka',
  summary:
    'Najazd na osadę: żołnierze miasta (ATAK) rozbijają armię najeźdźców; cywile (UCIECZKA) uciekają ' +
    'BIEGIEM przed ścigającym ich wojownikiem i nie dają się złapać; zwiadowca (IGNORUJ) stoi z boku i nie ' +
    'wdaje się w walkę; obrońca (OBRONA) trzyma swój posterunek — dopada wroga, który wejdzie w jego mały ' +
    'promień, ale nie goni go dalej niż smycz i wraca na miejsce. UWAGA: animacje ciosu/biegu dopiero w kroku 5.',
  seed: 7,
  content: content(),
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  // Enough ticks for the town to win, the flee gap to open, the defender to see off its marcher — and NOT
  // so long the fleeing civilians run off the left edge (they drift ~1 tile/8-ticks net, from x≈41).
  runTicks: 220,
  initialZoom: 0.85,
  checklist: [
    'ŻOŁNIERZE (ATAK): oddział miasta rusza na armię najeźdźców i ją rozbija — słabsza strona ginie',
    'CYWILE (UCIECZKA): uciekają BIEGIEM (wyraźnie szybciej niż idą żołnierze) i ścigający ich wojownik ich nie dogania — odstęp rośnie',
    'ZWIADOWCA (IGNORUJ): stoi w rogu mapy i NIE wdaje się w żadną walkę (nie rusza z miejsca)',
    'OBROŃCA (OBRONA): trzyma swój posterunek — atakuje wroga w małym promieniu, ale nie goni go po mapie i wraca na miejsce',
    'Zaznaczenie jednostki → panel akcji (Spacja) pokazuje przyciski postawy (Atak/Obrona/Ignoruj/Ucieczka); „Postawa" w karcie info pokazuje aktualny tryb',
  ],
  checks: [
    {
      label: 'ATTACK: the town soldiers win — the raider army is wiped out, town soldiers survive',
      predicate: (sim) =>
        livingOf(sim, ARMY).length === 0 && townWithStance(sim, MILITARY_MODE.ATTACK).length > 0,
    },
    {
      label: 'FLEE: every civilian outran the chaser — the nearest civilian↔chaser gap grew beyond its start',
      predicate: (sim) => {
        const chasers = livingOf(sim, CHASER);
        const civs = townWithStance(sim, MILITARY_MODE.FLEE);
        if (chasers.length === 0 || civs.length === 0) return false;
        const chaserTile = tileOf(sim, chasers[0] as Entity);
        const minGap = Math.min(...civs.map((c) => tileDist(tileOf(sim, c), chaserTile)));
        return minGap > INITIAL_FLEE_GAP;
      },
    },
    {
      label: 'FLEE: the civilians stayed AHEAD of the chaser (none was caught into melee range)',
      predicate: (sim) => {
        const chasers = livingOf(sim, CHASER);
        const civs = townWithStance(sim, MILITARY_MODE.FLEE);
        if (chasers.length === 0) return false;
        const chaserTile = tileOf(sim, chasers[0] as Entity);
        return civs.every((c) => tileDist(tileOf(sim, c), chaserTile) > 2); // beyond the sword's reach band
      },
    },
    {
      label: 'IGNORE: the scout never moved from its corner (no auto-engagement pulled it in)',
      predicate: (sim) => {
        const scouts = townWithStance(sim, MILITARY_MODE.IGNORE);
        return scouts.length === 1 && tileDist(tileOf(sim, scouts[0] as Entity), SCOUT_AT) === 0;
      },
    },
    {
      label: 'DEFEND: the defender held its post — it stayed within the leash of its anchor',
      predicate: (sim) => {
        const defenders = townWithStance(sim, MILITARY_MODE.DEFEND);
        if (defenders.length !== 1) return false;
        return tileDist(tileOf(sim, defenders[0] as Entity), DEFENDER_AT) <= DEFEND_LEASH_TILES;
      },
    },
  ],
};
