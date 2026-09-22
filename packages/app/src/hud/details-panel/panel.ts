import type { UiCue } from '@open-northland/audio';
import type { PortraitInsetFrame, SpriteSheet } from '@open-northland/render';
import type { WorldSnapshot } from '@open-northland/sim';
import type { Application, Texture } from 'pixi.js';
import { animalGoodIcons } from '../../content/animal-gfx/icons.js';
import { clientToCanvas, contains } from '../geometry.js';
import { MIN_UI_SCALE } from '../ui-scale.js';
import { buildingPreviews, loadDetailsPanelArt } from './assets.js';
import { applyPanelClick, type PanelClickActions } from './click-actions.js';
import { tooltipTextAt } from './hit-test.js';
import { buildUnitPanelModel, type UnitPanelModel, type UnitPanelModelContext } from './model/index.js';
import { NO_PANEL_HOVER, type PanelHover, panelClickAt, panelHoverAt, sameHover } from './pointer-intent.js';
import { createPanelRebuildGate } from './rebuild-gate.js';
import { EMPTY_PANEL_VIEW, type PanelView, panelViewFor } from './selection-view.js';
import { createPanelStage } from './stage.js';
import { ALL_STOCK_TAB } from './stock-tabs.js';
import { createWorkerField } from './worker-field.js';

/** Owns the selection, hover and stock-tab state the model, layout and stage read. */

/** The panel preview rect, in on-screen px, plus the entity the live observation window centres on. */
export type PortraitBox = PortraitInsetFrame;
/** Bevel inset (design px) so the observation window sits inside the portrait box's frame, not over it. */
const PORTRAIT_BEVEL_INSET = 3;

export interface UnitPanelOptions extends UnitPanelModelContext, PanelClickActions {
  readonly app: Application;
  readonly canvas: HTMLCanvasElement;
  /** The resolved HUD scale, shared with the left tool panel and action ring. May be fractional. */
  readonly uiscale?: number;
  readonly lang: string;
  /** Client→canvas coordinate mapping, injected so the hud layer stays view-free. */
  readonly backingScale: (canvas: HTMLCanvasElement) => { sx: number; sy: number; rect: DOMRect };
  /** Sprite sheet for the animated worker field; absent → the field stays empty. */
  readonly sheet?: SpriteSheet;
  /** The presentation pack's goods icons, by good id; absent → the original's frames. */
  readonly packGoods?: ReadonlyMap<string, Texture>;
  /** Owner slot → team-colour slot for the worker sprites; absent = identity. */
  readonly playerColourOf?: (player: number) => number;
  /** Select this entity - invoked when the player clicks a worker sprite in the Pracownicy field. */
  readonly onSelectEntity?: (entityId: number) => void;
  /** The GUI click every pressed panel button and worker portrait confirms with; absent, silent. */
  readonly onUiCue?: (cue: UiCue) => void;
  /** Cursor tooltip naming the hovered stock row, injected structurally so the hud layer never imports
   *  the view-layer element; absent → no stock-row tooltip. */
  readonly tooltip?: {
    show(clientX: number, clientY: number, text: string): void;
    hide(): void;
  };
}

export interface UnitPanel {
  render(snapshot: WorldSnapshot, selected: ReadonlySet<number>): void;
  tick(snapshot: WorldSnapshot): void;
  claimsPointer(clientX: number, clientY: number): boolean;
  /** Null when the current selection has no portrait (multi-select, empty). */
  portrait(): PortraitBox | null;
  /**
   * Returns true when the point is over the panel, so the caller must not world-pick it; a left press on
   * an enabled button performs its action. `toggleModifier` (Ctrl/Cmd held) switches a craft-choice click
   * from replace-selection to toggle.
   */
  handleMouseDown(clientX: number, clientY: number, button: number, toggleModifier?: boolean): boolean;
  state(): UnitPanelState;
  restore(state: UnitPanelState): void;
  dispose(): void;
}

export interface UnitPanelState {
  readonly activeStockTab: number;
}

