import type { TextureSource } from '@open-northland/render';
import { Texture } from 'pixi.js';
import { type GuiArt, loadGuiArt } from '../../content/gui-art.js';
import { type GuiBarRamp, loadGuiBarRamp, loadGuiBitmap } from '../../content/gui-gfx.js';
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
  /** The decoded level-to-colour gauge ramp (`bar_hitpoints`). */
  readonly barRamp: GuiBarRamp | undefined;
}

let assetsOnce: Promise<DetailsPanelAssets> | undefined;

export async function loadDetailsPanelAssets(): Promise<DetailsPanelAssets> {
  if (assetsOnce === undefined) {
    assetsOnce = Promise.all([loadGuiArt(), loadUiFont(), loadGuiBitmaps(), loadGuiBarRamp()]).then(
      ([art, uiFont, bitmaps, barRamp]) => ({ art, uiFont, bitmaps, barRamp }),
    );
    void assetsOnce.catch(() => {
      assetsOnce = undefined;
    });
  }
  return assetsOnce;
}
