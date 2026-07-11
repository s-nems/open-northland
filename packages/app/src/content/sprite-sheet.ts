import {
  SYNTHETIC_BINDINGS,
  type SettlerCharacter,
  type SettlerCharacterSet,
  type SettlerStateBinding,
  type SpriteLayer,
  type SpriteSheet,
  createSyntheticAtlasSource,
  syntheticAtlasFrames,
} from '@vinland/render';
import { ATTACK_ATOMIC, CULTIVATE_ATOMIC, PLANT_ATOMIC, WHEAT_HARVEST_ATOMIC } from '../catalog/atomics.js';
import {
  DEFAULT_CHARACTER_PALETTE,
  INDEXED_CHARACTER_PALETTE,
  VIKING_CHARACTERS,
  characterStem,
  characterStems,
} from '../catalog/roster.js';
import {
  BUILDING_FAMILIES,
  BUILDING_SCALE,
  DEFAULT_BUILDING_FAMILY,
  HOUSE_ATLAS,
  TREE_ATLAS,
  VIKING_TRIBE,
  buildingBobRefsByType,
  constructionRefsByType,
} from './building-gfx.js';
import { loadGoodsIconManifest } from './goods-gfx.js';
import {
  BODY_IMAGELIB,
  type ContentIr,
  MissingAtlasError,
  gfxAtomicFrameLists,
  loadGalleryLayers,
  loadIr,
  loadLayer,
  loadPlayerLut,
  sequencesFor,
} from './ir.js';
import {
  buildResourceBinding,
  buildStockpileBinding,
  buildStumpBinding,
  buildTrunkBinding,
  gatheringAtlasStems,
  resolveGatheringRefs,
  resolveStumpRef,
} from './resource-gfx.js';
import {
  ADULT_CHARACTER_BY_JOB,
  CHARACTER_SPEC_ENTRIES,
  type GoodRef,
  WARRIOR_SPEC_BY_WEAPON_GOOD,
  YOUNG_CHARACTER_BY_JOB,
  buildHumanBindings,
  carryHeadAnims,
  characterBinding,
} from './settler-gfx.js';

/**
 * Assemble the real decoded {@link SpriteSheet} from the loaded atlases + binding reducers — the
 * decoder/render-binding proof the plan gates on a human eye. It puts actual decoded `cr_hum_body_00`
 * + `cr_hum_head_00` pixels (plus the tree / per-building house bobs) on screen so a person can judge
 * palette / transparency / feet-anchor / animation fidelity against the original. Loads from the
 * GITIGNORED `content/` over the dev/shot vite server — no copyrighted bytes enter the repo; the
 * committed default degrades to {@link syntheticSpriteSheet} when `content/` is absent, so tests + the
 * reproducible shot are unaffected. The pure bindings live in {@link import('./settler-gfx.js')} /
 * {@link import('./building-gfx.js')}; the byte loading in {@link import('./ir.js')}.
 */

/** The decoded human body + head atlases (`test_human_00` palette) served at `/bobs/<name>.*`. */
const HUMAN_BODY_ATLAS = 'cr_hum_body_00.test_human_00';
const HUMAN_HEAD_ATLAS = 'cr_hum_head_00.test_human_00';

/**
 * The viking `[gfxanimatomic]` `logictribe` — `logicdefines.inc` `TRIBE_TYPE_HUMAN_VIKING = 1`. NOT the
 * tribetypes `logicType` (also 1 for viking, but 4 there is Saracen), and NOT a value to guess: the same
 * body bobseq name recurs across the human tribes with DIFFERENT per-direction frame lists, so the attack
 * swings must be drawn from THIS tribe's records (`gfxAtomicFrameLists`), else a soldier swings a
 * different tribe's motion. See the scoped-id gotcha in the root AGENTS.md.
 */
const VIKING_ANIM_TRIBE = 1;

