import type { SpriteLayer, SpriteSheet } from '@open-northland/render';
import {
  DEFAULT_CHARACTER_PALETTE,
  INDEXED_CHARACTER_PALETTE,
  PLAYER_COLOR_COUNT,
} from '../../catalog/roster.js';
import { loadAnimalCharacters } from '../animal-gfx/index.js';
import {
  BUILDING_FAMILIES,
  BUILDING_SCALE,
  buildingBobRefsByType,
  buildingOverlayRefsByType,
  constructionRefsByType,
  DEFAULT_BUILDING_FAMILY,
  HOUSE_ATLAS,
  TREE_ATLAS,
  upgradeRefsByType,
  VIKING_TRIBE,
} from '../building-gfx/index.js';
import { loadGoodsIconManifest } from '../goods-gfx.js';
import { inHouseProgramLookup, sequencesFor, servedAtlasStem, servedShadowStem } from '../ir/joins.js';
import { loadIr, loadLayer, loadPlayerLut, MissingAtlasError } from '../ir/load.js';
import { BODY_IMAGELIB, type ContentIr } from '../ir/rows.js';
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

// Assemble the real decoded SpriteSheet from the loaded atlases and binding reducers. Loads from the
// gitignored `content/` over the dev/shot vite server.

/** The decoded human body + head atlases (`test_human_00` palette) served at `/bobs/<name>.*`. */
const HUMAN_BODY_ATLAS = 'cr_hum_body_00.test_human_00';
const HUMAN_HEAD_ATLAS = 'cr_hum_head_00.test_human_00';

/** The scout's guidepost atlases: bob 0 the post, bobs 1..18 the direction board in ~20° angular steps
 *  around the post top. Each owner draws its own `ls_guidepost.player_NN` bake, baked rather than
 *  indexed+LUT so the bob's graded edge alpha survives; the `bridge01` bake is the single-colour
 *  fallback. */
const GUIDEPOST_ATLAS_BAKED = 'ls_guidepost.bridge01';
const guidepostPlayerAtlas = (player: number): string =>
  `ls_guidepost.player_${String(player).padStart(2, '0')}`;
const GUIDEPOST_POST_BOB = 0;
const GUIDEPOST_BOARD_BOBS = Array.from({ length: 18 }, (_, i) => i + 1);

/**
 * Load the gathering-economy family atlases named by the resolved gathering refs. Each loads best-effort: a
 * {@link MissingAtlasError} just drops that family, and its goods fall back to the yew node or placeholder
 * heap. The returned `loaded` set is what lets a reducer emit a layer only for a family the GPU can draw.
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
 * shadow `.bmd` (`GfxBobLibs` second value). Loading a body layer with its entry attaches the shadow twin
 * drawn under each bob. First-wins on a repeated stem: the recolours of one `.bmd` share its shadow set.
 */
