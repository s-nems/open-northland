import type { SpriteLayer, SpriteSheet } from '@open-northland/render';
import { DEFAULT_CHARACTER_PALETTE, INDEXED_CHARACTER_PALETTE } from '../../catalog/roster.js';
import {
  BUILDING_FAMILIES,
  BUILDING_SCALE,
  buildingBobRefsByType,
  buildingOverlayRefsByType,
  constructionRefsByType,
  DEFAULT_BUILDING_FAMILY,
  HOUSE_ATLAS,
  TREE_ATLAS,
  VIKING_TRIBE,
} from '../building-gfx/index.js';
import { loadGoodsIconManifest } from '../goods-gfx.js';
import {
  BODY_IMAGELIB,
  type ContentIr,
  loadIr,
  loadLayer,
  loadPlayerLut,
  MissingAtlasError,
  sequencesFor,
  servedAtlasStem,
  servedShadowStem,
} from '../ir.js';
import {
  berryBushAtlasStems,
  buildBerryBushBinding,
  buildResourceBinding,
  buildStockpileBinding,
  buildStumpBinding,
  buildTrunkBinding,
  gatheringAtlasStems,
  resolveBerryBushRefs,
  resolveGatheringRefs,
  resolveStumpRef,
} from '../resource-gfx/index.js';
import { buildHumanBindings, type GoodRef } from '../settler-gfx/index.js';
import { loadCharacters } from './characters.js';

/**
 * Assemble the real decoded {@link SpriteSheet} from the loaded atlases + binding reducers — the
 * decoder/render-binding proof a human eye validates: actual decoded `cr_hum_body_00` + `cr_hum_head_00`
 * pixels (plus the tree / per-building house bobs) on screen so a person can judge palette / transparency /
 * feet-anchor / animation fidelity against the original. Loads from the gitignored `content/` over the
 * dev/shot vite server — no copyrighted bytes enter the repo; the committed default degrades to
 * {@link import('./resolve.js').syntheticSpriteSheet} when `content/` is absent, so tests + the
 * reproducible shot are unaffected. The pure bindings live in
 * {@link import('../settler-gfx/index.js')} / {@link import('../building-gfx/index.js')}; the byte loading
 * in {@link import('../ir.js')}; the per-job character join in {@link import('./characters.js')}.
 */

/** The decoded human body + head atlases (`test_human_00` palette) served at `/bobs/<name>.*`. */
const HUMAN_BODY_ATLAS = 'cr_hum_body_00.test_human_00';
const HUMAN_HEAD_ATLAS = 'cr_hum_head_00.test_human_00';

/**
 * Load the gathering-economy family atlases (the rock/mine/mushroom node `.bmd`s, the `ls_goods` pile
 * skins, the `ls_temp` flag) named by the resolved gathering refs, beside the building families. Each
 * loads best-effort: a {@link MissingAtlasError} (a partial `content/`) just drops that family — its
 * goods fall back to the yew node / placeholder heap, exactly the building-family degradation. Returns the
 * loaded layers keyed by served stem (= the `families` key a layer-qualified ref names) + the set of stems
 * that actually loaded (so the pure binding reducers emit a layer only for a family the GPU can draw).
 */
async function loadGatheringFamilies(
  stems: ReadonlySet<string>,
  shadowStems: ReadonlyMap<string, string>,
): Promise<{ families: Record<string, SpriteLayer>; loaded: Set<string> }> {
  const families: Record<string, SpriteLayer> = {};
  const loaded = new Set<string>();
  await Promise.all(
    [...stems].map(async (stem) => {
      try {
        families[stem] = await loadLayer(stem, shadowStems.get(stem));
        loaded.add(stem);
      } catch (err) {
        if (!(err instanceof MissingAtlasError)) throw err; // a real decode bug still surfaces
      }
    }),
  );
  return { families, loaded };
}

/**
 * The served body-atlas stem → shadow-atlas stem join, from every IR row pairing a body `.bmd` with a
 * shadow `.bmd` (`GfxBobLibs` second value): the landscape records (trees, stones, flags) and the
 * `[GfxHouse]` building rows. Loading a body layer with its entry attaches the shadow twin the resolve
 * step draws under each bob ({@link import('@open-northland/render').SpriteLayer.shadow}). First-wins on
 * a repeated stem — the recolours of one `.bmd` share its single shadow set.
 */
function shadowStemsByAtlasStem(ir: ContentIr | null): Map<string, string> {
  const map = new Map<string, string>();
  const put = (stem: string | undefined, shadowBmd: string | undefined): void => {
    const shadowStem = servedShadowStem(shadowBmd);
    if (stem !== undefined && shadowStem !== undefined && !map.has(stem)) map.set(stem, shadowStem);
  };
  for (const row of ir?.landscapeGfx ?? []) put(servedAtlasStem(row), row.shadowBmd);
  for (const row of ir?.buildingBobs ?? []) put(servedAtlasStem(row), row.shadowBmd);
  return map;
}

/**
 * Load the real human {@link SpriteSheet}: the body layer as the base sheet, the head layer as an overlay
 * drawn on top at the same bob id, paired with bindings whose walk/chop ranges are read from the decoded
 * `bobSequences` (see {@link buildHumanBindings}). Together they compose a complete settler (body + head)
 * the renderer animates directionally per tick.
 */