/**
 * Load the per-job {@link SettlerCharacterSet}: every {@link import('./settler-gfx.js').CHARACTER_SPECS}
 * look whose body atlas AND sequences resolve, joined to jobs via
 * {@link import('./settler-gfx.js').ADULT_CHARACTER_BY_JOB} / `YOUNG_CHARACTER_BY_JOB`. Bodies are loaded
 * once per roster entry (the six soldier looks share one armoured body atlas); a head that 404s is skipped
 * (the look draws with fewer faces), a BODY that 404s or an unresolvable binding drops that look (its jobs
 * fall back to the default). Returns `undefined` — no characters, the sheet degrades to the single-body
 * legacy path — when the IR carries no sequences or the CIVILIAN look (the required default) can't be built.
 */
async function loadCharacters(
  ir: ContentIr | null,
  goods: readonly GoodRef[],
  palette: string,
): Promise<SettlerCharacterSet | undefined> {
  if (ir?.bobSequences === undefined || ir.bobSequences.length === 0) return undefined;

  const rosterById = new Map(VIKING_CHARACTERS.map((c) => [c.id, c]));
  // One load per roster body: its body layer (hard requirement per look) + its head layers (soft).
  const rosterIds = [...new Set(CHARACTER_SPEC_ENTRIES.map(([, s]) => s.rosterId))];
  const layersByRoster = new Map<string, { body: SpriteLayer; headsByStem: Map<string, SpriteLayer> }>();
  await Promise.all(
    rosterIds.map(async (rosterId) => {
      const character = rosterById.get(rosterId);
      if (character === undefined) return;
      const stems = characterStems(character, palette);
      try {
        const { body, heads } = await loadGalleryLayers(stems.bodyStem, stems.headStems);
        const headsByStem = new Map<string, SpriteLayer>();
        heads.forEach((layer, i) => {
          const stem = stems.headStems[i];
          if (layer !== undefined && stem !== undefined) headsByStem.set(stem, layer);
        });
        layersByRoster.set(rosterId, { body, headsByStem });
      } catch (err) {
        // An OPTIONAL look must never kill the boot: a missing body (MissingAtlasError) is the expected
        // undecoded-content case; any other failure (a corrupt manifest, a truncated PNG) is a real bug
        // — surface it loudly, but still degrade this look to the default instead of failing the whole
        // sheet. Strict propagation stays on the BASE sheet's own loads (loadHumanSpriteSheet).
        if (!(err instanceof MissingAtlasError)) {
          console.warn(`character look '${rosterId}' failed to load — falling back to the default look`, err);
        }
      }
    }),
  );

  // The viking directional attack frame lists (`[gfxanimatomic]` action-81), indexed by swing bobseq
  // name — the layout each warrior/civilian spec's `attack` seq becomes a FrameListAnim from. Built once
  // (not per spec); a spec whose seq is absent just has no attack animation.
  const attackFrameLists = gfxAtomicFrameLists(ir, VIKING_ANIM_TRIBE, ATTACK_ATOMIC);
  // The farmer's field-clip frame lists (the job-18 sow/water/reap `[gfxanimatomic]` records), keyed by
  // atomic id — what each spec's `dirListAtomics` becomes FrameListAnims from (the attack mechanism
  // generalized). Built once; an IR without them just leaves those actions on their fallback clips.
  const actionFrameLists = new Map(
    [WHEAT_HARVEST_ATOMIC, PLANT_ATOMIC, CULTIVATE_ATOMIC].map(
      (action) => [action, gfxAtomicFrameLists(ir, VIKING_ANIM_TRIBE, action)] as const,
    ),
  );

  const bySpec = new Map<string, SettlerCharacter>();
  for (const [specId, spec] of CHARACTER_SPEC_ENTRIES) {
    const layers = layersByRoster.get(spec.rosterId);
    const roster = rosterById.get(spec.rosterId);
    if (layers === undefined || roster === undefined) continue;
    const binding = characterBinding(
      spec,
      sequencesFor(ir, roster.imagelib),
      goods,
      attackFrameLists,
      actionFrameLists,
    );
    if (binding === null) continue;
    const heads = (spec.headBmds ?? roster.headBmds)
      .map((bmd) => layers.headsByStem.get(characterStem(bmd, palette)))
      .filter((l): l is SpriteLayer => l !== undefined);
    // Head-borrow: goods whose carry cycle ships empty head bobs resolve the HEAD through the base walk
    // instead (carryHeadAnims) — else a stone/grain hauler draws headless. All of a body's heads share
    // one bob layout, so checking the first head atlas stands for the set.
    const byGood = binding.carrying?.byGood;
    const headAtlas = heads[0]?.atlas;
    // The head-borrow reference is the plain walk (a uniform DirectionalAnim); moving is never the
    // explicit-frame-list kind (only the attack swing is), so exclude a FrameListAnim to keep the type.
    const moving = binding.moving;
    const walk = typeof moving === 'object' && !('frameLists' in moving) ? moving : undefined;
    let headBinding: SettlerStateBinding | undefined;
    if (byGood !== undefined && headAtlas !== undefined) {
      const headByGood = carryHeadAnims(byGood, walk, headAtlas);
      if (headByGood !== byGood) {
        headBinding = { ...binding, carrying: { ...binding.carrying, byGood: headByGood } };
      }
    }
    bySpec.set(specId, {
      body: layers.body,
      ...(heads.length > 0 ? { heads } : {}),
      binding,
      ...(headBinding !== undefined ? { headBinding } : {}),
    });
  }

  const fallback = bySpec.get('civilian');
  if (fallback === undefined) return undefined;
  const byJob: Record<number, SettlerCharacter> = {};
  for (const [job, specId] of Object.entries(ADULT_CHARACTER_BY_JOB)) {
    const char = bySpec.get(specId);
    if (char !== undefined) byJob[Number(job)] = char;
  }
  const youngByJob: Record<number, SettlerCharacter> = {};
  for (const [job, specId] of Object.entries(YOUNG_CHARACTER_BY_JOB)) {
    const char = bySpec.get(specId);
    if (char !== undefined) youngByJob[Number(job)] = char;
  }
  // The equipped-weapon look table: a warrior draws the body of the weapon in its Equipment.weapon slot.
  const byWeaponGood: Record<number, SettlerCharacter> = {};
  for (const [good, specId] of Object.entries(WARRIOR_SPEC_BY_WEAPON_GOOD)) {
    const char = bySpec.get(specId);
    if (char !== undefined) byWeaponGood[Number(good)] = char;
  }
  return { byJob, youngByJob, byWeaponGood, default: fallback };
}