export async function mountUnitPanel(opts: UnitPanelOptions): Promise<UnitPanel> {
  const { app, canvas } = opts;
  const scale = Math.max(MIN_UI_SCALE, opts.uiscale ?? 1);
  const assets = {
    ...(await loadDetailsPanelArt(opts.lang)),
    previews: buildingPreviews(opts.sheet),
    ...(opts.packGoods !== undefined ? { packGoods: opts.packGoods } : {}),
    animalGoods: animalGoodIcons(opts.sheet, opts.goods, opts.livestockTribeOfGood),
  };
  const stage = createPanelStage({ app, assets, scale });
  const workerField = createWorkerField({
    app,
    scale,
    sheet: opts.sheet,
    playerColourOf: opts.playerColourOf,
  });

  const ctx: UnitPanelModelContext = opts;

  let selectedIds: ReadonlySet<number> = new Set();
  const rebuildGate = createPanelRebuildGate({
    derive: (snapshot) => buildUnitPanelModel(snapshot, selectedIds, ctx),
    now: () => performance.now(),
  });
  let view: PanelView = EMPTY_PANEL_VIEW;
  let hover: PanelHover = NO_PANEL_HOVER;
  /** The last known cursor position over the canvas (client coords), or null after it left, so a rebuild
   *  can refresh a still cursor's tooltip with live values. */
  let lastPointer: { clientX: number; clientY: number } | null = null;
  /** The selected stock tab; every new selection reopens on "Wszystkie". */
  let activeStockTab = ALL_STOCK_TAB;

  const rebuild = (model: UnitPanelModel): void => {
    rebuildGate.rebuilt();
    view = panelViewFor(model, app.screen, scale);
    stage.paint(view, hover, activeStockTab);
    if (view.kind === 'empty') return;
    // A rebuild changes what a held cursor hovers, and the cursor itself won't move to fire a mousemove.
    if (lastPointer !== null) updateTooltip(lastPointer.clientX, lastPointer.clientY);
  };

  /** Re-bake the current selection after a panel-local change (hover, stock tab); inert while empty. */
  const rebuildCurrent = (): void => {
    if (view.kind !== 'empty') rebuild(view.model);
  };

  const updateModel = (snapshot: WorldSnapshot, force = false): void => {
    const next = rebuildGate.decide(snapshot, app.screen, force);
    if (next === null) return;
    if (next.structural) activeStockTab = ALL_STOCK_TAB;
    rebuild(next.model);
  };

  const toCanvas = (clientX: number, clientY: number): { x: number; y: number } =>
    clientToCanvas(opts.backingScale(canvas), clientX, clientY);

  const claimsPointer = (clientX: number, clientY: number): boolean => {
    if (view.kind === 'empty') return false;
    const { x, y } = toCanvas(clientX, clientY);
    return contains(view.layout.panel, x, y);
  };

  const selectStockTab = (tab: number): void => {
    if (tab === activeStockTab) return;
    activeStockTab = tab;
    rebuildCurrent();
  };

  const handleMouseDown = (
    clientX: number,
    clientY: number,
    button: number,
    toggleModifier = false,
  ): boolean => {
    if (!claimsPointer(clientX, clientY)) return false;
    if (button !== 0) return true; // over the panel - swallow, but only the left button acts
    const { x, y } = toCanvas(clientX, clientY);
    // A worker sprite claims the click ahead of any tab or button under it.
    const worker = workerField.hitTest(x, y);
    if (worker !== null) {
      opts.onUiCue?.('confirm');
      opts.onSelectEntity?.(worker);
      return true;
    }
    const click = panelClickAt(view, x, y, toggleModifier);
    if (click !== null) {
      opts.onUiCue?.('confirm');
      applyPanelClick(click, opts, selectStockTab);
    }
    return true;
  };

  /** Recompute the cursor tooltip, so a still cursor's value tracks the rebuild cadence, not the frame
   *  rate. */
  const updateTooltip = (clientX: number, clientY: number): void => {
    if (opts.tooltip === undefined) return;
    const { x, y } = toCanvas(clientX, clientY);
    if (view.kind === 'empty' || !contains(view.layout.panel, x, y)) {
      opts.tooltip.hide();
      return;
    }
    const text = tooltipTextAt(view, x, y, scale, activeStockTab);
    if (text === null) opts.tooltip.hide();
    else opts.tooltip.show(clientX, clientY, text);
  };

  const setHover = (next: PanelHover): void => {
    if (sameHover(next, hover)) return;
    hover = next;
    rebuildCurrent();
  };

  const onMouseMove = (e: MouseEvent): void => {
    lastPointer = { clientX: e.clientX, clientY: e.clientY };
    updateTooltip(e.clientX, e.clientY);
    const { x, y } = toCanvas(e.clientX, e.clientY);
    setHover(panelHoverAt(view, x, y));
  };

  // Leaving the canvas can't fire a final over-empty mousemove, so the row tooltip would linger - hide it.
  const onMouseLeave = (): void => {
    lastPointer = null;
    opts.tooltip?.hide();
    setHover(NO_PANEL_HOVER);
  };

  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('mouseleave', onMouseLeave);

  const portrait = (): PortraitBox | null => {
    if (view.kind !== 'settler' && view.kind !== 'building') return null;
    const box = view.layout.preview;
    const inset = Math.round(PORTRAIT_BEVEL_INSET * scale);
    return {
      entityRef: view.model.entityId,
      kind: view.kind,
      rect: { x: box.x + inset, y: box.y + inset, w: box.w - 2 * inset, h: box.h - 2 * inset },
    };
  };

  return {
    render(snapshot, selected): void {
      selectedIds = new Set(selected);
      updateModel(snapshot, true);
      workerField.sync(snapshot, view);
    },
    tick(snapshot): void {
      updateModel(snapshot);
      workerField.sync(snapshot, view);
    },
    claimsPointer,
    handleMouseDown,
    portrait,
    state: () => ({ activeStockTab }),
    restore(state): void {
      if (state.activeStockTab === activeStockTab) return;
      activeStockTab = state.activeStockTab;
      rebuildCurrent();
    },
    dispose(): void {
      canvas.removeEventListener('mousemove', onMouseMove);
      workerField.dispose();
      canvas.removeEventListener('mouseleave', onMouseLeave);
      opts.tooltip?.hide();
      stage.dispose();
    },
  };
}
