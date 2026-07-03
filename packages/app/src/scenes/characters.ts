import { type ContentSet, IR_VERSION, parseContentSet } from '@vinland/data';
import { type Simulation, components, fx } from '@vinland/sim';
import { GRASS, VIKING, grassTerrain } from '../catalog/buildings.js';
import { HARVEST_ATOMIC, HARVEST_SWING_LENGTH } from '../content/settler-gfx.js';
import type { SceneDefinition } from './types.js';

/**
 * Acceptance scene: **sim-state → character animation** — one world where every render-side join the
 * per-job character binding makes is watchable at once, and (deliberately) almost everyone MOVES:
 * three woodcutters live the full loop (breathing idle → walk → chop swing → hauling the visible log
 * home), while the woman and the soldier family enter with a MARCH — each spawns at the map edge with
 * a {@link components.MoveGoal} to its post, so the reviewer sees the woman's own walk and every
 * soldier's weapon gait (unarmed / broadsword / longbow) before they settle into their breathing
 * weapon-idle loops. The overlay's Restart replays the whole entrance.
 *
 * The content uses the REAL job ids the binding tables key on (woman 5, soldiers 31/35/41 — the
 * `[jobbasegraphics]` join keys); the woodcutters use a NON-mapped id to prove every ordinary trade
 * falls back to the generic man.
 *
 * The headless half proves the MECHANIC: the harvest→carry→deposit loop actually ran (wood physically
 * hauled into the HQ store — so the carrying state the human watches really occurred), and every
 * marcher ARRIVED at its post (its MoveGoal satisfied + position exactly on target — so the walks the
 * human watches really happened). The pixels (which body/animation draws) are the human's checklist —
 * an agent cannot self-judge them.
 */

/** The REAL IR wood typeId (5) — deliberately ≠ the demo slice's wood(1), proving the per-good carry
 *  join keys on the CONTENT the scene runs, not on a hardcoded id. */
const WOOD = 5;
/** A deliberately UN-mapped job id (a generic trade) — draws the default civilian man. */
const WOODCUTTER = 11;
/** The real `[jobbasegraphics]` join keys the character binding maps. */
const WOMAN = 5;
const SOLDIER_UNARMED = 31;
const SOLDIER_SWORD_LONG = 35;
const SOLDIER_BOW_LONG = 41;
const HEADQUARTERS = 1;

const MAP_W = 16;
const MAP_H = 12;

const { Building, MoveGoal, Position, Resource, Settler, Stockpile } = components;

function content(): ContentSet {
  return parseContentSet({
    manifest: { version: IR_VERSION, generatedFrom: { game: 'synthetic-characters-scene' }, locale: 'eng' },
    goods: [
      { typeId: 0, id: 'none' },
      { typeId: WOOD, id: 'wood', weight: 1, atomics: { harvest: HARVEST_ATOMIC } },
    ],
    jobs: [
      { typeId: 0, id: 'idle' },
      { typeId: WOODCUTTER, id: 'woodcutter', allowedAtomics: [HARVEST_ATOMIC] },
      { typeId: WOMAN, id: 'woman' },
      { typeId: SOLDIER_UNARMED, id: 'soldier_unarmed' },
      { typeId: SOLDIER_SWORD_LONG, id: 'soldier_sword_long' },
      { typeId: SOLDIER_BOW_LONG, id: 'soldier_bow_long' },
    ],
    buildings: [
      {
        typeId: HEADQUARTERS,
        id: 'headquarters',
        kind: 'headquarters',
        workers: [{ jobType: WOODCUTTER, count: 3 }],
        stock: [{ goodType: WOOD, capacity: 150, initial: 0 }],
      },
    ],
    landscape: [{ typeId: GRASS, id: 'grass', walkable: true, buildable: true }],
    tribes: [
      {
        typeId: VIKING,
        id: 'viking',
        atomicBindings: [{ jobType: WOODCUTTER, atomicId: HARVEST_ATOMIC, animation: 'viking_chop' }],
      },
    ],
    // length 16 → the renderer sees elapsed 1..15, one full windup→strike woodcut swing (the slice's tuning).
    atomicAnimations: [{ id: 'viking_chop', name: 'viking_chop', length: HARVEST_SWING_LENGTH }],
  });
}

