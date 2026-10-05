import type { ReusableBaker, SupersampledTexture } from '@open-northland/render';
import { Container, Graphics, Text } from 'pixi.js';
import type { Rect } from '../geometry.js';
import type { DetailsPanelAssets } from './assets.js';
import { createChrome, type PanelLayers } from './chrome.js';
import { mapLayout } from './layout/index.js';
import type { PanelHover } from './pointer-intent.js';
import { drawPalisade } from './sections/index.js';
import type { PanelView } from './selection-view.js';

export type DrawableView = Exclude<PanelView, { kind: 'empty' }>;

export interface PanelDrawGeometry {
  /** A hit rect mapped to its off-screen twin: re-origined to the texture, scaled by `ss / scale`. */
  readonly toDraw: (r: Rect) => Rect;
  readonly texW: number;
  readonly texH: number;
}

/** Derived from the on-screen hit geometry, never laid out a second time at `ss`: two independent
 *  roundings drift ~1 px down the button column, so drawn and hit-tested geometry would diverge. */
export function panelDrawGeometry(panel: Rect, scale: number, ss: number): PanelDrawGeometry {
  const k = ss / scale;
  return {
    toDraw: (r) => ({ x: (r.x - panel.x) * k, y: (r.y - panel.y) * k, w: r.w * k, h: r.h * k }),
    texW: Math.max(1, Math.round(panel.w * k)),
    texH: Math.max(1, Math.round(panel.h * k)),
  };
}

export interface PanelBakeOptions {
  readonly assets: DetailsPanelAssets;
  readonly baker: ReusableBaker;
  readonly view: DrawableView;
  readonly hover: PanelHover;
  /** Fractional on-screen scale the texture is displayed at; `ss` is the integer oversample it draws at. */
  readonly scale: number;
  readonly ss: number;
}

function makeLayers(into: Container): PanelLayers {
  const g = new Graphics();
  const back = new Container();
  const front = new Container();
  const text = new Container();
  into.addChild(back, g, front);
  return { g, back, front, text };
}

export interface BakedPanel extends SupersampledTexture {
  readonly textLayer: Container;
}

export function bakePanel(opts: PanelBakeOptions): BakedPanel {
  const { assets, baker, view, hover, scale, ss } = opts;
  const { toDraw, texW, texH } = panelDrawGeometry(view.layout.panel, scale, ss);
  const offscreen = new Container();
  const layers = makeLayers(offscreen);
  const chrome = createChrome(assets, ss, layers, { w: texW, h: texH });
  drawPalisade(chrome, mapLayout(view.layout, toDraw), view.model, hover.action, ss);
  // Text rasterizes once at its final screen size, outside the downsampled chrome texture.
  const ratio = scale / ss;
  for (const child of layers.text.children) {
    if (!(child instanceof Text)) continue;
    child.style.fontSize *= ratio;
    child.position.set(child.x * ratio, child.y * ratio);
    child.roundPixels = true;
  }
  try {
    return { ...baker.bake(offscreen, texW, texH, ratio), textLayer: layers.text };
  } catch (error) {
    layers.text.destroy({ children: true });
    throw error;
  }
}
