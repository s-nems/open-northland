import type { SpriteLayer, TextureSource } from '@open-northland/render';
import { Rectangle, Texture } from 'pixi.js';
import {
  BUILDING_FAMILIES,
  buildingBobRefsByType,
  DEFAULT_BUILDING_FAMILY,
  HOUSE_ATLAS,
  VIKING_TRIBE,
} from '../../content/building-gfx/index.js';
import { type GoodsArt, loadGoodsArt } from '../../content/goods-gfx.js';
import { type GuiArt, loadGuiArt } from '../../content/gui-art.js';
import {
  type GuiBarRamp,
  type GuiStrings,
  loadGuiBarRamp,
  loadGuiBitmap,
  loadGuiStrings,
} from '../../content/gui-gfx.js';
import { loadIr, loadLayer, MissingAtlasError } from '../../content/ir/load.js';
import { loadUiFont, type UiFont } from '../../content/ui-font.js';

/**
 * The details panel's mount-time assets; every piece except the font degrades to `null`/`undefined`/empty
 * without `content/`. Textures are minted once here because a `Texture` pins a resize listener on its
 * shared `TextureSource`, so minting one per rebuild would leak those wrappers.
 */

/** The original window/button fills from `Data/gui/bitmaps/bg*.pcx` (300×300 texture tiles). */
export interface GuiBitmapSet {
  readonly bg: Texture | undefined;
  readonly card: Texture | undefined;
  readonly button: Texture | undefined;
  readonly buttonHilite: Texture | undefined;
  readonly headline: Texture | undefined;
}

async function loadGuiBitmaps(): Promise<GuiBitmapSet> {
  const toTexture = (source: TextureSource | undefined): Texture | undefined =>
    source === undefined ? undefined : new Texture({ source });
  const [bg, card, button, buttonHilite, headline] = await Promise.all([
    loadGuiBitmap('bg'),
    loadGuiBitmap('bg_selected'),
    loadGuiBitmap('bg_button'),
    loadGuiBitmap('bg_button_hilite'),
    loadGuiBitmap('bg_headline'),
  ]);
  return {
    bg: toTexture(bg),
    card: toTexture(card),
    button: toTexture(button),
    buttonHilite: toTexture(buttonHilite),
    headline: toTexture(headline),
  };
}

/** One selected-building preview: an atlas region as a ready texture, sized in native frame px. */
export interface BuildingPreview {
  readonly texture: Texture;
  readonly width: number;
  readonly height: number;
}

function previewOf(layer: SpriteLayer, bob: number): BuildingPreview | undefined {
  const frame = layer.atlas.frames.get(bob);
  if (frame === undefined) return undefined;
  return {
    texture: new Texture({
      source: layer.source,
      frame: new Rectangle(frame.x, frame.y, frame.width, frame.height),
    }),
    width: frame.width,
    height: frame.height,
  };
}

async function loadBuildingPreviews(): Promise<ReadonlyMap<number, BuildingPreview>> {
  const ir = await loadIr();
  if (ir?.buildingBobs === undefined || ir.buildingBobs.length === 0) return new Map();

  const [defaultLayer, familyEntries] = await Promise.all([
    loadLayer(HOUSE_ATLAS).catch<SpriteLayer | null>((err) => {
      if (err instanceof MissingAtlasError) return null;
      throw err;
    }),
    Promise.all(
      BUILDING_FAMILIES.map(async (family) => {
        try {
          return [family.layer, await loadLayer(family.layer)] as const;
        } catch (err) {
          if (err instanceof MissingAtlasError) return null;
          throw err;
        }
      }),
    ),
  ]);

  const layers = new Map<string, SpriteLayer>();
  for (const entry of familyEntries) {
    if (entry !== null) layers.set(entry[0], entry[1]);
  }
  const loadedFamilies = BUILDING_FAMILIES.filter((f) => layers.has(f.layer));
  const refs = buildingBobRefsByType(ir.buildingBobs, VIKING_TRIBE, DEFAULT_BUILDING_FAMILY, loadedFamilies);
  const previews = new Map<number, BuildingPreview>();
  for (const [typeIdText, ref] of Object.entries(refs)) {
    const typeId = Number(typeIdText);
    const layer = typeof ref === 'number' ? (defaultLayer ?? undefined) : layers.get(ref.layer);
    if (layer === undefined) continue;
    const preview = previewOf(layer, typeof ref === 'number' ? ref : ref.bob);
    if (preview !== undefined) previews.set(typeId, preview);
  }
  return previews;
}

export interface DetailsPanelAssets {
  readonly art: GuiArt | null;
  /** The per-good resource icons from the recolourable `ls_goods` atlas. */
  readonly goods: GoodsArt | null;
  readonly uiFont: UiFont;
  readonly bitmaps: GuiBitmapSet;
  readonly strings: GuiStrings | null;
  readonly previews: ReadonlyMap<number, BuildingPreview>;
  /** The decoded level-to-colour gauge ramp (`bar_hitpoints`). */
  readonly barRamp: GuiBarRamp | undefined;
}

const assetsByLanguage = new Map<string, Promise<DetailsPanelAssets>>();

export async function loadDetailsPanelAssets(lang: string): Promise<DetailsPanelAssets> {
  let assets = assetsByLanguage.get(lang);
  if (assets === undefined) {
    assets = Promise.all([
      loadGuiArt(),
      loadGoodsArt(),
      loadUiFont(),
      loadGuiBitmaps(),
      loadGuiStrings(lang),
      loadBuildingPreviews(),
      loadGuiBarRamp(),
    ]).then(([art, goods, uiFont, bitmaps, strings, previews, barRamp]) => ({
      art,
      goods,
      uiFont,
      bitmaps,
      strings,
      previews,
      barRamp,
    }));
    assetsByLanguage.set(lang, assets);
  }
  return assets;
}