/** Every placement, spread so each character reads separately at the default zoom. */
const HQ_AT = { x: 3, y: 3 };
/** Four wood nodes clustered south-east — the woodcutters' work site, far enough from the HQ that the
 *  loaded haul crosses most of the screen. */
const TREES = [
  { x: 11, y: 8 },
  { x: 12, y: 8 },
  { x: 12, y: 9 },
  { x: 13, y: 7 },
];
/** Three woodcutters — constant walk/chop/haul traffic, so the scene is never still. */
const CUTTERS = [
  { x: 10, y: 8 },
  { x: 10, y: 9 },
  { x: 11, y: 7 },
];
/**
 * The ENTRANCE MARCHES: each mapped character spawns at `from` (the map edge) and walks to its post
 * `to` via a {@link MoveGoal}, so its own gait — the woman's walk, each soldier's weapon walk — is on
 * screen for the first stretch of the scene. The march is also the arrival mechanic the headless
 * check asserts (goal satisfied + position exactly on `to`).
 */
const MARCHES = [
  { from: { x: 15, y: 1 }, to: { x: 7, y: 4 }, jobType: SOLDIER_UNARMED },
  { from: { x: 15, y: 2 }, to: { x: 8, y: 4 }, jobType: SOLDIER_UNARMED },
  { from: { x: 15, y: 3 }, to: { x: 9, y: 4 }, jobType: SOLDIER_SWORD_LONG },
  { from: { x: 15, y: 4 }, to: { x: 10, y: 4 }, jobType: SOLDIER_BOW_LONG },
  { from: { x: 2, y: 9 }, to: { x: 6, y: 6 }, jobType: WOMAN },
] as const;
/** Wood per tree — enough that the loop is still mid-haul whenever the human looks. */
const TREE_WOOD = 8;

function build(sim: Simulation): void {
  sim.enqueue({ kind: 'placeBuilding', buildingType: HEADQUARTERS, x: HQ_AT.x, y: HQ_AT.y, tribe: VIKING });
  for (const c of CUTTERS) {
    sim.enqueue({ kind: 'spawnSettler', jobType: WOODCUTTER, x: c.x, y: c.y, tribe: VIKING });
  }
  for (const m of MARCHES) {
    sim.enqueue({ kind: 'spawnSettler', jobType: m.jobType, x: m.from.x, y: m.from.y, tribe: VIKING });
  }
  // Wood nodes placed directly (the slice's pattern) — the harvest→carry→deposit loop's source.
  for (const cell of TREES) {
    const tree = sim.world.create();
    sim.world.add(tree, Position, { x: fx.fromInt(cell.x), y: fx.fromInt(cell.y) });
    sim.world.add(tree, Resource, { goodType: WOOD, remaining: TREE_WOOD, harvestAtomic: HARVEST_ATOMIC });
  }
  // Apply the spawns (one tick), then send each marcher walking: MoveGoal is the sim's own
  // "wants to be at" record — the navigation planner paths it there and removes the goal on arrival.
  // Deterministic: build() runs identically for the headless test and the browser view. Marchers are
  // matched by their exact spawn position (they have no drives, so they haven't moved on tick 1).
  sim.step();
  for (const e of [...sim.world.query(Settler, Position)]) {
    const p = sim.world.get(e, Position);
    const march = MARCHES.find((m) => p.x === fx.fromInt(m.from.x) && p.y === fx.fromInt(m.from.y));
    if (march === undefined) continue;
    sim.world.add(e, MoveGoal, { cell: march.to.y * MAP_W + march.to.x });
  }
}

/** Wood banked in the HQ store — the proof the harvest→carry→deposit loop (the carrying the human
 *  watches) actually ran. */
function hqWood(sim: Simulation): number {
  for (const e of sim.world.query(Building, Stockpile)) {
    if (sim.world.get(e, Building).buildingType !== HEADQUARTERS) continue;
    return sim.world.get(e, Stockpile).amounts.get(WOOD) ?? 0;
  }
  return 0;
}

