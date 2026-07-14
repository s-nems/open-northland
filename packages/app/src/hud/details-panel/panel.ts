import {
  bakeToSprite,
  type PortraitInsetFrame,
  type SpriteSheet,
  type SupersampledTexture,
} from '@open-northland/render';
import type { WorldSnapshot } from '@open-northland/sim';
import { type Application, Container, Graphics } from 'pixi.js';
import { uiStringLookup } from '../../content/gui-gfx.js';
import { contains, type Rect } from '../geometry.js';
import { loadDetailsPanelAssets } from './assets.js';
import { createChrome, type PanelLayers } from './chrome.js';
import {
  type ButtonHit,
  type DetailsLayout,
  layoutDetails,
  mapLayout,
  ROW_H,
  stockSlotRects,
} from './layout/index.js';
import { buildUnitPanelModel, type UnitPanelModel, type UnitPanelModelContext } from './model/index.js';
import { drawBuilding, drawCompact, drawSettler } from './sections/index.js';
import { stockTabLabels } from './stock-tabs.js';
import { WorkerSpriteOverlay } from './worker-sprites.js';

/**
 * The bottom-right selection details panel (the original's per-selection window stack: general/defence/
 * production/stock/workers for a building, the info card for a settler), drawn as Pixi HUD from the
 * extracted original art. `model.ts` decides WHAT is shown, `layout.ts` WHERE, `sections.ts`+`chrome.ts`
 * HOW — this module wires them to the app: loading, selection/tick updates, pointer claims, and clicks.
 */

/** Above the world and the left tool panel, below nothing (the panel is the outermost HUD layer). */
const PANEL_Z = 1002;

/**
 * The portrait box the live world "observation window" fills — the panel's preview rect, in on-screen px,
 * shrunk by the bevel so the cutout sits INSIDE the inner-box frame rather than over it. Both the settler
 * (Ogólne) and building (Ogólny) layouts expose a `preview`; the view renders the world into this rect and
 * centres it on {@link PortraitBox.entityRef}. Null when the current selection has no portrait.
 */
export type PortraitBox = PortraitInsetFrame;
/** Bevel inset (design px) so the observation window sits inside the portrait box's frame, not over it. */
const PORTRAIT_BEVEL_INSET = 3;

/**
 * Minimum wall-clock gap between value-driven rebuilds. Live values (production %, need bars, status
 * countdowns) change nearly every sim tick; rebuilding the retained tree 20×/s is pure churn, and 4 Hz
 * is indistinguishable on a ~100-px bar. Selection changes rebuild immediately.
 */
const VALUE_REBUILD_MIN_MS = 250;

export interface UnitPanelOptions extends UnitPanelModelContext {
  readonly app: Application;
  readonly canvas: HTMLCanvasElement;
  /** Integer UI scale (from `?uiscale=`), shared with the left tool panel and action ring. */
  readonly uiscale?: number;
  readonly lang: string;
  /** Client→canvas coordinate mapping, injected like the tool panel's (the hud layer stays view-free). */
  readonly backingScale: (canvas: HTMLCanvasElement) => { sx: number; sy: number; rect: DOMRect };
  readonly onDemolish: (entityId: number) => void;
  /** The loaded sprite sheet, so the workers field can draw its bound workers as animated on-map sprites.
   *  Absent (a bare checkout / headless test) → the field just stays empty. */
  readonly sheet?: SpriteSheet;
  /** Select this entity — invoked when the player clicks a worker sprite in the Pracownicy field, so it
   *  selects that settler (dropping the building), exactly like clicking the worker on the map. */
  readonly onSelectEntity?: (entityId: number) => void;
  /** A cursor tooltip to NAME the hovered Magazyn stock row — injected (structural shape) like
   *  `backingScale`, so the hud layer never imports the view-layer element. Absent → no stock-row tooltip. */
  readonly tooltip?: {
    show(clientX: number, clientY: number, text: string): void;
    hide(): void;
  };
}

