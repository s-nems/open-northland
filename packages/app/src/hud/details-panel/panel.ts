import type { UiCue } from '@open-northland/audio';
import type { PortraitInsetFrame } from '@open-northland/render';
import type { WorldSnapshot } from '@open-northland/sim';
import type { Application } from 'pixi.js';
import { clientToCanvas, contains } from '../geometry.js';
import { MIN_UI_SCALE } from '../ui-scale.js';
import { loadDetailsPanelAssets } from './assets.js';
import { applyPanelClick, type PanelClickActions } from './click-actions.js';
import {
  buildUnitPanelModel,
  settlerStateHold,
  type UnitPanelModel,
  type UnitPanelModelContext,
} from './model/index.js';
import { NO_PANEL_HOVER, type PanelHover, panelClickAt, panelHoverAt, sameHover } from './pointer-intent.js';
import { createPanelRebuildGate } from './rebuild-gate.js';
import { EMPTY_PANEL_VIEW, type PanelView, panelViewFor } from './selection-view.js';
import { createPanelStage } from './stage.js';

/** Owns the selection and hover state the model, layout and stage read. The panel draws palisades; it derives every selection's model and hands it to the DOM panels. */

/** A live cutout's rect, in on-screen px, plus the entity the observation window centres on. */
export type PortraitBox = PortraitInsetFrame;

export interface UnitPanelOptions extends UnitPanelModelContext, PanelClickActions {
  readonly app: Application;
  readonly canvas: HTMLCanvasElement;
  /** The resolved HUD scale, shared with the left tool panel and action ring. May be fractional. */
  readonly uiscale?: number;
  readonly lang: string;
  /** Bumped when a sim read the model takes (the context's seams) lands anew. */
  readonly answersVersion?: () => number;
  /** Client→canvas coordinate mapping, injected so the hud layer stays view-free. */
  readonly backingScale: (canvas: HTMLCanvasElement) => { sx: number; sy: number; rect: DOMRect };
  /** Every model the rebuild gate lets through: the DOM panels show the selections this panel leaves blank. */
  readonly onModel?: (model: UnitPanelModel) => void;
  /** The GUI click every pressed panel button confirms with; absent, silent. */
  readonly onUiCue?: (cue: UiCue) => void;
}

export interface UnitPanel {
  render(snapshot: WorldSnapshot, selected: ReadonlySet<number>): void;
  tick(snapshot: WorldSnapshot): void;
  claimsPointer(clientX: number, clientY: number): boolean;
  /** Returns true when the point is over the panel, so the caller must not world-pick it; a left press
   *  on an enabled button performs its action. */
  handleMouseDown(clientX: number, clientY: number, button: number): boolean;
  dispose(): void;
}

export async function mountUnitPanel(opts: UnitPanelOptions): Promise<UnitPanel> {
  const { app, canvas } = opts;
  const scale = Math.max(MIN_UI_SCALE, opts.uiscale ?? 1);
  const assets = await loadDetailsPanelAssets();
  const stage = createPanelStage({ app, assets, scale });

  const ctx: UnitPanelModelContext = { ...opts, holdSettlerState: settlerStateHold() };

  let selectedIds: ReadonlySet<number> = new Set();
  const rebuildGate = createPanelRebuildGate({
    derive: (snapshot) => buildUnitPanelModel(snapshot, selectedIds, ctx),
    now: () => performance.now(),
    ...(opts.answersVersion !== undefined ? { answersVersion: opts.answersVersion } : {}),
  });
  let view: PanelView = EMPTY_PANEL_VIEW;
  /** The model the gate last handed out. */
  let liveModel: UnitPanelModel | null = null;
  let hover: PanelHover = NO_PANEL_HOVER;

  const rebuild = (model: UnitPanelModel): void => {
    rebuildGate.rebuilt();
    liveModel = model;
    view = panelViewFor(model, app.screen, scale);
    stage.paint(view, hover);
  };

  const updateModel = (snapshot: WorldSnapshot, force = false): void => {
    const next = rebuildGate.decide(snapshot, app.screen, force);
    if (next === null) return;
    opts.onModel?.(next.model);
    rebuild(next.model);
  };

  const toCanvas = (clientX: number, clientY: number): { x: number; y: number } =>
    clientToCanvas(opts.backingScale(canvas), clientX, clientY);

  const claimsPointer = (clientX: number, clientY: number): boolean => {
    if (view.kind === 'empty') return false;
    const { x, y } = toCanvas(clientX, clientY);
    return contains(view.layout.panel, x, y);
  };

  const handleMouseDown = (clientX: number, clientY: number, button: number): boolean => {
    if (!claimsPointer(clientX, clientY)) return false;
    if (button !== 0) return true; // over the panel - swallow, but only the left button acts
    const { x, y } = toCanvas(clientX, clientY);
    const click = panelClickAt(view, x, y);
    if (click !== null) {
      opts.onUiCue?.('confirm');
      applyPanelClick(click, opts);
    }
    return true;
  };

  /** A hover re-bakes the drawn selection; inert while empty. */
  const setHover = (next: PanelHover): void => {
    if (sameHover(next, hover)) return;
    hover = next;
    if (view.kind !== 'empty' && liveModel !== null) rebuild(liveModel);
  };

  const onMouseMove = (e: MouseEvent): void => {
    const { x, y } = toCanvas(e.clientX, e.clientY);
    setHover(panelHoverAt(view, x, y));
  };
  const onMouseLeave = (): void => setHover(NO_PANEL_HOVER);

  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('mouseleave', onMouseLeave);

  return {
    render(snapshot, selected): void {
      selectedIds = new Set(selected);
      updateModel(snapshot, true);
    },
    tick(snapshot): void {
      updateModel(snapshot);
    },
    claimsPointer,
    handleMouseDown,
    dispose(): void {
      canvas.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('mouseleave', onMouseLeave);
      stage.dispose();
    },
  };
}
