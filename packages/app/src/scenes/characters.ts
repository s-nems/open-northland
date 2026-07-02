import { type ContentSet, IR_VERSION, parseContentSet } from '@vinland/data';
import { type Simulation, components, fx } from '@vinland/sim';
import { HARVEST_ATOMIC } from '../real-sprites.js';
import { GRASS, VIKING, grassTerrain } from '../viking-buildings.js';
import type { SceneDefinition } from './types.js';

/**
 * Acceptance scene: **sim-state → character animation** — one world where every render-side join the
 * per-job character binding makes is watchable at once: a woodcutter living its full loop (breathing
 * idle → walk → chop swing → hauling the visible log home), a woman in her own body, and the soldier
 * family in the armoured body (unarmed breathing, broadsword and longbow walk-holds — the "becomes a
 * warrior, the skin changes" join). The content uses the REAL job ids the binding tables key on
 * (woman 5, soldiers 31/35/41 — the `[jobbasegraphics]` join keys); the woodcutter uses a NON-mapped id
 * to prove every ordinary trade falls back to the generic man.
 *
 * The headless half proves the MECHANIC: the harvest→carry→deposit loop actually ran (wood physically
 * hauled into the HQ store — so the carrying state the human watches really occurred), and the
 * woman/soldier settlers are alive with their mapped jobs. The pixels (which body/animation draws) are
 * the human's checklist — an agent cannot self-judge them.
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

const { Building, Position, Resource, Settler, Stockpile } = components;

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
        workers: [{ jobType: WOODCUTTER, count: 1 }],
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
    atomicAnimations: [{ id: 'viking_chop', name: 'viking_chop', length: 16 }],
  });
}

/** Every placement, spread so each character reads separately at the default zoom. */
const HQ_AT = { x: 3, y: 3 };
const TREES = [
  { x: 11, y: 8 },
  { x: 12, y: 8 },
];
const CUTTER_AT = { x: 10, y: 8 };
const WOMAN_AT = { x: 6, y: 7 };
const SOLDIERS = [
  { x: 7, y: 4, jobType: SOLDIER_UNARMED },
  { x: 8, y: 4, jobType: SOLDIER_UNARMED },
  { x: 9, y: 4, jobType: SOLDIER_SWORD_LONG },
  { x: 10, y: 4, jobType: SOLDIER_BOW_LONG },
] as const;
/** Wood per tree — enough that the loop is still mid-haul whenever the human looks. */
const TREE_WOOD = 8;

function build(sim: Simulation): void {
  sim.enqueue({ kind: 'placeBuilding', buildingType: HEADQUARTERS, x: HQ_AT.x, y: HQ_AT.y, tribe: VIKING });
  sim.enqueue({ kind: 'spawnSettler', jobType: WOODCUTTER, x: CUTTER_AT.x, y: CUTTER_AT.y, tribe: VIKING });
  sim.enqueue({ kind: 'spawnSettler', jobType: WOMAN, x: WOMAN_AT.x, y: WOMAN_AT.y, tribe: VIKING });
  for (const s of SOLDIERS) {
    sim.enqueue({ kind: 'spawnSettler', jobType: s.jobType, x: s.x, y: s.y, tribe: VIKING });
  }
  // Wood nodes placed directly (the slice's pattern) — the harvest→carry→deposit loop's source.
  for (const cell of TREES) {
    const tree = sim.world.create();
    sim.world.add(tree, Position, { x: fx.fromInt(cell.x), y: fx.fromInt(cell.y) });
    sim.world.add(tree, Resource, { goodType: WOOD, remaining: TREE_WOOD, harvestAtomic: HARVEST_ATOMIC });
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

export const charactersScene: SceneDefinition = {
  id: 'characters',
  title: 'Postacie — animacja spięta ze stanem sima',
  summary:
    'Jeden świat, w którym widać każdy render-owy join stan→animacja: drwal przechodzi pełną pętlę ' +
    '(oddychający bezruch → marsz → zamach siekierą → niesie WIDOCZNĄ kłodę do magazynu), kobieta stoi ' +
    'we własnym ciele, a rodzina żołnierska nosi opancerzone ciało wojownika (job → skin). Zwykłe zawody ' +
    'rysują generycznego cywila; głowy różnią się per osobnik (stabilnie po id).',
  seed: 31,
  content: content(),
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  runTicks: 400,
  initialZoom: 1.2,
  checklist: [
    'Drwal (cywil): stojąc ODDYCHA (pętla idle, nie stopklatka), idzie pełnym krokiem, przy drzewie wykonuje zamach siekierą',
    'Po ścince drwal niesie WIDOCZNĄ kłodę do magazynu (inny chód niż z pustymi rękami) i odkłada ją',
    'Kobieta (lewa strona) ma własne ciało/suknię i własną pętlę oddychania — nie jest przebranym mężczyzną',
    'Czterej żołnierze mają opancerzone ciało wojownika: dwaj bez broni oddychają, jeden trzyma miecz dwuręczny, jeden łuk (postawa per broń)',
    'Dwaj żołnierze bez broni mają RÓŻNE głowy/hełmy (wariacja per osobnik), nikt na scenie nie zamarza w bezruchu',
  ],
  checks: [
    {
      label: 'the harvest→carry→deposit loop ran (wood physically hauled into the HQ store)',
      predicate: (sim) => hqWood(sim) > 0,
    },
    {
      label: 'the woman settler is alive with the woman job (the body-swap join key)',
      predicate: (sim) => settlersWithJob(sim, WOMAN) === 1,
    },
    {
      label: 'the soldier family is alive with its mapped jobs (unarmed ×2, broadsword, longbow)',
      predicate: (sim) =>
        settlersWithJob(sim, SOLDIER_UNARMED) === 2 &&
        settlersWithJob(sim, SOLDIER_SWORD_LONG) === 1 &&
        settlersWithJob(sim, SOLDIER_BOW_LONG) === 1,
    },
  ],
};