/**
 * Load the gathering-economy family atlases (the rock/mine/mushroom node `.bmd`s, the `ls_goods` pile
 * skins, the `ls_temp` flag) named by the resolved gathering refs, BESIDE the building families. Each
 * loads best-effort: a {@link MissingAtlasError} (a partial `content/`) just drops that family — its
 * goods fall back to the yew node / placeholder heap, exactly the building-family degradation. Returns the
 * loaded layers keyed by served stem (= the `families` key a layer-qualified ref names) + the set of stems
 * that actually loaded (so the pure binding reducers emit a layer only for a family the GPU can draw).
 */
async function loadGatheringFamilies(
  stems: ReadonlySet<string>,
): Promise<{ families: Record<string, SpriteLayer>; loaded: Set<string> }> {
  const families: Record<string, SpriteLayer> = {};
  const loaded = new Set<string>();
  await Promise.all(
    [...stems].map(async (stem) => {
      try {
        families[stem] = await loadLayer(stem);
        loaded.add(stem);
      } catch (err) {
        if (!(err instanceof MissingAtlasError)) throw err; // a real decode bug still surfaces
      }
    }),
  );
  return { families, loaded };
}

/**
 * Load the real human {@link SpriteSheet}: the body layer as the base sheet, the head layer as an overlay
 * drawn on top at the same bob id, paired with bindings whose walk/chop ranges are read from the decoded
 * `bobSequences` (see {@link buildHumanBindings}). Together they compose a complete settler (body + head)
 * the renderer animates directionally per tick.
 */