export function shadowStemsByAtlasStem(ir: ContentIr | null): Map<string, string> {
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
 * drawn on top at the same bob id.
 */
export async function loadHumanSpriteSheet(goods: readonly GoodRef[] = []): Promise<SpriteSheet> {
  // Settlers draw shadow-less, so the body/head fetches start before the IR await; the tree/house/family
  // loads wait for the IR's body-stem → shadow-stem join to attach each atlas's cast-shadow twin.
  const bodyLoad = loadLayer(HUMAN_BODY_ATLAS);
  const headLoad = loadLayer(HUMAN_HEAD_ATLAS);
  // Keep an absent-content rejection from surfacing as unhandled while the IR await is still pending.
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
  // Player-colour LUT: when the pipeline emitted `/bobs/player-lut.png` the characters load as the
  // recolourable indexed atlas drawn through it per player; without it they fall back to the baked-palette
  // characters and draw single-coloured. One indexed atlas plus one LUT serve every player.
  const lut = await loadPlayerLut();
  const characterPalette = lut !== undefined ? INDEXED_CHARACTER_PALETTE : DEFAULT_CHARACTER_PALETTE;
  // Per-job characters (the `[jobbasegraphics]` join): a missing extra body degrades per look, never
  // failing the sheet, and `undefined` keeps the legacy single-body settler path. The wildlife looks have
  // no resolution path without the human characters, so they attach only when that set built.
  const [humanCharacters, animalCharacters] = await Promise.all([
    loadCharacters(ir, goods, characterPalette),
    loadAnimalCharacters(ir),
  ]);
  const characters =
    humanCharacters !== undefined && animalCharacters !== undefined
      ? { ...humanCharacters, animals: animalCharacters }
      : humanCharacters;
  // Loading exactly the BUILDING_FAMILIES entries keeps the loaded set and the reducer's emitted set from
  // drifting: a ref to an unloaded family would fall through to the default layer and draw a wrong bob.
  const buildingFamilies = Object.fromEntries(familyEntries);
  const houseBobs = buildingBobRefsByType(
    ir?.buildingBobs ?? [],
    VIKING_TRIBE,
    DEFAULT_BUILDING_FAMILY,
    BUILDING_FAMILIES,
  );
  const constructionRefs = constructionRefsByType(
    ir?.constructionLayers ?? [],
    VIKING_TRIBE,
    DEFAULT_BUILDING_FAMILY,
    BUILDING_FAMILIES,
  );
  const upgradeRefs = upgradeRefsByType(
    ir?.constructionLayers ?? [],
    VIKING_TRIBE,
    DEFAULT_BUILDING_FAMILY,
    BUILDING_FAMILIES,
  );
  // Empty when the IR predates the `GfxOverlay` lane.
  const overlayRefs = buildingOverlayRefsByType(
    ir?.buildingOverlays ?? [],
    VIKING_TRIBE,
    DEFAULT_BUILDING_FAMILY,
    BUILDING_FAMILIES,
  );
  // Gathering economy: the per-good bindings are built against exactly the families that loaded, the same
  // load-then-drop-unloaded contract the building families use. The default yew node stays the
  // `kindLayers.resource` layer, so it is excluded from the loaded families.
  const goodIcons = await loadGoodsIconManifest();
  const gatheringRefs = resolveGatheringRefs(goods, ir, goodIcons);
  const stumpRef = resolveStumpRef(ir);
  const berryBushRefs = resolveBerryBushRefs(ir);
  const stems = gatheringAtlasStems(gatheringRefs);
  if (stumpRef !== undefined) stems.add(stumpRef.stem);
  for (const s of berryBushAtlasStems(berryBushRefs)) stems.add(s);
  // The signpost families ride the same contract: every per-player bake plus the single-colour fallback.
  stems.add(GUIDEPOST_ATLAS_BAKED);
  for (let p = 0; p < PLAYER_COLOR_COUNT; p++) stems.add(guidepostPlayerAtlas(p));
  const { families: gatheringFamilies, loaded: gatheringLoaded } = await loadGatheringFamilies(
    stems,
    shadowStems,
  );
  // The frame ids each loaded family atlas actually holds, so the node reducer can mark a level whose bob
  // points outside its own atlas (the original's invisible-state sentinel, freshly-sown wheat) as a
  // draw-nothing level instead of a placeholder.
  const familyFrames = new Map(
    Object.entries(gatheringFamilies).map(
      ([stem, layer]) => [stem, new Set(layer.atlas.frames.keys())] as const,
    ),
  );
  const resourceBinding = buildResourceBinding(gatheringRefs, gatheringLoaded, familyFrames);
  const stockpileBinding = buildStockpileBinding(gatheringRefs, gatheringLoaded);
  const stumpBinding = buildStumpBinding(stumpRef, gatheringLoaded);
  const berryBushBinding = buildBerryBushBinding(berryBushRefs, gatheringLoaded);
  const trunkBinding = buildTrunkBinding(gatheringRefs, gatheringLoaded);
  // The building and gathering families merge into one map: their served stems are disjoint (`ls_houses_*`
  // vs `ls_ground`/`ls_goods`/`ls_temp`/`ls_mushrooms`), so the merge never collides.
  const families = { ...buildingFamilies, ...gatheringFamilies };
  const guidepostFrames = (layer: string) => ({
    post: { layer, bob: GUIDEPOST_POST_BOB },
    boards: GUIDEPOST_BOARD_BOBS.map((bob) => ({ layer, bob })),
  });
  const guidepostPlayerLayers = Array.from({ length: PLAYER_COLOR_COUNT }, (_, p) => {
    const stem = guidepostPlayerAtlas(p);
    return gatheringLoaded.has(stem) ? stem : undefined;
  });
  // The base frames come from player 0's bake, else the single-colour fallback.
  const guidepostBaseLayer =
    guidepostPlayerLayers[0] ??
    (gatheringLoaded.has(GUIDEPOST_ATLAS_BAKED) ? GUIDEPOST_ATLAS_BAKED : undefined);
  const signpostBinding =
    guidepostBaseLayer !== undefined
      ? {
          signpost: {
            ...guidepostFrames(guidepostBaseLayer),
            byPlayer: guidepostPlayerLayers.map((l) => (l === undefined ? undefined : guidepostFrames(l))),
          },
        }
      : {};
  return {
    source: body.source,
    atlas: body.atlas,
    bindings: {
      ...buildHumanBindings(
        sequencesFor(ir, BODY_IMAGELIB),
        houseBobs,
        constructionRefs,
        resourceBinding,
        stockpileBinding,
        stumpBinding,
        trunkBinding,
        berryBushBinding,
        overlayRefs,
        upgradeRefs,
      ),
      ...signpostBinding,
    },
    overlays: [head],
    // The tree and the default building each draw from their own atlas (distinct id spaces), so they bind
    // as per-kind layers rather than sharing the body atlas the settler uses.
    kindLayers: { resource: tree, building: house },
    // Named families (the multi-.bmd case) - a layer-qualified binding draws its bob from the matching
    // family atlas here, in its own frame-id space. A building family inherits the building kind scale
    // below; resource/stockpile families draw native.
    families,
    kindScales: { building: BUILDING_SCALE },
    // What a worker performs inside its workplace; an unchoreographed trade stays hidden in there.
    inHousePrograms: inHouseProgramLookup(ir, goods),
    ...(characters !== undefined ? { characters } : {}),
    // Team-colour LUT: present ⇒ the characters are the indexed atlas and the pool paints each per its
    // player; absent ⇒ the baked characters draw as plain sprites. The armor recolor axis rides along.
    ...(lut !== undefined
      ? {
          palette: {
            source: lut,
            colours: lut.pixelHeight,
            playerRows: PLAYER_COLOR_COUNT,
            armorTierByGood: armorTiersByGood(ir),
          },
        }
      : {}),
  };
}

/** The worn-armor recolor join: armor `goodType` → its `typeId` (the `TArmorType` tier, the LUT's
 *  row-block index). Empty for synthetic content (no `armor` lane), which draws plain player rows. */
function armorTiersByGood(ir: ContentIr | null): ReadonlyMap<number, number> {
  const byGood = new Map<number, number>();
  for (const record of ir?.armor ?? []) {
    if (typeof record.goodType !== 'number' || typeof record.typeId !== 'number') continue;
    if (!byGood.has(record.goodType)) byGood.set(record.goodType, record.typeId);
  }
  return byGood;
}
