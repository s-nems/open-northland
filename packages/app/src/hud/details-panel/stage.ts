import { createReusableBaker, type SupersampledTexture } from '@open-northland/render';
import { type Application, Container } from 'pixi.js';
import { uiStringLookup } from '../../content/gui-gfx.js';
import type { DetailsPanelAssets } from './assets.js';
import { bakePanel } from './bake.js';
import type { PanelHover } from './pointer-intent.js';
import type { PanelView } from './selection-view.js';

/**
 * The panel's PalettedSprite chrome is nearest-sampled, so a fractional display scale would double texel
 * columns unevenly; the layer bakes at an integer oversample and linear-downscales instead.
 */

/** The outermost HUD layer, above the world and the left tool panel. */
const PANEL_Z = 1002;

/** The animated worker sprites draw live, one z above the baked panel they sit on. */
export const WORKER_OVERLAY_Z = PANEL_Z + 1;

/**
 * Bake oversample cap, decided here rather than by the shared `oversampleFor`: a fractional display scale
 * bakes at the max for the crispest downscale of native-11px text, an integer scale bakes 1:1 because
 * nearest sampling is already exact.
 */
const PANEL_MAX_SUPERSAMPLE = 4;

export interface PanelStageOptions {
  readonly app: Application;
  readonly assets: DetailsPanelAssets;
  /** The fractional on-screen scale the baked texture is displayed at. */
  readonly scale: number;
}

export interface PanelStage {
  /** Repaint for `view`, or hide the stage when the selection has no panel. */
  paint(view: PanelView, hover: PanelHover, activeStockTab: number): void;
  dispose(): void;
}

export function createPanelStage(opts: PanelStageOptions): PanelStage {
  const { app, assets, scale } = opts;
  const ui = uiStringLookup(assets.strings);
  const ss = Number.isInteger(scale) && scale <= PANEL_MAX_SUPERSAMPLE ? scale : PANEL_MAX_SUPERSAMPLE;
  let root = new Container();
  root.zIndex = PANEL_Z;
  root.visible = false;
  app.stage.addChild(root);
  let baked: SupersampledTexture | null = null;
  // One shared bake target: a fresh render texture per repaint blanks the portrait inset's world cutout
  // for a frame.
  const baker = createReusableBaker(app.renderer);

  return {
    paint(view, hover, activeStockTab): void {
      baked?.dispose();
      baked = null;
      root.destroy({ children: true });
      root = new Container();
      root.zIndex = PANEL_Z;
      app.stage.addChild(root);
      if (view.kind === 'empty') {
        root.visible = false;
        return;
      }
      root.visible = true;
      const texture = bakePanel({ assets, baker, view, hover, ui, activeStockTab, scale, ss });
      // Displayed unflipped: the bake is already upright.
      texture.display.position.set(view.layout.panel.x, view.layout.panel.y);
      root.addChild(texture.display);
      baked = texture;
    },
    dispose(): void {
      baked?.dispose();
      baker.dispose();
      root.destroy({ children: true });
    },
  };
}
