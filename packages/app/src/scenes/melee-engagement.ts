import { type ContentSet, IR_VERSION, parseContentSet } from '@vinland/data';
import { type Entity, type Simulation, components, fx } from '@vinland/sim';
import { GRASS, VIKING, grassTerrain } from '../catalog/buildings.js';
import type { SceneDefinition } from './types.js';

/**
 * Acceptance scene: **melee engagement** — two owned squads of the SAME tribe (viking) belonging to
 * DIFFERENT players advance across a gap, meet in the middle, and fight to a deterministic finish. It
 * exercises the engagement half of combat end-to-end through the real `step()` schedule: the
 * owner-based hostility axis (same tribe, told apart by player), the walk-into-melee advance (each
 * soldier spots an enemy within sight and chases it), the in-band swing on arrival, and the death/
 * cleanup that decides the winner.
 *
 * The headless half proves the MECHANIC (both sides close and trade blows, the frailer squad is wiped,
 * the outcome is fixed) with no screen; the browser half lets a human watch the two colours clash. NOTE
 * to the reviewer: the ATTACK ANIMATION is still missing (a swing plays no strike bob until the combat
 * animation slice, step 5) — you see units converge, stop adjacent, and HP fall / bodies vanish, but not
 * a sword-swing pose yet.
 */

// The original's `soldier_sword_short` job (id 34 in `jobtypes`). Using the REAL soldier job id — not a
// synthetic `1` — makes the squads render as the armoured WARRIOR body: the render `[jobbasegraphics]`
// join maps job 34 → the `warrior-sword` character (see packages/app `ADULT_CHARACTER_BY_JOB`), where an
// unknown id falls back to the civilian default. The sim keys combat off (tribe, jobType), so the sword
// binds to this job all the same. (34 ≠ HUNTER_JOB 15, so the dormancy gate never misreads it as a hunter.)
const SOLDIER = 34;
const COIN = 3; // the good the viking tech edge unlocks (makes VIKING a playable civ, not an animal tribe)
const SWORD = 7;
const BLUE = 0; // player 0
const RED = 1; // player 1

const MAP_W = 24;
const MAP_H = 12;

/** The frailer RED squad is wiped; BLUE (more soldiers, tougher) survives — a fixed, seed-independent
 *  outcome (combat carries no RNG). The asymmetry lives entirely in the spawn data (count + hitpoints). */
const BLUE_HP = 320;
const RED_HP = 170;

const { AttackOrder, Engagement, Health, Owner, Position, Settler } = components;

function content(): ContentSet {
  return parseContentSet({
    manifest: {
      version: IR_VERSION,
      generatedFrom: { game: 'synthetic-melee-engagement-scene' },
      locale: 'eng',
    },
    goods: [
      { typeId: 0, id: 'none' },
      { typeId: COIN, id: 'coin' },
    ],
    jobs: [
      { typeId: 0, id: 'idle' },
      { typeId: SOLDIER, id: 'soldier' },
    ],
    buildings: [],
    landscape: [{ typeId: GRASS, id: 'grass', walkable: true, buildable: true }],
    // A short-reach melee sword (band [1,1], 40 damage vs unarmored) — both squads wield the same weapon
    // (same tribe); the fight is decided by the count/HP asymmetry, not the loadout.
    weapons: [
      {
        typeId: SWORD,
        id: 'viking_sword',
        tribeType: VIKING,
        jobType: SOLDIER,
        minRange: 1,
        maxRange: 1,
        damage: { '0': 40 },
      },
    ],
    tribes: [
      {
        typeId: VIKING,
        id: 'viking',
        // attack atomic 81 -> viking_attack (length 4): the swing duration/cadence.
        atomicBindings: [{ jobType: SOLDIER, atomicId: 81, animation: 'viking_attack' }],
        // a tech edge, so VIKING reads as a playable CIVILIZATION (not an animal tribe) — the owner axis
        // still decides the fight, but the classification stays honest.
        jobEnables: [{ jobType: SOLDIER, kind: 'good', targetId: COIN }],
      },
    ],
    atomicAnimations: [{ id: 'viking_attack', name: 'viking_attack', length: 4 }],
  });
}