export async function loadHumanSpriteSheet(goods: readonly GoodRef[] = []): Promise<SpriteSheet> {
  const [body, head, tree, house, familyEntries, ir] = await Promise.all([
    loadLayer(HUMAN_BODY_ATLAS),
    loadLayer(HUMAN_HEAD_ATLAS),
    loadLayer(TREE_ATLAS),
    loadLayer(HOUSE_ATLAS),
    Promise.all(BUILDING_FAMILIES.map(async (f) => [f.layer, await loadLayer(f.layer)] as const)),
    loadIr(),
  ]);
  // Player-colour LUT for TEAM COLOURS: if the pipeline emitted it (`/bobs/player-lut.png`), load the
  // characters as the recolourable INDEXED atlas and draw them through this LUT per player; if it is ABSENT
  // (a checkout whose pipeline predates the LUT stage), fall back to the baked-palette characters so the
  // real-graphics path still draws (just single-coloured). One indexed atlas + one LUT serve every player.
  const lut = await loadPlayerLut();
  const characterPalette = lut !== undefined ? INDEXED_CHARACTER_PALETTE : DEFAULT_CHARACTER_PALETTE;
  // Per-job characters (the `[jobbasegraphics]` join): built after the hard-required layers above so a
  // missing extra body degrades per look, never failing the sheet. `undefined` (no IR sequences / no
  // civilian look) keeps the legacy single-body settler path.
  const characters = await loadCharacters(ir, goods, characterPalette);
  // BUILDING_FAMILIES is the SINGLE SOURCE OF TRUTH for the named building families: each entry's atlas is
  // loaded here AND only its `layer` key is eligible for a layer-qualified ref from buildingBobRefsByType,
  // so the loaded set and the reducer's emitted set cannot drift (a ref to an unloaded family would fall
  // through to the default layer and draw a WRONG bob). All seven viking families load now (viking2/3/4 +
  // the miller/druid skins + the two house02 families), so EVERY viking building draws its own bob — see
  // BUILDING_FAMILIES.
  const buildingFamilies = Object.fromEntries(familyEntries);
  const houseBobs = buildingBobRefsByType(
    ir?.buildingBobs ?? [],
    VIKING_TRIBE,
    DEFAULT_BUILDING_FAMILY,
    BUILDING_FAMILIES,
  );
  // The construction-stage layers (the same `[GfxHouse]` records' `GfxBobConstructionLayer` rows),
  // reduced under the same family rules — an under-construction building draws its staged stack.
  const constructionRefs = constructionRefsByType(
    ir?.constructionLayers ?? [],
    VIKING_TRIBE,
    DEFAULT_BUILDING_FAMILY,
    BUILDING_FAMILIES,
  );
  // Gathering economy: resolve each RUN good's node/pile draw from the Step-1 pipeline join (matched by
  // id-slug), load the atlases they reference (rock/mine/mushroom nodes, `ls_goods` piles, the `ls_temp`
  // flag) as families, and build the per-good bindings against exactly the families that loaded — the same
  // load-then-drop-unloaded contract the building families use. The default yew node stays the
  // `kindLayers.resource` layer, so it is excluded from the loaded families.
  // The goods-icon manifest gives EVERY good (not just the gathered ones) its `ls_goods` pile graphic by
  // (frame, palette), so a dropped brick / sword / loaf draws its own heap instead of the placeholder marker.
  const goodIcons = await loadGoodsIconManifest();
  const gatheringRefs = resolveGatheringRefs(goods, ir, goodIcons);
  // The felled-tree stump/debris draws from `ls_trees_dead` — resolve its ref and load its atlas
  // ALONGSIDE the node/pile/flag families (same load-then-drop-unloaded contract).
  const stumpRef = resolveStumpRef(ir);
  const stems = gatheringAtlasStems(gatheringRefs);
  if (stumpRef !== undefined) stems.add(stumpRef.stem);
  const { families: gatheringFamilies, loaded: gatheringLoaded } = await loadGatheringFamilies(stems);
  const resourceBinding = buildResourceBinding(gatheringRefs, gatheringLoaded);
  const stockpileBinding = buildStockpileBinding(gatheringRefs, gatheringLoaded);
  const stumpBinding = buildStumpBinding(stumpRef, gatheringLoaded);
  // The freshly-felled trunk a GroundDrop draws (the `landscapeToPickup` stage), loaded alongside the
  // node/pile/flag families above (its stems are in `gatheringAtlasStems`).
  const trunkBinding = buildTrunkBinding(gatheringRefs, gatheringLoaded);
  // One family map: the building families + the gathering families. Their served stems are disjoint
  // (`ls_houses_*` vs `ls_ground`/`ls_goods`/`ls_temp`/`ls_mushrooms`), so the merge never collides.
  const families = { ...buildingFamilies, ...gatheringFamilies };
  return {
    source: body.source,
    atlas: body.atlas,
    bindings: buildHumanBindings(
      sequencesFor(ir, BODY_IMAGELIB),
      houseBobs,
      constructionRefs,
      resourceBinding,
      stockpileBinding,
      stumpBinding,
      trunkBinding,
    ),
    overlays: [head],
    // The tree and the DEFAULT building each draw from their OWN atlas (distinct id spaces), so they bind
    // as per-kind layers rather than sharing the body atlas the settler uses. A bare-id `resource` (the
    // default yew node) and a bare-id `building` resolve frames in THEIR respective layers.
    kindLayers: { resource: tree, building: house },
    // Named families (the multi-.bmd case) — a layer-qualified building/resource/stockpile binding draws
    // its bob from the matching family atlas here (its own frame-id space). A building family inherits the
    // building kind scale below unless it lists its own `familyScales` entry; resource/stockpile families
    // draw native (no kindScale entry).
    families,
    // The native house bobs are oversized next to the settler; shrink only the building (tree + settler
    // stay native — their proportion already reads right). Named families inherit this. See BUILDING_SCALE.
    kindScales: { building: BUILDING_SCALE },
    // Per-job settler looks (woman / soldier family / children via Age) — the sim-state → skin join.
    ...(characters !== undefined ? { characters } : {}),
    // Team-colour LUT: present ⇒ characters are the indexed atlas and the pool paints each per its player
    // (SpritePool's PalettedSprite path); absent ⇒ the baked characters draw as plain sprites, as before.
    ...(lut !== undefined ? { palette: { source: lut, colours: lut.pixelHeight } } : {}),
  };
}