export interface UnitPanel {
  /** Rebuild the details panel for a new selection. */
  render(snapshot: WorldSnapshot, selected: ReadonlySet<number>): void;
  /** Refresh the details panel from the current snapshot. */
  tick(snapshot: WorldSnapshot): void;
  /** True when a client point is over the details panel. */
  claimsPointer(clientX: number, clientY: number): boolean;
  /** The portrait box the live world observation window fills (rect + entity to centre on), or null when
   *  the current selection has no portrait (multi-select, empty). Read each frame by the view. */
  portrait(): PortraitBox | null;
  /**
   * Route a mousedown: true when the point is over the panel (the caller must not world-pick it);
   * a left press on an enabled button performs its action. Part of the unit-controls claim chain.
   */
  handleMouseDown(clientX: number, clientY: number, button: number): boolean;
  dispose(): void;
}

/** The stock category tab a freshly-selected building opens on: the FIRST (lowest-index) category that
 *  holds any of its goods, so the panel lands on the leading tab (Żywność for a general store) rather than
 *  on whichever category happens to be fullest. */
export function defaultStockTab(model: UnitPanelModel): number {
  if (model.kind !== 'building' || model.stock.length === 0) return 0;
  return Math.min(...model.stock.map((row) => row.category));
}

export async function mountUnitPanel(opts: UnitPanelOptions): Promise<UnitPanel> {
  const { app, canvas } = opts;
  // Fractional display scale (shared with the tool panel / action ring); the panel's PalettedSprite chrome
  // (indexed atlas, nearest-sampled) can't be linearly filtered, so a fractional scale would double texel
  // columns unevenly ("pixeloza") — instead it bakes at an integer oversample and linear-downscales to this.
  const scale = Math.max(1, opts.uiscale ?? 1);
  // The panel carries the FINEST text in the HUD (a native-11px body font at a fractional scale). Unlike
  // the tool-panel strip (icons — a device-aware `oversampleFor` is enough), a 2× bake linear-downscaled to
  // a fractional scale still hazes small glyph edges, so text legibility wins: at a fractional scale bake at
  // the MAX oversample (crispest downscale). An INTEGER scale needs no supersample at all — nearest is
  // already exact, so keep it 1:1 rather than needlessly softening a pixel-perfect render. (This panel's
  // policy differs from the shared `oversampleFor` — which always targets ≥2× for AA — so it decides here.)
  const PANEL_MAX_SUPERSAMPLE = 4;
  const ss = Number.isInteger(scale) && scale <= PANEL_MAX_SUPERSAMPLE ? scale : PANEL_MAX_SUPERSAMPLE;
  const assets = await loadDetailsPanelAssets(opts.lang);
  const uiString = uiStringLookup(assets.strings);

  let root = new Container();
  root.zIndex = PANEL_Z;
  root.visible = false;
  app.stage.addChild(root);
  /** The current rebuild's baked panel texture; disposed and replaced on the next rebuild. */
  let baked: SupersampledTexture | null = null;
  // The animated worker sprites drawn LIVE over the baked panel's Pracownicy field (one z above it), so
  // they advance every frame while the panel itself re-bakes at most 4 Hz.
  const workerOverlay = new WorkerSpriteOverlay(app, opts.sheet, PANEL_Z + 1);

  const ctx: UnitPanelModelContext = {
    buildings: opts.buildings,
    goods: opts.goods,
    jobs: opts.jobs,
  };

  let selectedIds: ReadonlySet<number> = new Set();
  let lastModelKey = '';
  let lastStructureKey = '';
  let lastRebuildAt = Number.NEGATIVE_INFINITY;
  let lastModel: UnitPanelModel = { kind: 'empty' };
  let layout: DetailsLayout | null = null;
  let hoverAction: ButtonHit['action'] | null = null;
  /** The last known cursor position over the canvas (client coords), or null after it left — lets a
   *  rebuild refresh a STILL cursor's tooltip with live values (a held hover must not show a stale
   *  "80%" while the bar drains; user feedback 2026-07-11). */
  let lastPointer: { clientX: number; clientY: number } | null = null;
  /** The selected stock category tab (0–7); reset to the fullest category (`defaultStockTab`) on each new selection. */
  let activeStockTab = 0;

  /** Fresh draw-order layers over an off-screen container (baked to a texture): fills, graphics, frames, glyphs. */
  const makeLayers = (into: Container): PanelLayers => {
    const g = new Graphics();
    const back = new Container();
    const front = new Container();
    const text = new Container();
    into.addChild(back, g, front, text);
    return { g, back, front, text };
  };

  const rebuild = (model: UnitPanelModel): void => {
    baked?.dispose();
    baked = null;
    root.destroy({ children: true });
    root = new Container();
    root.zIndex = PANEL_Z;
    app.stage.addChild(root);
    lastModel = model;
    lastRebuildAt = performance.now();
    // Hit layout: the real screen-anchored geometry at the fractional display scale (pointer claims, buttons).
    layout = layoutDetails(model, app.screen, scale);
    if (layout === null) {
      root.visible = false;
      return;
    }
    root.visible = true;

    // Draw layout: the hit layout scaled by the oversample/display ratio and re-origined to (0,0), so it
    // fills a tight off-screen texture drawn at `ss`. Deriving it from the hit layout (rather than a second
    // `layoutDetails` at `ss`) keeps the drawn geometry EQUAL to the hit-tested geometry — two independent
    // roundings at different scales would drift ~1 px and accumulate down the button column.
    const k = ss / scale;
    const origin = layout.panel;
    const draw = mapLayout(layout, (r) => ({
      x: (r.x - origin.x) * k,
      y: (r.y - origin.y) * k,
      w: r.w * k,
      h: r.h * k,
    }));
    const texW = Math.max(1, Math.round(draw.panel.w));
    const texH = Math.max(1, Math.round(draw.panel.h));

    const offscreen = new Container();
    const chrome = createChrome(assets, app, ss, makeLayers(offscreen), { w: texW, h: texH });
    if (draw.kind === 'building' && model.kind === 'building') {
      drawBuilding(chrome, draw, model, uiString, hoverAction, activeStockTab, ss);
    } else if (draw.kind === 'settler' && model.kind === 'settler') {
      drawSettler(chrome, draw, model, uiString, ss);
    } else if (draw.kind === 'compact' && (model.kind === 'multi-settler' || model.kind === 'generic')) {
      drawCompact(chrome, draw, model, uiString, ss);
    }

    // Mixed source (Pixi-native fills/preview + flipY PalettedSprites), so it bakes UPRIGHT — display
    // unflipped, anchored at the panel's screen TOP-left.
    const texture = bakeToSprite(app.renderer, offscreen, texW, texH, scale / ss);
    texture.display.position.set(layout.panel.x, layout.panel.y);
    root.addChild(texture.display);
    baked = texture;
    // A rebuild changes what a HELD cursor hovers (a draining bar's value, a re-sorted stock row) — the
    // cursor itself won't move to fire a mousemove, so refresh the tooltip here. Rebuilds are already
    // rate-limited (VALUE_REBUILD_MIN_MS), so this adds no per-frame work.
    if (lastPointer !== null) updateTooltip(lastPointer.clientX, lastPointer.clientY);
  };

  const updateModel = (snapshot: WorldSnapshot, force = false): void => {
    const model = buildUnitPanelModel(snapshot, selectedIds, ctx);
    // A whole-model value key (plus the screen size, so a resize re-anchors the panel): the panel is
    // small, so stringify-compare beats hand-written dirty flags.
    const key = `${JSON.stringify(model)}|${app.screen.width}x${app.screen.height}`;
    if (!force && key === lastModelKey) return;
    // WHAT is selected changed → rebuild now; only live VALUES drifted → rebuild at most 4 Hz.
    const structureKey =
      model.kind === 'building' || model.kind === 'settler' ? `${model.kind}:${model.entityId}` : model.kind;
    const structural = force || structureKey !== lastStructureKey;
    if (!structural && performance.now() - lastRebuildAt < VALUE_REBUILD_MIN_MS) return;
    // A new selection opens the stock view on its fullest category, so the panel never lands on an empty
    // tab (with a store's goods spread across tabs, tab 0 may hold none of THIS building's stock).
    if (structural) activeStockTab = defaultStockTab(model);
    lastModelKey = key;
    lastStructureKey = structureKey;
    rebuild(model);
  };

  const toCanvas = (clientX: number, clientY: number): { x: number; y: number } => {
    const { sx, sy, rect } = opts.backingScale(canvas);
    return { x: (clientX - rect.left) * sx, y: (clientY - rect.top) * sy };
  };

  const buttons = (): readonly ButtonHit[] => (layout?.kind === 'building' ? layout.buttons : []);

  const hitButton = (x: number, y: number): ButtonHit | null =>
    buttons().find((b) => contains(b.rect, x, y)) ?? null;

  /** The stock category tab under a canvas point, or null — only building layouts carry a tab strip. */
  const hitStockTab = (x: number, y: number): number | null => {
    if (layout?.kind !== 'building') return null;
    const i = layout.stockTabHits.findIndex((r) => contains(r, x, y));
    return i >= 0 ? i : null;
  };

  const claimsPointer = (clientX: number, clientY: number): boolean => {
    if (layout === null || lastModel.kind === 'empty') return false;
    const { x, y } = toCanvas(clientX, clientY);
    return contains(layout.panel, x, y);
  };

  const handleMouseDown = (clientX: number, clientY: number, button: number): boolean => {
    if (!claimsPointer(clientX, clientY)) return false;
    if (button !== 0) return true; // over the panel — swallow, but only the left button acts
    const { x, y } = toCanvas(clientX, clientY);
    // A click on a worker sprite selects that settler (like clicking it on the map) — before tabs/buttons.
    const worker = workerOverlay.hitTest(x, y);
    if (worker !== null) {
      opts.onSelectEntity?.(worker);
      return true;
    }
    const tab = hitStockTab(x, y);
    if (tab !== null) {
      if (tab !== activeStockTab && lastModel.kind !== 'empty') {
        activeStockTab = tab;
        rebuild(lastModel);
      }
      return true;
    }
    const hit = hitButton(x, y);
    if (hit?.action === 'demolish' && hit.enabled && lastModel.kind === 'building') {
      opts.onDemolish(lastModel.entityId);
    }
    return true;
  };

  /** The good NAME under a canvas point in the stock grid, or null — the tooltip's text for a hovered row.
   *  Probes the SAME slot rects the rows draw into ({@link stockSlotRects}), then maps the slot index to the
   *  drawn goods (a compact store lists ALL rows; a tabbed one the active tab's — the same split the draw
   *  applies), so a hovered slot names exactly the drawn good. */
  const hitStockGood = (x: number, y: number): string | null => {
    if (layout?.kind !== 'building' || layout.stock === null || lastModel.kind !== 'building') return null;
    const slot = stockSlotRects(layout.stock.body, scale, layout.stockRows).findIndex((r) =>
      contains(r, x, y),
    );
    if (slot < 0) return null;
    const rows = (
      layout.stockCompact ? lastModel.stock : lastModel.stock.filter((row) => row.category === activeStockTab)
    ).slice(0, layout.stockRows * 2);
    return rows[slot]?.label ?? null;
  };

  /** The hovered Ogólne stat bar's VALUE ("300/1000" health points, "75%" need satisfaction), or null.
   *  Probes the whole label+gauge row (layout.bars, same order as model.bars) — more forgiving than the
   *  gauge alone, and the label row is unambiguous. */
  const hitBarValue = (x: number, y: number): string | null => {
    if (layout?.kind !== 'settler' || lastModel.kind !== 'settler') return null;
    const i = layout.bars.findIndex((r) => contains(r, x, y));
    return i < 0 ? null : (lastModel.bars[i]?.hover ?? null);
  };

  /** Recompute + show/hide the value/name tooltip for the cursor at a client point: a Magazyn stock
   *  row's good name or a category TAB's name for a building (the tab glyphs are cryptic unread art,
   *  so the tooltip is what names a category), a stat bar's live value for a settler. The probes are
   *  layout-kind-exclusive, so at most one can hit. Called on mousemove and after each panel rebuild
   *  (so a HELD cursor's value tracks the live model at the rebuild cadence, not per frame); a cursor
   *  outside the panel bails before any row probing. */
  const updateTooltip = (clientX: number, clientY: number): void => {
    if (opts.tooltip === undefined) return;
    const { x, y } = toCanvas(clientX, clientY);
    if (layout === null || !contains(layout.panel, x, y)) {
      opts.tooltip.hide();
      return;
    }
    const rowName = hitStockGood(x, y);
    const tab = rowName === null ? hitStockTab(x, y) : null;
    const tabLabel = tab !== null ? (stockTabLabels()[tab] ?? null) : null;
    const text = rowName ?? tabLabel ?? hitBarValue(x, y);
    if (text === null) opts.tooltip.hide();
    else opts.tooltip.show(clientX, clientY, text);
  };

  const onMouseMove = (e: MouseEvent): void => {
    lastPointer = { clientX: e.clientX, clientY: e.clientY };
    updateTooltip(e.clientX, e.clientY);
    const { x, y } = toCanvas(e.clientX, e.clientY);
    const next = hitButton(x, y)?.action ?? null;
    if (next === hoverAction) return;
    hoverAction = next;
    if (lastModel.kind !== 'empty') rebuild(lastModel);
  };

  // Leaving the canvas can't fire a final over-empty mousemove, so the row tooltip would linger — hide it.
  const onMouseLeave = (): void => {
    lastPointer = null;
    opts.tooltip?.hide();
  };

  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('mouseleave', onMouseLeave);

  /** The current portrait box (preview rect, bevel-inset) + its entity, for the live observation window. */
  const portrait = (): PortraitBox | null => {
    if (layout === null) return null;
    // Both the settler (Ogólne) and building (Ogólny) layouts expose a `preview`; any other kind has none.
    const box: Rect | undefined =
      layout.kind === 'settler' || layout.kind === 'building' ? layout.preview : undefined;
    if (box === undefined || (lastModel.kind !== 'settler' && lastModel.kind !== 'building')) return null;
    const entityRef = lastModel.entityId;
    const inset = Math.round(PORTRAIT_BEVEL_INSET * scale);
    return {
      entityRef,
      kind: lastModel.kind,
      rect: { x: box.x + inset, y: box.y + inset, w: box.w - 2 * inset, h: box.h - 2 * inset },
    };
  };

  /** Redraw the animated worker sprites into the (live) Pracownicy field, or clear them when the current
   *  selection isn't a building. The field is the workers body minus the top row the limits strip occupies. */
  const refreshWorkers = (snapshot: WorldSnapshot): void => {
    if (lastModel.kind !== 'building' || layout?.kind !== 'building') {
      workerOverlay.update(snapshot, null, null);
      return;
    }
    const b = layout.workers.body;
    // The compact limits line sits in the first row — except on a construction site, which shows no
    // strip (the field holds the live building crew instead — the overlay's siteCrew selector).
    const siteCrew = lastModel.construction !== null;
    const inset = siteCrew ? 0 : Math.round(ROW_H * scale);
    const field: Rect = { x: b.x, y: b.y + inset, w: b.w, h: Math.max(0, b.h - inset) };
    workerOverlay.update(snapshot, lastModel.entityId, field, siteCrew);
  };

  return {
    render(snapshot, selected): void {
      selectedIds = new Set(selected);
      updateModel(snapshot, true);
      refreshWorkers(snapshot);
    },
    tick(snapshot): void {
      updateModel(snapshot);
      refreshWorkers(snapshot);
    },
    claimsPointer,
    handleMouseDown,
    portrait,
    dispose(): void {
      canvas.removeEventListener('mousemove', onMouseMove);
      workerOverlay.dispose();
      canvas.removeEventListener('mouseleave', onMouseLeave);
      opts.tooltip?.hide();
      baked?.dispose();
      root.destroy({ children: true });
    },
  };
}
