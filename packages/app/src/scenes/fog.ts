import type { Entity, Simulation } from '@vinland/sim';
import { cellAnchorNode, components, FOG_MODE, FOG_STATE, systems } from '@vinland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { ENEMY_PLAYER, HUMAN_PLAYER, PRIMARY_TRIBE } from '../game/rules.js';
import {
  BUILDING_HEADQUARTERS,
  GATHERERS,
  JOB_IDLE,
  JOB_SOLDIER_SWORD,
  placeResourceNode,
  placeSandboxBuilding,
  spawnSandboxSettler,
} from '../game/sandbox/index.js';
import type { SceneDefinition } from './types.js';

/**
 * The FOG-OF-WAR sign-off scene — `full` mode (classic RTS fog), authored so all three per-cell
 * states show at once and the sim gates are observable:
 *
 *  - the HUMAN base (headquarters + idle civilians) holds a VISIBLE pocket in the north-west;
 *  - a SCOUT (the widest eye) walks a long corridor east on tick 1 — ground behind it falls back to
 *    the explored GREY (terrain only), proving the `full` regression live;
 *  - the map's far south-east stays UNEXPLORED black;
 *  - an enemy civilian stands within combat SIGHT of our southern civilian but outside every eye's
 *    vision — the fog gate keeps both calm (no flee) and the enemy undrawn;
 *  - trees near the base draw normally, a far cluster sits in the fog (undrawn until explored);
 *  - an enemy soldier waits deep in the black — invisible on map and minimap alike.
 *
 * `?fog=reveal` / `?fog=recon` on the same scene compare the other two modes (a named divergence from
 * the headless twin, like `?speed=`). All fog design is OURS (radii user-tuned 2026-07-11; the
 * original's exploration is observed behaviour) — the checks pin self-consistency.
 */

const MAP_W = 44;
const MAP_H = 32;

/** The scout trade — `jobtypes.ini` 27 "scout" (the sim's SCOUT_JOB; vision 26 nodes, stance IGNORE). */
const JOB_SCOUT = 27;

/** The base pocket: HQ at (6,6) — building vision 20 nodes ≈ 10 cells around it. */
const HQ = { x: 6, y: 6 } as const;
/** The scout's walk: start just past the HQ's vision reach, march to the far east on tick 1. In
 *  `full` mode the START cell must regress to grey once the scout is away (nothing else covers it). */
const SCOUT_START = { x: 20, y: 6 } as const;
const SCOUT_DEST = { x: 38, y: 6 } as const;
/** The fog-gate pair: 6 cells (12 nodes) apart — INSIDE the 16-node combat sight radius, OUTSIDE the
 *  civilian 8-node (4-cell) vision — and 20 rows south of the HQ (past its 20-node reach). Without
 *  fog the P0 civilian would flee this hostile; under fog neither side sees the other. */
const CALM_CIVILIAN = { x: 8, y: 26 } as const;
const FOGGED_ENEMY = { x: 14, y: 26 } as const;
/** An enemy soldier deep in the unexplored black — must never draw nor dot the minimap. */
const HIDDEN_SOLDIER = { x: 30, y: 28 } as const;
/** A far tree cluster in the fog (undrawn until explored) vs the visible base-side trees. */
const BASE_TREES_X = 10;
const FOGGED_TREES_X = 26;
const TREES_Y = 24;
/** The far corner the headless check pins as never-explored. */
const UNSEEN_CORNER = { x: 43, y: 31 } as const;

const { Fleeing, Owner, Settler } = components;

function build(sim: Simulation): void {
  placeSandboxBuilding(sim, BUILDING_HEADQUARTERS, HQ.x, HQ.y, HUMAN_PLAYER);
  // Two idle civilians by the base (the smallest eyes) — one anchors the visible pocket, one is the
  // southern fog-gate probe.
  spawnSandboxSettler(sim, JOB_IDLE, HQ.x + 3, HQ.y + 2, HUMAN_PLAYER);
  spawnSandboxSettler(sim, JOB_IDLE, CALM_CIVILIAN.x, CALM_CIVILIAN.y, HUMAN_PLAYER);
  // The enemy half of the fog-gate pair (an idle civilian — passive FLEE stance, so the pair proves
  // the GATE, not a fight) and the soldier hidden deep in the black.
  spawnSandboxSettler(sim, JOB_IDLE, FOGGED_ENEMY.x, FOGGED_ENEMY.y, ENEMY_PLAYER);
  spawnSandboxSettler(sim, JOB_SOLDIER_SWORD, HIDDEN_SOLDIER.x, HIDDEN_SOLDIER.y, ENEMY_PLAYER);
  // Trees: a visible pair by the base, a fogged cluster mid-map (drawn only once ground is seen).
  const wood = GATHERERS.find((g) => g.id === 'wood');
  if (wood !== undefined) {
    for (const dx of [0, 2]) {
      placeResourceNode(sim, wood, BASE_TREES_X + dx, TREES_Y - 14);
      placeResourceNode(sim, wood, FOGGED_TREES_X + dx, TREES_Y);
    }
  }
  // The scout: a DIRECT pre-tick-0 spawn (the sanctioned scene-fixture path) so its entity id is in
  // hand for the tick-1 march order — `spawnSettler` commands resolve ids only at apply time.
  const start = cellAnchorNode(SCOUT_START.x, SCOUT_START.y);
  const scout = systems.createSettler(sim.world, sim.content, {
    jobType: JOB_SCOUT,
    x: start.hx,
    y: start.hy,
    tribe: PRIMARY_TRIBE,
    owner: HUMAN_PLAYER,
  });
  if (scout !== null) {
    const dest = cellAnchorNode(SCOUT_DEST.x, SCOUT_DEST.y);
    sim.enqueue({ kind: 'moveUnit', entity: scout, x: dest.hx, y: dest.hy });
  }
}

