import type { ReusableBaker, SupersampledTexture } from '@open-northland/render';
import { Container, Graphics } from 'pixi.js';
import type { UiString } from '../../content/gui-gfx.js';
import type { Rect } from '../geometry.js';
import type { DetailsPanelAssets } from './assets.js';
import { createChrome, type PanelLayers } from './chrome.js';
import { mapLayout } from './layout/index.js';
import type { PanelHover } from './pointer-intent.js';
import { drawBuilding, drawCompact, drawSettler, drawSignpost } from './sections/index.js';
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
  readonly ui: UiString;
  readonly activeStockTab: number;
  /** Fractional on-screen scale the texture is displayed at; `ss` is the integer oversample it draws at. */
  readonly scale: number;
  readonly ss: number;
}

function makeLayers(into: Container): PanelLayers {
  const g = new Graphics();
  const back = new Container();
  const front = new Container();
  const text = new Container();
  into.addChild(back, g, front, text);
  return { g, back, front, text };
}

export function bakePanel(opts: PanelBakeOptions): SupersampledTexture {
  const { assets, baker, view, hover, ui, activeStockTab, scale, ss } = opts;
  const { toDraw, texW, texH } = panelDrawGeometry(view.layout.panel, scale, ss);
  const offscreen = new Container();
  const chrome = createChrome(assets, ss, makeLayers(offscreen), { w: texW, h: texH });
  switch (view.kind) {
    case 'building': {
      const draw = mapLayout(view.layout, toDraw);
      drawBuilding(chrome, draw, view.model, ui, hover.action, activeStockTab, ss);
      break;
    }
    case 'settler': {
      const draw = mapLayout(view.layout, toDraw);
      drawSettler(chrome, draw, view.model, ui, hover.action, hover.choiceGood, hover.equipAction, ss);
      break;
    }
    case 'compact':
      drawCompact(chrome, mapLayout(view.layout, toDraw), view.model, ui, ss);
      break;
    case 'signpost':
      drawSignpost(chrome, mapLayout(view.layout, toDraw), ui, hover.action);
      break;
    default: {
      const unreachable: never = view;
      throw new Error(`unhandled panel view: ${JSON.stringify(unreachable)}`);
    }
  }
  return baker.bake(offscreen, texW, texH, scale / ss);
}