/** Live settlers holding `jobType` — the mapped characters must exist for the human to judge them. */
function settlersWithJob(sim: Simulation, jobType: number): number {
  let n = 0;
  for (const e of sim.world.query(Settler)) {
    if (sim.world.get(e, Settler).jobType === jobType) n++;
  }
  return n;
}

/** Whether every marcher ARRIVED: stands exactly on its post with its MoveGoal satisfied (removed).
 *  Scoped to the marcher JOBS — the woodcutters legitimately carry planner MoveGoals all run long. */
function allMarchersArrived(sim: Simulation): boolean {
  const marcherJobs = new Set<number | null>(MARCHES.map((m) => m.jobType));
  const posts = MARCHES.map((m) => ({ x: fx.fromInt(m.to.x), y: fx.fromInt(m.to.y) }));
  let arrived = 0;
  for (const e of [...sim.world.query(Settler, Position)]) {
    if (!marcherJobs.has(sim.world.get(e, Settler).jobType)) continue;
    if (sim.world.has(e, MoveGoal)) return false; // still walking (or never routed) — not arrived
    const p = sim.world.get(e, Position);
    if (posts.some((t) => t.x === p.x && t.y === p.y)) arrived++;
  }
  return arrived === MARCHES.length;
}

export const charactersScene: SceneDefinition = {
  id: 'characters',
  title: 'Postacie — animacja spięta ze stanem sima',
  summary:
    'Jeden świat, w którym widać każdy render-owy join stan→animacja — i prawie wszyscy się RUSZAJĄ: ' +
    'trzej drwale krążą w pętli (marsz → zamach siekierą → niosą WIDOCZNĄ kłodę do magazynu), a kobieta ' +
    'i żołnierze wchodzą na scenę marszem do swoich stanowisk (każdy żołnierz swoim chodem broni: bez ' +
    'broni / miecz dwuręczny / łuk), po czym oddychają w pętli z bronią w rękach. Zwykłe zawody rysują ' +
    'generycznego cywila; głowy różnią się per osobnik. Restart odtwarza cały wmarsz.',
  seed: 31,
  content: content(),
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  // Enough for the full loop at the ⅛ tile/tick pace: the marches (~9 tiles ≈ 72 ticks) and at least
  // one complete harvest→carry→deposit round trip (~2×11 tiles + the swing ≈ 200+ ticks).
  runTicks: 800,
  initialZoom: 1,
  checklist: [
    'Na starcie kobieta (z lewej) i czterej żołnierze (z prawej) WCHODZĄ marszem na swoje miejsca — każdy żołnierz idzie swoim chodem broni (przyciśnij Restart, by odtworzyć wmarsz)',
    'Drwale (cywile): idą pełnym krokiem, przy drzewie zamach siekierą, potem niosą WIDOCZNĄ kłodę do magazynu (inny chód niż z pustymi rękami)',
    'Kobieta ma własne ciało/suknię i własną pętlę oddychania — nie jest przebranym mężczyzną',
    'Żołnierze po dojściu ODDYCHAJĄ z bronią w rękach (pętla wait per broń — miecz dwuręczny, łuk, dwaj bez broni), nikt nie zamarza w stopklatce',
    'Dwaj żołnierze bez broni mają RÓŻNE głowy/hełmy (wariacja per osobnik)',
  ],
  checks: [
    {
      label: 'the harvest→carry→deposit loop ran (wood physically hauled into the HQ store)',
      predicate: (sim) => hqWood(sim) > 0,
    },
    {
      label: 'every marcher arrived at its post (MoveGoal satisfied, position exactly on target)',
      predicate: allMarchersArrived,
    },
    {
      label:
        'the mapped characters are alive with their join-key jobs (woman, unarmed ×2, broadsword, longbow)',
      predicate: (sim) =>
        settlersWithJob(sim, WOMAN) === 1 &&
        settlersWithJob(sim, SOLDIER_UNARMED) === 2 &&
        settlersWithJob(sim, SOLDIER_SWORD_LONG) === 1 &&
        settlersWithJob(sim, SOLDIER_BOW_LONG) === 1,
    },
  ],
};
