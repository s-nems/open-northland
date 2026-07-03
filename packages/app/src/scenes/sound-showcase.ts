import { IR_VERSION, parseContentSet } from '@vinland/data';
import { type Simulation, components, fx } from '@vinland/sim';
import { GRASS, VIKING, grassTerrain } from '../catalog/buildings.js';
import { HARVEST_ATOMIC } from '../content/settler-gfx.js';
import type { SceneDefinition } from './types.js';

/**
 * Acceptance scene: **sound follows the action** — a ring of woodcutters chopping inexhaustible trees
 * around a central store, so the decoded axe SFX (`Woodcutter Axe`) fires on EVERY chop swing, right in
 * frame. This is the "drwal walnie w drzewo → słyszę dźwięk" demo: audio is wired to sim EVENTS (each
 * `harvest` atomic completing emits `atomicCompleted`, which the audio layer positions + plays), not to a
 * random murmur. Because the chop is spatial, panning the camera moves it in the stereo field and pushing
 * it off screen silences it — the culling the user asked for, audible.
 *
 * Unlike the live slice (two 4-unit trees that empty in seconds), the nodes here are effectively
 * inexhaustible, so the chopping — and its sound — never stops: a reliable, repeatable thing to listen to.
 *
 * The headless half proves the MECHANIC the sound rides on (nodes were harvested and the wood reached the
 * store) — an agent can't judge audio, so the browser half is where a human confirms the axe actually
 * sounds and tracks the chopper. Content is SYNTHETIC (zod-validated), mirroring the vertical slice's
 * proven wood chain. Turn sound OFF with `?scene=sound-showcase&sound=off`.
 */

const NONE_GOOD = 0;
const WOOD = 1;
/** A civilian-trade `jobType` (not the woman/soldier ids) — draws the generic man body, which chops. */
const WOODCUTTER = 1;
/** The central store (headquarters) the choppers deposit into — the sink that keeps the loop turning. */
const STORE = 1;

const GRID = 24;
const CENTER = { x: 12, y: 12 };
/** Effectively inexhaustible nodes, so the chopping (and its axe SFX) runs for the whole scene. */
const TREE_REMAINING = 100_000;
/** Store capacity above any plausible deposit total, so a full store never stalls the harvest loop. */
const STORE_CAPACITY = 1_000_000;

/** The chopper/tree cluster around the store — spread so each stands clear of the store body, all in frame. */
const CHOP_SPOTS: readonly { readonly x: number; readonly y: number }[] = [
  { x: 8, y: 12 },
  { x: 16, y: 12 },
  { x: 12, y: 8 },
  { x: 12, y: 16 },
  { x: 9, y: 9 },
  { x: 15, y: 15 },
  { x: 9, y: 15 },
  { x: 15, y: 9 },
];

function soundShowcaseContent() {
  return parseContentSet({
    manifest: { version: IR_VERSION, generatedFrom: { game: 'vinland-acceptance-scene' }, locale: 'eng' },
    goods: [
      { typeId: NONE_GOOD, id: 'none' },
      { typeId: WOOD, id: 'wood', weight: 1, atomics: { harvest: HARVEST_ATOMIC } },
    ],
    jobs: [
      { typeId: 0, id: 'idle' },
      { typeId: WOODCUTTER, id: 'woodcutter', allowedAtomics: [HARVEST_ATOMIC] },
    ],
    buildings: [
      {
        // A pure store: a stockpile the choppers deposit their harvested wood into. No `workers` so the
        // choppers are never lured off their trees to STAFF it — they only harvest → haul → deposit → repeat.
        typeId: STORE,
        id: 'headquarters',
        kind: 'headquarters',
        stock: [{ goodType: WOOD, capacity: STORE_CAPACITY, initial: 0 }],
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
    // The woodcut swing animation (the render plays it off the atomic's `elapsed`), same as the slice.
    atomicAnimations: [{ id: 'viking_chop', name: 'viking_chop', length: 16 }],
  });
}

function build(sim: Simulation): void {
  sim.enqueue({ kind: 'placeBuilding', buildingType: STORE, x: CENTER.x, y: CENTER.y, tribe: VIKING });
  for (const s of CHOP_SPOTS) {
    // A tree node the chopper stands on, so it starts harvesting at once (mirrors the slice's node setup).
    const tree = sim.world.create();
    sim.world.add(tree, components.Position, { x: fx.fromInt(s.x), y: fx.fromInt(s.y) });
    sim.world.add(tree, components.Resource, {
      goodType: WOOD,
      remaining: TREE_REMAINING,
      harvestAtomic: HARVEST_ATOMIC,
    });
    sim.enqueue({ kind: 'spawnSettler', jobType: WOODCUTTER, x: s.x, y: s.y, tribe: VIKING });
  }
}

/** Total units harvested so far = how far the nodes have been drawn down from their inexhaustible start. */
function totalHarvested(sim: Simulation): number {
  let harvested = 0;
  for (const e of sim.world.query(components.Resource)) {
    harvested += TREE_REMAINING - sim.world.get(e, components.Resource).remaining;
  }
  return harvested;
}

/** Wood accumulated in any store — proof the harvested load completed the harvest→haul→deposit loop. */
function woodInStores(sim: Simulation): number {
  let total = 0;
  for (const e of sim.world.query(components.Building)) {
    const stock = sim.world.tryGet(e, components.Stockpile);
    if (stock !== undefined) total += stock.amounts.get(WOOD) ?? 0;
  }
  return total;
}

// Enough ticks for the choppers to harvest and complete a deposit or two at the sim's slow walk pace.
const RUN_TICKS = 700;

export const soundShowcaseScene: SceneDefinition = {
  id: 'sound-showcase',
  title: 'Dźwięk podąża za akcją — drwale rąbią drzewa',
  summary:
    'Krąg drwali rąbie niewyczerpalne drzewa wokół składu na środku — przy KAŻDYM uderzeniu siekierą ' +
    'odzywa się oryginalny dźwięk „Woodcutter Axe”, dokładnie tam, gdzie pada cios. Dźwięk jest podpięty ' +
    'pod ZDARZENIA symulacji (nie losowy gwar). Przesuń kamerę: rąbanie przesuwa się w stereo, a poza ' +
    'kadrem cichnie (culling). Włącz dźwięk klikając w okno; wyłącz przez ?sound=off.',
  seed: 24,
  content: soundShowcaseContent(),
  terrain: grassTerrain(GRID, GRID),
  build,
  runTicks: RUN_TICKS,
  initialZoom: 1.3,
  checklist: [
    'Po kliknięciu w okno (odblokowanie audio) słychać rąbanie siekierą przy każdym cięciu drwala',
    'Dźwięk siekiery dobiega z miejsca, gdzie stoi rąbiący drwal (nie z całego ekranu)',
    'Przewijanie kamery przesuwa dźwięk w stereo (lewo/prawo); drwal poza kadrem milknie',
    'To NIE losowy gwar — cichy gwar tłumu (męskie głosy) może być w tle, ale wyraźnie słychać właśnie rąbanie',
    'Głosy drwali są męskie (pasują do tego, kogo widać) — nie kobiece ani dziecięce',
  ],
  checks: [
    {
      label: 'the woodcutters harvested wood from the nodes (chops fired the harvest atomic)',
      predicate: (sim) => totalHarvested(sim) > 0,
    },
    {
      label: 'the harvested wood completed the loop into the store',
      predicate: (sim) => woodInStores(sim) > 0,
    },
  ],
};
