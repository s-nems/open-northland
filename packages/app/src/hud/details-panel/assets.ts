import type { TextureSource } from '@open-northland/render';
import { Texture } from 'pixi.js';
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

export interface DetailsPanelAssets {
  readonly art: GuiArt | null;
  readonly uiFont: UiFont;
  readonly bitmaps: GuiBitmapSet;
  readonly strings: GuiStrings | null;
  /** The decoded level-to-colour gauge ramp (`bar_hitpoints`). */
  readonly barRamp: GuiBarRamp | undefined;
}

const assetsByLanguage = new Map<string, Promise<DetailsPanelAssets>>();

export async function loadDetailsPanelAssets(lang: string): Promise<DetailsPanelAssets> {
  let assets = assetsByLanguage.get(lang);
  if (assets === undefined) {
    assets = Promise.all([
      loadGuiArt(),
      loadUiFont(),
      loadGuiBitmaps(),
      loadGuiStrings(lang),
      loadGuiBarRamp(),
    ]).then(([art, uiFont, bitmaps, strings, barRamp]) => ({
      art,
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