export async function loadHumanSpriteSheet(goods: readonly GoodRef[] = []): Promise<SpriteSheet> {
  // The character body/head atlases need no shadow twin (settlers draw shadow-less by design), so
  // their fetches start before the IR await; the tree/house/family loads wait for the IR's (memoized)
  // body-stem → shadow-stem join to attach each atlas's cast-shadow twin.
  const bodyLoad = loadLayer(HUMAN_BODY_ATLAS);
  const headLoad = loadLayer(HUMAN_HEAD_ATLAS);
  // A rejection (absent content/) must wait for the Promise.all below, not surface as unhandled
  // while the IR await is still pending.
  bodyLoad.catch(() => undefined);
  headLoad.catch(() => undefined);
  const ir = await loadIr();
  const shadowStems = shadowStemsByAtlasStem(ir);
  const [body, head, tree, house, familyEntries] = await Promise.all([
    bodyLoad,
    headLoad,
    loadLayer(TREE_ATLAS, shadowStems.get(TREE_ATLAS)),
    loadLayer(HOUSE_ATLAS, shadowStems.get(HOUSE_ATLAS)),
    Promise.all(
      BUILDING_FAMILIES.map(
        async (f) => [f.layer, await loadLayer(f.layer, shadowStems.get(f.layer))] as const,
      ),
    ),
  ]);
  // Player-colour LUT for team colours: if the pipeline emitted it (`/bobs/player-lut.png`), load the
  // characters as the recolourable indexed atlas and draw them through this LUT per player; if it is absent
  // (a checkout whose pipeline predates the LUT stage), fall back to the baked-palette characters so the
  // real-graphics path still draws (just single-coloured). One indexed atlas + one LUT serve every player.
  const lut = await loadPlayerLut();
  const characterPalette = lut !== undefined ? INDEXED_CHARACTER_PALETTE : DEFAULT_CHARACTER_PALETTE;
  // Per-job characters (the `[jobbasegraphics]` join): built after the hard-required layers above so a
  // missing extra body degrades per look, never failing the sheet. `undefined` (no IR sequences / no
  // civilian look) keeps the legacy single-body settler path.
  const characters = await loadCharacters(ir, goods, characterPalette);
  // BUILDING_FAMILIES is the single source of truth for the named building families: each entry's atlas is
  // loaded here and only its `layer` key is eligible for a layer-qualified ref from buildingBobRefsByType,
  // so the loaded set and the reducer's emitted set cannot drift (a ref to an unloaded family would fall
  // through to the default layer and draw a wrong bob).
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
  // The animated state overlays (the type-4 `GfxOverlay` rows — the mill's rotor over its bladeless
  // body), reduced under the same family rules. Empty when the IR predates the lane.
  const overlayRefs = buildingOverlayRefsByType(
    ir?.buildingOverlays ?? [],
    VIKING_TRIBE,
    DEFAULT_BUILDING_FAMILY,
    BUILDING_FAMILIES,
  );
  // Gathering economy: resolve each run good's node/pile draw from the Step-1 pipeline join (matched by
  // id-slug), load the atlases they reference (rock/mine/mushroom nodes, `ls_goods` piles, the `ls_temp`
  // flag) as families, and build the per-good bindings against exactly the families that loaded — the same
  // load-then-drop-unloaded contract the building families use. The default yew node stays the
  // `kindLayers.resource` layer, so it is excluded from the loaded families.
  // The goods-icon manifest gives every good (not just the gathered ones) its `ls_goods` pile graphic by
  // (frame, palette), so a dropped brick / sword / loaf draws its own heap instead of the placeholder marker.
  const goodIcons = await loadGoodsIconManifest();
  const gatheringRefs = resolveGatheringRefs(goods, ir, goodIcons);
  // The felled-tree stump/debris draws from `ls_trees_dead` — resolve its ref and load its atlas
  // alongside the node/pile/flag families (same load-then-drop-unloaded contract).
  const stumpRef = resolveStumpRef(ir);
  // Forageable berry bushes (fruited + bare states) draw from the `ls_trees` bush atlases — resolve their
  // refs and fold their stems into the loaded families alongside the node/pile/flag/stump ones.
  const berryBushRefs = resolveBerryBushRefs(ir);
  const stems = gatheringAtlasStems(gatheringRefs);
  if (stumpRef !== undefined) stems.add(stumpRef.stem);
  for (const s of berryBushAtlasStems(berryBushRefs)) stems.add(s);
  const { families: gatheringFamilies, loaded: gatheringLoaded } = await loadGatheringFamilies(
    stems,
    shadowStems,
  );
  // The frame ids each loaded family atlas actually holds — lets the node reducer mark a level whose bob
  // the source record points outside its own atlas (the original's "invisible state" sentinel — freshly-
  // sown wheat) as a draw-nothing level instead of a placeholder. See buildResourceBinding.
  const familyFrames = new Map(
    Object.entries(gatheringFamilies).map(
      ([stem, layer]) => [stem, new Set(layer.atlas.frames.keys())] as const,
    ),
  );
  const resourceBinding = buildResourceBinding(gatheringRefs, gatheringLoaded, familyFrames);
  const stockpileBinding = buildStockpileBinding(gatheringRefs, gatheringLoaded);
  const stumpBinding = buildStumpBinding(stumpRef, gatheringLoaded);
  const berryBushBinding = buildBerryBushBinding(berryBushRefs, gatheringLoaded);
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
      berryBushBinding,
      overlayRefs,
    ),
    overlays: [head],
    // The tree and the default building each draw from their own atlas (distinct id spaces), so they bind
    // as per-kind layers rather than sharing the body atlas the settler uses. A bare-id `resource` (the
    // default yew node) and a bare-id `building` resolve frames in their respective layers.
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
    // (SpritePool's PalettedSprite path); absent ⇒ the baked characters draw as plain sprites.
    ...(lut !== undefined ? { palette: { source: lut, colours: lut.pixelHeight } } : {}),
  };
}
