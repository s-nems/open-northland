import { createReusableBaker, type SupersampledTexture } from '@open-northland/render';
import { type Application, Container } from 'pixi.js';
import { uiStringLookup } from '../../content/gui-gfx.js';
import type { DetailsPanelAssets } from './assets.js';
import { bakePanel } from './bake.js';
import type { PanelHover } from './pointer-intent.js';
import type { PanelView } from './selection-view.js';

/**
 * The panel's Pixi layer. Its PalettedSprite chrome (indexed atlas, nearest-sampled) cannot be linearly
 * filtered, so a fractional display scale would double texel columns unevenly ("pixeloza") - it bakes at
 * an integer oversample and linear-downscales to the display scale instead.
 */

/** Above the world and the left tool panel, below nothing (the panel is the outermost HUD layer). */
const PANEL_Z = 1002;

/** The animated worker sprites draw live, one z above the baked panel they sit on. */
export const WORKER_OVERLAY_Z = PANEL_Z + 1;

/**
 * The panel carries the finest text in the HUD (a native-11px body font at a fractional scale). Unlike
 * the tool-panel strip (icons - a device-aware `oversampleFor` is enough), a 2x bake linear-downscaled to
 * a fractional scale still hazes small glyph edges, so text legibility wins: at a fractional scale bake at
 * the max oversample (crispest downscale). An integer scale needs no supersample at all - nearest is
 * already exact, so keep it 1:1 rather than needlessly softening a pixel-perfect render. (This panel's
 * policy differs from the shared `oversampleFor` - which always targets >=2x for AA - so it decides here.)
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
  /** The current repaint's baked texture; disposed and replaced on the next one. */
  let baked: SupersampledTexture | null = null;
  // One shared bake target for every repaint: a fresh render texture per repaint would blank the
  // portrait inset's world cutout for a frame - the preview blinking at every construction hammer
  // hit (see createReusableBaker).
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
