import type { PortraitInsetFrame, SpriteSheet } from '@open-northland/render';
import type { WorldSnapshot } from '@open-northland/sim';
import type { Application } from 'pixi.js';
import { clientToCanvas, contains, type Rect } from '../geometry.js';
import { MIN_UI_SCALE } from '../ui-scale.js';
import { loadDetailsPanelAssets } from './assets.js';
import { tooltipTextAt } from './hit-test.js';
import { type EquipSlotRef, ROW_H } from './layout/index.js';
import { buildUnitPanelModel, type UnitPanelModel, type UnitPanelModelContext } from './model/index.js';
import { NO_PANEL_HOVER, type PanelHover, panelClickAt, panelHoverAt, sameHover } from './pointer-intent.js';
import { createPanelRebuildGate } from './rebuild-gate.js';
import { hasWorkerLimitsRow } from './sections/building/workers.js';
import { EMPTY_PANEL_VIEW, type PanelView, panelViewFor } from './selection-view.js';
import { createPanelStage, WORKER_OVERLAY_Z } from './stage.js';
import { ALL_STOCK_TAB } from './stock-tabs.js';
import { WorkerSpriteOverlay } from './worker-sprites.js';

/**
 * The bottom-right selection details panel, drawn as Pixi HUD from the extracted original art. This
 * module owns the selection, hover and stock-tab state the model, layout and stage read.
 */

/** The panel preview rect, in on-screen px, plus the entity the live observation window centres on. */
export type PortraitBox = PortraitInsetFrame;
/** Bevel inset (design px) so the observation window sits inside the portrait box's frame, not over it. */
const PORTRAIT_BEVEL_INSET = 3;

export interface UnitPanelOptions extends UnitPanelModelContext {
  readonly app: Application;
  readonly canvas: HTMLCanvasElement;
  /** The resolved HUD scale, shared with the left tool panel and action ring. May be fractional. */
  readonly uiscale?: number;
  readonly lang: string;
  /** Client→canvas coordinate mapping, injected so the hud layer stays view-free. */
  readonly backingScale: (canvas: HTMLCanvasElement) => { sx: number; sy: number; rect: DOMRect };
  readonly onDemolish: (entityId: number) => void;
  /** Begin upgrading the selected building into its next level - the Upgrade button (housewindow 110). */
  readonly onUpgrade: (entityId: number) => void;
  /** Abort the selected building's running upgrade - the Cancel button (housewindow 112). */
  readonly onCancelUpgrade: (entityId: number) => void;
  readonly onDemolishSignpost: (entityId: number) => void;
  /** Raise or lower the alarm on the selected garrison building - the Obrona window's shield toggle. */
  readonly onSetDefenceMode: (entityId: number, enabled: boolean) => void;
  /** Enter "assign a workplace" pick mode for the selected settler; absent → the button is inert. */
  readonly onAssignWorkplace?: (settlerId: number) => void;
  /** Take the selected settler off its workplace at once, with no pick mode; absent → the button is
   *  inert. */
  readonly onUnassignWorkplace?: (settlerId: number) => void;
  /** Enter "assign a home" pick mode for the selected settler; absent → the button is inert. */
  readonly onAssignHome?: (settlerId: number) => void;
  /** Remove the selected settler's family from its current home at once, with no pick mode; absent →
   *  the button is inert. */
  readonly onUnassignHome?: (settlerId: number) => void;
  /** Open the equip pick menu for one of the selected settler's equipment slots; absent → the buttons
   *  are inert. */
  readonly onEquipSlot?: (settlerId: number, ref: EquipSlotRef) => void;
  /** Order the worn item in `ref` taken off; absent → the button is inert. */
  readonly onUnequipSlot?: (settlerId: number, ref: EquipSlotRef) => void;
  readonly onSetGatherGood: (entityId: number, goodType: number | null) => void;
  /** Replace a craft worker's product selection (the `setCraftGoods` command); `[]` = every product. */
  readonly onSetCraftGoods: (entityId: number, goods: readonly number[]) => void;
  /** Sprite sheet for the animated worker field; absent → the field stays empty. */
  readonly sheet?: SpriteSheet;
  /** Owner slot → team-colour slot for the worker sprites; absent = identity. */
  readonly playerColourOf?: (player: number) => number;
  /** Select this entity - invoked when the player clicks a worker sprite in the Pracownicy field. */
  readonly onSelectEntity?: (entityId: number) => void;
  readonly onCenterOnEntity: (entityId: number) => void;
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
  dispose(): void;
}