/** The HUMAN player's effective fog state at a visual cell, or null when fog is off. */
function fogStateAt(sim: Simulation, x: number, y: number): number | null {
  const view = sim.fogView(HUMAN_PLAYER);
  return view === null ? null : view.stateAt(x, y);
}

/** Every P0 idle civilian is calm (no {@link Fleeing}) — the fog gate held against the in-sight,
 *  unseen hostile. Vacuously false when the probe civilian is missing (a broken build fails loudly). */
function civiliansCalm(sim: Simulation): boolean {
  let seen = 0;
  for (const e of sim.world.query(Settler, Owner) as Iterable<Entity>) {
    if (sim.world.get(e, Owner).player !== HUMAN_PLAYER) continue;
    if (sim.world.get(e, Settler).jobType !== JOB_IDLE) continue;
    seen++;
    if (sim.world.has(e, Fleeing)) return false;
  }
  return seen >= 2;
}

export const fogScene: SceneDefinition = {
  id: 'fog',
  title: 'Mgla wojny',
  summary:
    'Tryb full (klasyczna mgla): baza trzyma widoczna kieszen, zwiadowca odkrywa korytarz na wschod ' +
    '(za nim teren szarzeje), poludniowy wrog stoi w zasiegu walki ale poza wzrokiem — nikt nie reaguje. ' +
    'Porownaj tryby: ?fog=reveal (odkryte zostaje) i ?fog=recon (teren znany od startu).',
  seed: 11,
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  fog: 'full',
  runTicks: 500,
  initialZoom: 0.7,
  checklist: [
    'Trzy stany na raz: czern (nieodkryte), szarosc (odkryte — SAM teren, bez drzew/jednostek/budynkow), normalny widok wokol swoich',
    'Zwiadowca maszeruje na wschod i odkryja najszerszy pas; teren ZA nim wraca do szarosci (tryb full)',
    'W szarym pasie za zwiadowca nie widac zadnych jednostek ani zasobow — tylko uksztaltowanie terenu',
    'Wrogi wojownik na poludniowym wschodzie i srodkowe drzewa sa NIEWIDOCZNI dopoki mgla ich kryje',
    'Krawedz mgly jest miekka (bez widocznej kratki komorek); mgla jezdzi plynnie z kamera i zoomem',
    'Minimapa: czern/szarosc pokrywa sie z widokiem swiata; kropki wroga tylko na widocznym terenie',
    'Poludniowy cywil NIE ucieka, choc wrog stoi w zasiegu walki — mgla gejtuje reakcje (pelne egzekwowanie)',
    '?fog=reveal — raz odkryte zostaje odkryte na zawsze (zachowanie oryginalu); ?fog=recon — caly teren od startu szary, jednostki odslaniaja na biezaco',
    '?fog=off — scena wyglada jak przed wprowadzeniem mgly (bez washa, wszystko widoczne)',
  ],
  checks: [
    {
      label: 'fog is on in FULL mode for the human player',
      predicate: (sim) => sim.fogView(HUMAN_PLAYER)?.mode === FOG_MODE.FULL,
    },
    {
      label: 'the base pocket is currently visible',
      predicate: (sim) => fogStateAt(sim, HQ.x, HQ.y) === FOG_STATE.VISIBLE,
    },
    {
      label: "the scout's destination corridor is visible",
      predicate: (sim) => fogStateAt(sim, SCOUT_DEST.x, SCOUT_DEST.y) === FOG_STATE.VISIBLE,
    },
    {
      label: "the scout's start cell regressed to explored-grey (full-mode regression)",
      predicate: (sim) => fogStateAt(sim, SCOUT_START.x, SCOUT_START.y) === FOG_STATE.EXPLORED,
    },
    {
      label: 'the far corner was never explored',
      predicate: (sim) => fogStateAt(sim, UNSEEN_CORNER.x, UNSEEN_CORNER.y) === FOG_STATE.UNEXPLORED,
    },
    {
      label: "the fogged enemy's cell is not visible to the human player",
      predicate: (sim) => fogStateAt(sim, FOGGED_ENEMY.x, FOGGED_ENEMY.y) !== FOG_STATE.VISIBLE,
    },
    {
      label: 'the civilians stay calm — the in-sight, fog-hidden hostile triggers no flee',
      predicate: civiliansCalm,
    },
  ],
};