/** BLUE (player 0) — four soldiers in a column on the LEFT; RED (player 1) — three on the RIGHT, frailer.
 *  Gap 6 tiles (x 8 → 14), inside the combat sight radius, so both columns spot each other and advance. */
const BLUE_X = 8;
const RED_X = 14;
const BLUE_ROWS = [3, 4, 5, 6] as const;
const RED_ROWS = [4, 5, 6] as const;

function build(sim: Simulation): void {
  for (const y of BLUE_ROWS) {
    sim.enqueue({
      kind: 'spawnSettler',
      jobType: SOLDIER,
      x: BLUE_X,
      y,
      tribe: VIKING,
      owner: BLUE,
      hitpoints: BLUE_HP,
    });
  }
  for (const y of RED_ROWS) {
    sim.enqueue({
      kind: 'spawnSettler',
      jobType: SOLDIER,
      x: RED_X,
      y,
      tribe: VIKING,
      owner: RED,
      hitpoints: RED_HP,
    });
  }
}

/** Living soldiers owned by `player`. */
function aliveOf(sim: Simulation, player: number): Entity[] {
  const out: Entity[] = [];
  for (const e of sim.world.query(Settler, Owner, Health)) {
    if (sim.world.get(e, Owner).player === player && sim.world.get(e, Health).hitpoints > 0) out.push(e);
  }
  return out;
}

export const meleeEngagementScene: SceneDefinition = {
  id: 'melee-engagement',
  title: 'Starcie — dwa oddziały nacierają i walczą',
  summary:
    'Dwa oddziały wikingów należące do RÓŻNYCH graczy (niebieski vs czerwony) stoją po dwóch stronach ' +
    'luki. Każdy żołnierz dostrzega wroga w zasięgu wzroku, rusza na niego, zatrzymuje się w zwarciu i ' +
    'atakuje. Słabszy oddział (czerwony) ginie; niebieski wygrywa — wynik jest deterministyczny. UWAGA: ' +
    'animacja ciosu pojawi się dopiero w kroku 5 — na razie widać zbliżenie, spadające HP i znikające ciała.',
  seed: 5,
  content: content(),
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  // Enough ticks to advance ~6 tiles (⅛/tile), fight it out, and reap the fallen with margin.
  runTicks: 600,
  initialZoom: 1.4,
  checklist: [
    'Oba oddziały RUSZAJĄ ku sobie i spotykają się mniej więcej po środku luki (nie stoją w miejscu)',
    'Żołnierze zatrzymują się w zwarciu (sąsiednie pola) i wymieniają ciosy — paski HP obu stron spadają',
    'Czerwony oddział (słabszy) zostaje wybity do nogi; niebieski ma ocalałych — zwycięzca jest ten sam co za każdym razem',
    'Zaznaczenie/PPM na wrogu wydaje rozkaz ataku (żołnierz goni wskazany cel) — ale animacja ciosu jeszcze nie działa (krok 5)',
  ],
  checks: [
    {
      label: 'the frailer RED squad is wiped out (deaths occurred)',
      predicate: (sim) => aliveOf(sim, RED).length === 0,
    },
    {
      label: 'BLUE wins deterministically (survivors remain on exactly one side)',
      predicate: (sim) => aliveOf(sim, BLUE).length > 0,
    },
    {
      label: 'the combat was mutual — BLUE survivors took damage, so RED reached melee range (both advanced)',
      predicate: (sim) => aliveOf(sim, BLUE).some((e) => sim.world.get(e, Health).hitpoints < BLUE_HP),
    },
    {
      label: 'BLUE advanced from its start column toward the clash (walked into melee)',
      predicate: (sim) => aliveOf(sim, BLUE).some((e) => fx.toInt(sim.world.get(e, Position).x) > BLUE_X),
    },
    {
      label: 'the fight ended — no soldier is left mid-engagement (all disengaged)',
      predicate: (sim) => {
        for (const e of sim.world.query(Settler, Owner)) {
          if (sim.world.has(e, Engagement) || sim.world.has(e, AttackOrder)) return false;
        }
        return true;
      },
    },
  ],
};