/** The reproducible synthetic atlas (flat-coloured markers, no copyrighted data) — the graceful fallback,
 *  also the `?shot`/`?atlas=synthetic` sheet (shared with `entries/shot.ts` so the two can't drift). */
export function syntheticSpriteSheet(): SpriteSheet {
  return {
    source: createSyntheticAtlasSource(),
    atlas: syntheticAtlasFrames(),
    bindings: SYNTHETIC_BINDINGS,
  };
}

/**
 * Resolve the sprite sheet for the `?atlas` flag — the single answer shared by the map (`entries/map.ts`)
 * and scene (`entries/scene.ts`) entries so both honour it identically. **Real decoded graphics are the
 * DEFAULT** (we always want to see the real thing): absent OR `?atlas=real` → the decoded atlases, degrading
 * to the synthetic marker atlas when `content/` is missing (a checkout without decoded bytes must still
 * boot). Explicit opt-outs: `?atlas=synthetic` (or `=1`/`=true`/empty) → the synthetic markers; `?atlas=none`
 * (or `=off`) → `undefined`, so sprites draw as placeholder geometry. NOTE: the reproducible `?shot` entry
 * does NOT use this — it keeps its own content-free default so the committed screenshot never depends on
 * gitignored bytes.
 */
export async function resolveSpriteSheet(
  params: URLSearchParams,
  /** The goods of the content set the sim will RUN (demo/scene) — keys the per-good carry looks; the
   *  ids are content-relative numbers, so only the entry that builds the sim knows them. */
  goods: readonly GoodRef[] = [],
): Promise<SpriteSheet | undefined> {
  const atlas = params.get('atlas');
  if (atlas === 'synthetic' || atlas === '1' || atlas === 'true' || atlas === '') {
    return syntheticSpriteSheet();
  }
  if (atlas === 'none' || atlas === 'off') return undefined;
  // Default (absent) and `?atlas=real`: draw real decoded graphics, falling back to synthetic markers ONLY
  // when the decoded atlases aren't present (a checkout without content/). A MissingAtlasError is that
  // expected precondition; any other error is a real bug and propagates rather than being masked as markers.
  try {
    return await loadHumanSpriteSheet(goods);
  } catch (err) {
    if (!(err instanceof MissingAtlasError)) throw err;
    console.warn('real atlas unavailable (is content/ populated?) — falling back to synthetic markers', err);
    return syntheticSpriteSheet();
  }
}
