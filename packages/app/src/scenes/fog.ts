import type { Entity, Simulation } from '@vinland/sim';
import { cellAnchorNode, components, FOG_MODE, FOG_STATE, systems } from '@vinland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { ENEMY_PLAYER, HUMAN_PLAYER, PRIMARY_TRIBE } from '../game/rules.js';
import {
  BUILDING_HEADQUARTERS,
  BUILDING_HOME_00,
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
 *  - an enemy HOUSE beside the corridor is revealed by the marching scout, then falls back under the
 *    fog OUT of every eye's reach — it stays drawn as a dimmed GHOST (the remembered-statics layer);
 *  - trees near the base draw normally; a mid-map cluster (inside the scout's OPENING bubble) is seen
 *    at start and turns into dimmed ghosts once the fog returns; a SOUTH-EAST pair sits outside every
 *    eye — never seen, never drawn in `full`, yet visible from the start under `?fog=recon` (the
 *    natural-resource seed);
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
/** The GHOST demo: an enemy house 4 rows off the corridor — the passing scout reveals it (152 px,
 *  well inside its 884 px vision), but from the DEST it is 14 columns = 952 px away, outside every
 *  eye — so after the march its ground regresses to grey and only the remembered ghost remains. */
const GHOST_HOUSE = { x: 24, y: 10 } as const;
/** The fog-gate pair: 7 cells (14 nodes) apart — INSIDE the 16-node combat sight radius, OUTSIDE the
 *  civilian 12-node (408 px, 6-cell) vision — and 20 rows south of the HQ (past its 20-node reach).
 *  Without fog the P0 civilian would flee this hostile; under fog neither side sees the other. */
const CALM_CIVILIAN = { x: 8, y: 26 } as const;
const FOGGED_ENEMY = { x: 15, y: 26 } as const;
/** An enemy soldier deep in the unexplored black — must never draw nor dot the minimap. Past the
 *  scout's whole march reach (the 26-node eye sweeps ±23 rows along row 6, and holds a bubble at the
 *  dest): from (38,6) this is (204 px, 950 px) away — outside the 884 px radius. */
const HIDDEN_SOLDIER = { x: 41, y: 31 } as const;
/** Trees: BASE pair in the base pocket (always lit); MID cluster inside the scout's opening bubble —
 *  seen at start, dimmed GHOSTS after the fog returns. */
const BASE_TREES_X = 10;
const FOGGED_TREES_X = 26;
const TREES_Y = 24;
/** The RECON-seed pair: in the never-explored SOUTH-EAST pocket (like {@link UNSEEN_CORNER} — the
 *  scout's dest bubble at (38,6) falls short: (42,29) is (272 px, 874 px) away, past the 884 px
 *  radius, and the wandering idlers stay west) — never drawn in `full`, seeded ghosts in `recon`.
 *  NOT the south-west: the southern civilian's wander reaches there within the scene's 500 ticks. */
const UNSEEN_TREES = [
  { x: 40, y: 30 },
  { x: 42, y: 29 },
] as const;
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
  // The ghost demo: the scout reveals this enemy house in passing; once the fog returns it stays
  // drawn as a dimmed remembered ghost (render-side memory — the sim mask alone regresses to grey).
  placeSandboxBuilding(sim, BUILDING_HOME_00, GHOST_HOUSE.x, GHOST_HOUSE.y, ENEMY_PLAYER);
  // Trees: a visible pair by the base, a fogged cluster mid-map (drawn only once ground is seen).
  const wood = GATHERERS.find((g) => g.id === 'wood');
  if (wood !== undefined) {
    for (const dx of [0, 2]) {
      placeResourceNode(sim, wood, BASE_TREES_X + dx, TREES_Y - 14);
      placeResourceNode(sim, wood, FOGGED_TREES_X + dx, TREES_Y);
    }
    // The recon-seed pair: sight-unseen forever in `full`, ghosted from tick 0 under `?fog=recon`.
    for (const t of UNSEEN_TREES) placeResourceNode(sim, wood, t.x, t.y);
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
    '(za nim teren szarzeje, a odkryty dom wroga zostaje jako przygaszony duch), poludniowy wrog stoi ' +
    'w zasiegu walki ale poza wzrokiem — nikt nie reaguje. Porownaj tryby: ?fog=reveal (odkryte zostaje) ' +
    'i ?fog=recon (teren znany od startu, naturalne zasoby widoczne jako duchy).',
  seed: 11,
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  fog: 'full',
  runTicks: 500,
  initialZoom: 0.7,
  checklist: [
    'Trzy stany na raz: czern (nieodkryte), szarosc (odkryte — teren + duchy statykow, bez jednostek), normalny widok wokol swoich',
    'Zwiadowca maszeruje na wschod i odkryja najszerszy pas; teren ZA nim wraca do szarosci (tryb full)',
    'DUCHY: wrogi dom przy korytarzu (24,10) po przejsciu zwiadowcy zostaje widoczny jako PRZYGASZONY duch na szarym terenie; srodkowe drzewa (widziane na starcie) tez szarzeja zamiast znikac',
    'W szarym pasie za zwiadowca nie widac zadnych JEDNOSTEK — tylko teren i zapamietane duchy statykow',
    'Wrogi wojownik i para drzew w poludniowo-wschodnim rogu sa NIEWIDOCZNI (nigdy nie zobaczone = brak ducha, czarna dziura)',
    'Krawedz mgly jest miekka (bez widocznej kratki komorek); mgla jezdzi plynnie z kamera i zoomem',
    'Minimapa: czern/szarosc pokrywa sie z widokiem swiata; kropki wroga tylko na widocznym terenie',
    'Poludniowy cywil NIE ucieka, choc wrog stoi w zasiegu walki — mgla gejtuje reakcje (pelne egzekwowanie)',
    '?fog=reveal — raz odkryte zostaje odkryte na zawsze (zachowanie oryginalu); ?fog=recon — caly teren od startu szary, a NATURALNE ZASOBY widoczne od startu jako duchy (sprawdz pare drzew w SE rogu; wrogie budynki NIE sa seedowane)',
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
      // The sim substrate of the render-side ghost: the house WAS seen (explored, not black) and is
      // no longer watched (not visible) — exactly the state the ghost store draws a memory on.
      label: "the ghost house's cell was seen and regressed to explored-grey",
      predicate: (sim) => fogStateAt(sim, GHOST_HOUSE.x, GHOST_HOUSE.y) === FOG_STATE.EXPLORED,
    },
    {
      label: 'the far corner was never explored',
      predicate: (sim) => fogStateAt(sim, UNSEEN_CORNER.x, UNSEEN_CORNER.y) === FOG_STATE.UNEXPLORED,
    },
    {
      // The recon-seed demo's substrate: no eye ever reaches the SE pair, so in FULL they stay in
      // the black (no ghost) while `?fog=recon` shows them from tick 0 (the natural-resource seed).
      label: 'the south-east recon-seed trees were never explored',
      predicate: (sim) => UNSEEN_TREES.every((t) => fogStateAt(sim, t.x, t.y) === FOG_STATE.UNEXPLORED),
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
