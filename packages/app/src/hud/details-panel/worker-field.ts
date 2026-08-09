import type { SpriteSheet } from '@open-northland/render';
import type { WorldSnapshot } from '@open-northland/sim';
import type { Application } from 'pixi.js';
import type { Rect } from '../geometry.js';
import { ROW_H } from './layout/index.js';
import { hasWorkerLimitsRow } from './sections/building/workers.js';
import type { PanelView } from './selection-view.js';
import { WORKER_OVERLAY_Z } from './stage.js';
import { WorkerSpriteOverlay } from './worker-sprites.js';

export interface WorkerFieldPlan {
  readonly buildingId: number;
  /** Where the sprites stand, in screen px. */
  readonly field: Rect;
  /** Draw the crew raising the site rather than the finished building's posted staff. */
  readonly siteCrew: boolean;
  /** One id list per family, for a home's residents field; absent → the bound-worker scan. */
  readonly groups?: readonly (readonly number[])[];
}

export function workerFieldPlan(view: PanelView, scale: number): WorkerFieldPlan | null {
  if (view.kind !== 'building') return null;
  const body = view.layout.workers.body;
  // The limits strip owns the first row wherever it is drawn; the sprite field takes what is left.
  const inset = hasWorkerLimitsRow(view.model) ? Math.round(ROW_H * scale) : 0;
  const groups = view.model.home?.families.map((f) => f.members);
  return {
    buildingId: view.model.entityId,
    field: { x: body.x, y: body.y + inset, w: body.w, h: Math.max(0, body.h - inset) },
    siteCrew: view.model.construction !== null,
    ...(groups !== undefined ? { groups } : {}),
  };
}

export interface WorkerField {
  /** Inert while the drawn inputs hold, so a caller may call it every frame. */
  sync(snapshot: WorldSnapshot, view: PanelView): void;
  hitTest(x: number, y: number): number | null;
  dispose(): void;
}

export interface WorkerFieldOptions {
  readonly app: Application;
  readonly scale: number;
  readonly sheet: SpriteSheet | undefined;
  readonly playerColourOf: ((player: number) => number) | undefined;
}

/** Sprites over the baked panel's Pracownicy field: they advance every sim tick, while the panel's own
 *  value-driven re-bakes stay throttled. */
export function createWorkerField(opts: WorkerFieldOptions): WorkerField {
  const { app, scale } = opts;
  const overlay = new WorkerSpriteOverlay(app, opts.sheet, WORKER_OVERLAY_Z, opts.playerColourOf);
  let lastView: PanelView | null = null;
  let lastTick = -1;
  let lastWidth = -1;
  let lastHeight = -1;

  return {
    sync(snapshot, view): void {
      // A redraw costs an O(entities) scan. A rebuild replaces the view object, so its identity stands
      // for the model and layout the sprites are placed from.
      if (
        view === lastView &&
        snapshot.tick === lastTick &&
        app.screen.width === lastWidth &&
        app.screen.height === lastHeight
      ) {
        return;
      }
      lastView = view;
      lastTick = snapshot.tick;
      lastWidth = app.screen.width;
      lastHeight = app.screen.height;
      const plan = workerFieldPlan(view, scale);
      if (plan === null) {
        overlay.update(snapshot, null, null);
        return;
      }
      overlay.update(snapshot, plan.buildingId, plan.field, {
        siteCrew: plan.siteCrew,
        ...(plan.groups !== undefined ? { groups: plan.groups } : {}),
      });
    },
    hitTest: (x, y) => overlay.hitTest(x, y),
    dispose: () => {
      overlay.dispose();
    },
  };
}
