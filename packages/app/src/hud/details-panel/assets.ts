import type { SpriteSheet, TextureSource } from '@open-northland/render';
import { Rectangle, Texture } from 'pixi.js';
import { boundBuildingRef } from '../../content/building-gfx/index.js';
import { type GoodsArt, loadGoodsArt } from '../../content/goods-gfx.js';
import { type GuiArt, loadGuiArt } from '../../content/gui-art.js';
import {
  type GuiBarRamp,
  type GuiStrings,
  loadGuiBarRamp,
  loadGuiBitmap,
  loadGuiStrings,
} from '../../content/gui-gfx.js';
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

/** The selected building's own world bob, resolved through the same per-tribe binding the map draws. */
export interface BuildingPreviews {
  get(typeId: number, tribe: number | undefined): BuildingPreview | undefined;
}

/** Memoized per sheet, which outlives every panel mount: a `Texture` pins a resize listener on its shared
 *  `TextureSource`, so re-minting one per remount would leak those wrappers on each HUD scale change. */
const previewsBySheet = new WeakMap<SpriteSheet, BuildingPreviews>();

/**
 * Preview textures cut from the sheet's already-loaded building pages, so the panel shows each tribe its
 * own body without fetching a second copy of any atlas.
 */
export function buildingPreviews(sheet: SpriteSheet | undefined): BuildingPreviews {
  if (sheet === undefined) return { get: () => undefined };
  const held = previewsBySheet.get(sheet);
  if (held !== undefined) return held;
  const cache = new Map<string, BuildingPreview | undefined>();
  const previews: BuildingPreviews = {
    get(typeId, tribe) {
      // The general window promises a neutral plate over a misleading complete one.
      const ref = boundBuildingRef(sheet.bindings.building, typeId, tribe);
      if (ref === undefined) return undefined;
      const draw = typeof ref === 'number' ? { bob: ref } : { bob: ref.bob, layer: ref.layer };
      const key = `${draw.layer ?? ''}:${draw.bob}`;
      const hit = cache.get(key);
      if (hit !== undefined || cache.has(key)) return hit;
      const layer = draw.layer !== undefined ? sheet.families?.[draw.layer] : sheet.kindLayers?.building;
      const frame = layer?.atlas.frames.get(draw.bob);
      const preview =
        layer === undefined || frame === undefined
          ? undefined
          : {
              texture: new Texture({
                source: layer.source,
                frame: new Rectangle(frame.x, frame.y, frame.width, frame.height),
              }),
              width: frame.width,
              height: frame.height,
            };
      cache.set(key, preview);
      return preview;
    },
  };
  previewsBySheet.set(sheet, previews);
  return previews;
}

export interface DetailsPanelArt {
  readonly art: GuiArt | null;
  /** The per-good resource icons from the recolourable `ls_goods` atlas. */
  readonly goods: GoodsArt | null;
  readonly uiFont: UiFont;
  readonly bitmaps: GuiBitmapSet;
  readonly strings: GuiStrings | null;
  /** The decoded level-to-colour gauge ramp (`bar_hitpoints`). */
  readonly barRamp: GuiBarRamp | undefined;
}

/** The panel's art plus the building previews, which come from the caller's loaded sprite sheet. */
export interface DetailsPanelAssets extends DetailsPanelArt {
  readonly packGoods?: ReadonlyMap<string, Texture>;
  /** The species goods, drawn as the animal a herd row counts rather than as a pile of it. */
  readonly animalGoods?: ReadonlyMap<string, Texture>;
  readonly previews: BuildingPreviews;
}

const assetsByLanguage = new Map<string, Promise<DetailsPanelArt>>();

export async function loadDetailsPanelArt(lang: string): Promise<DetailsPanelArt> {
  let assets = assetsByLanguage.get(lang);
  if (assets === undefined) {
    assets = Promise.all([
      loadGuiArt(),
      loadGoodsArt(),
      loadUiFont(),
      loadGuiBitmaps(),
      loadGuiStrings(lang),
      loadGuiBarRamp(),
    ]).then(([art, goods, uiFont, bitmaps, strings, barRamp]) => ({
      art,
      goods,
      uiFont,
      bitmaps,
      strings,
      barRamp,
    }));
    assetsByLanguage.set(lang, assets);
    // A rejected load would otherwise pin every later rebuild to the one transient failure.
    void assets.catch(() => assetsByLanguage.delete(lang));
  }
  return assets;
}