export async function mountUnitPanel(opts: UnitPanelOptions): Promise<UnitPanel> {
  const { app, canvas } = opts;
  const scale = Math.max(MIN_UI_SCALE, opts.uiscale ?? 1);
  const assets = await loadDetailsPanelAssets(opts.lang);
  const stage = createPanelStage({ app, assets, scale });
  // Drawn over the baked panel's Pracownicy field so the workers advance every frame while the panel
  // itself re-bakes at most 4 Hz.
  const workerOverlay = new WorkerSpriteOverlay(app, opts.sheet, WORKER_OVERLAY_Z, opts.playerColourOf);

  const ctx: UnitPanelModelContext = opts;

  let selectedIds: ReadonlySet<number> = new Set();
  /** Bumped by every rebuild; the model and layout the worker overlay reads change only there. */
  let panelEpoch = 0;
  const rebuildGate = createPanelRebuildGate({
    derive: (snapshot) => buildUnitPanelModel(snapshot, selectedIds, ctx),
    now: () => performance.now(),
  });
  let view: PanelView = EMPTY_PANEL_VIEW;
  let hover: PanelHover = NO_PANEL_HOVER;
  /** The last known cursor position over the canvas (client coords), or null after it left, so a rebuild
   *  can refresh a still cursor's tooltip with live values instead of the value it hovered at press. */
  let lastPointer: { clientX: number; clientY: number } | null = null;
  /** The selected stock tab; every new selection reopens on "Wszystkie". */
  let activeStockTab = ALL_STOCK_TAB;

  const rebuild = (model: UnitPanelModel): void => {
    panelEpoch++;
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
    const worker = workerOverlay.hitTest(x, y);
    if (worker !== null) {
      opts.onSelectEntity?.(worker);
      return true;
    }
    const click = panelClickAt(view, x, y, toggleModifier);
    if (click === null) return true;
    switch (click.kind) {
      case 'centerOnEntity':
        opts.onCenterOnEntity(click.entityId);
        break;
      case 'setGatherGood':
        opts.onSetGatherGood(click.entityId, click.goodType);
        break;
      case 'setCraftGoods':
        opts.onSetCraftGoods(click.entityId, click.goods);
        break;
      case 'equipSlot':
        opts.onEquipSlot?.(click.entityId, click.ref);
        break;
      case 'unequipSlot':
        opts.onUnequipSlot?.(click.entityId, click.ref);
        break;
      case 'stockTab':
        if (click.tab !== activeStockTab) {
          activeStockTab = click.tab;
          rebuildCurrent();
        }
        break;
      case 'upgrade':
        opts.onUpgrade(click.entityId);
        break;
      case 'cancelUpgrade':
        opts.onCancelUpgrade(click.entityId);
        break;
      case 'demolish':
        opts.onDemolish(click.entityId);
        break;
      case 'setDefenceMode':
        opts.onSetDefenceMode(click.entityId, click.enabled);
        break;
      case 'demolishSignpost':
        opts.onDemolishSignpost(click.entityId);
        break;
      case 'assignWorkplace':
        opts.onAssignWorkplace?.(click.entityId);
        break;
      case 'unassignWorkplace':
        opts.onUnassignWorkplace?.(click.entityId);
        break;
      case 'assignHome':
        opts.onAssignHome?.(click.entityId);
        break;
      case 'unassignHome':
        opts.onUnassignHome?.(click.entityId);
        break;
      default: {
        const unreachable: never = click;
        throw new Error(`unhandled panel click: ${JSON.stringify(unreachable)}`);
      }
    }
    return true;
  };

  /** Recompute the cursor tooltip. Called on mousemove and after each rebuild, so a held cursor's value
   *  tracks the model at the rebuild cadence rather than per frame. */
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

  let lastWorkersKey = '';

  /** Redraw the animated worker sprites into the live Pracownicy field, or clear them when the selection
   *  isn't a building. Skipped while its inputs hold: it runs every frame over an O(entities) scan. */
  const refreshWorkers = (snapshot: WorldSnapshot): void => {
    const key = `${snapshot.tick}|${app.screen.width}x${app.screen.height}|${panelEpoch}`;
    if (key === lastWorkersKey) return;
    lastWorkersKey = key;
    if (view.kind !== 'building') {
      workerOverlay.update(snapshot, null, null);
      return;
    }
    const b = view.layout.workers.body;
    // The limits strip owns the first row wherever it is drawn; the sprite field takes what is left.
    const siteCrew = view.model.construction !== null;
    const inset = hasWorkerLimitsRow(view.model) ? Math.round(ROW_H * scale) : 0;
    const field: Rect = { x: b.x, y: b.y + inset, w: b.w, h: Math.max(0, b.h - inset) };
    // A home's field draws residents grouped per family (the Mieszkańcy window), not the bound-worker scan.
    const groups = view.model.home?.families.map((f) => f.members);
    workerOverlay.update(snapshot, view.model.entityId, field, {
      siteCrew,
      ...(groups !== undefined ? { groups } : {}),
    });
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
      stage.dispose();
    },
  };
}
