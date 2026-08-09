import type { SpriteSheet, TextureSource } from '@open-northland/render';
import { fx } from '@open-northland/sim';
import { type Application, Container } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { JOB_COLLECTOR } from '../src/catalog/jobs.js';
import { BUILDING_HEADQUARTERS, BUILDING_HOME_00 } from '../src/game/sandbox/ids/index.js';
import { buildUnitPanelModel } from '../src/hud/details-panel/index.js';
import { ROW_H } from '../src/hud/details-panel/layout/index.js';
import {
  createWorkerField,
  type WorkerField,
  workerFieldPlan,
} from '../src/hud/details-panel/worker-field.js';
import type { Rect } from '../src/hud/geometry.js';
import { panelModelOf, viewOfKind } from './support/details-panel.js';
import { buildingEntity, sandboxCtx, snapshotOf } from './support/sandbox.js';

const HQ = (scale = 1) =>
  viewOfKind(panelModelOf(buildingEntity(1, BUILDING_HEADQUARTERS)), 'building', scale);

/** A home with one resident, so the residents field draws per family instead of scanning bound workers. */
function occupiedHome() {
  const home = buildingEntity(9, BUILDING_HOME_00);
  const resident = {
    id: 2,
    components: { Settler: { tribe: 1, jobType: JOB_COLLECTOR }, Residence: { home: 9 } },
  };
  const model = buildUnitPanelModel(snapshotOf([home, resident]), new Set([home.id]), sandboxCtx());
  return viewOfKind(model, 'building');
}

describe('details-panel worker field plan', () => {
  it('draws no field for a selection that is not a building', () => {
    const settler = viewOfKind(
      panelModelOf({ id: 1, components: { Settler: { tribe: 1, jobType: JOB_COLLECTOR } } }),
      'settler',
    );

    expect(workerFieldPlan(settler, 1)).toBeNull();
  });

  it('gives the limits strip the first row and the sprites what is left', () => {
    const view = HQ();
    const body = view.layout.workers.body;
    const plan = workerFieldPlan(view, 1);

    expect(plan?.buildingId).toBe(1);
    expect(plan?.field).toEqual({ x: body.x, y: body.y + ROW_H, w: body.w, h: body.h - ROW_H });
  });

  // A real scale is viewportHeight/768 times the user's factor, so it is normally fractional and the
  // inset has to land on the whole px the strip above it was drawn to.
  it('scales the strip inset with the panel, rounded to the row the strip drew', () => {
    const view = HQ(1.5);
    const body = view.layout.workers.body;
    const inset = Math.round(ROW_H * 1.5);
    const plan = workerFieldPlan(view, 1.5);

    expect(inset).not.toBe(ROW_H * 1.5);
    expect(plan?.field.y).toBe(body.y + inset);
    expect(plan?.field.h).toBe(body.h - inset);
  });

  it('lists a home its families, which the bound-worker scan would miss', () => {
    const plan = workerFieldPlan(occupiedHome(), 1);

    expect(plan?.groups).toEqual([[2]]);
    expect(plan?.siteCrew).toBe(false);
  });

  it('shows the raising crew while the building is still a site', () => {
    const raising = buildingEntity(1, BUILDING_HEADQUARTERS, {
      built: 0,
      components: { UnderConstruction: { labor: 0 } },
    });
    const plan = workerFieldPlan(viewOfKind(panelModelOf(raising), 'building'), 1);

    expect(plan?.siteCrew).toBe(true);
  });
});

/** A stage-only stand-in: the field's overlay adds a container to the stage and reads the screen size. */
const stubApp = (stage: Container): Application =>
  ({ stage, screen: { width: 800, height: 600 } }) as unknown as Application;

/** One facing, one frame, so a drawn worker is a plain Sprite over the no-LUT path. */
const BOB = 10;
const SHEET: SpriteSheet = {
  source: {} as TextureSource,
  atlas: {
    width: BOB + 1,
    height: 20,
    frames: new Map([[BOB, { x: BOB, y: 0, width: 10, height: 20, offsetX: -5, offsetY: -20 }]]),
  },
  bindings: {
    settler: { idle: { start: BOB, dirs: 1, stride: 1 } },
    resource: BOB,
    building: { byType: {}, default: BOB },
  },
};

const staffer = (id: number) => ({
  id,
  components: {
    Settler: { tribe: 1, jobType: JOB_COLLECTOR },
    JobAssignment: { workplace: 1 },
    Position: { x: fx.fromInt(2), y: fx.fromInt(2) },
  },
});

/** The HQ staffed by exactly one worker, so who is drawn identifies which scan produced the sprites. */
const crewOf = (workerId: number, tick: number) =>
  snapshotOf([buildingEntity(1, BUILDING_HEADQUARTERS), staffer(workerId)], tick);

/** Who the field says is under the sprite field, found by sweeping the rect the plan placed. */
function drawnWorker(workers: WorkerField, field: Rect): number | null {
  for (let y = field.y; y < field.y + field.h; y += 4) {
    for (let x = field.x; x < field.x + field.w; x += 4) {
      const hit = workers.hitTest(x, y);
      if (hit !== null) return hit;
    }
  }
  return null;
}

describe('details-panel worker field overlay', () => {
  const mount = (): WorkerField =>
    createWorkerField({
      app: stubApp(new Container()),
      scale: 1,
      sheet: SHEET,
      playerColourOf: undefined,
    });
  const FIELD = (): Rect => {
    const plan = workerFieldPlan(HQ(), 1);
    if (plan === null) throw new Error('the HQ view planned no worker field');
    return plan.field;
  };

  it('draws the crew a building is staffed by', () => {
    const workers = mount();
    workers.sync(crewOf(2, 1), HQ());

    expect(drawnWorker(workers, FIELD())).toBe(2);
  });

  it('holds the drawn crew while every gated input stands still', () => {
    const workers = mount();
    const view = HQ();
    workers.sync(crewOf(2, 1), view);

    // Same view object, same tick: the gate skips the O(entities) rescan, so the new crew is not read.
    workers.sync(crewOf(3, 1), view);

    expect(drawnWorker(workers, FIELD())).toBe(2);
  });

  it('rescans once the tick moves under the same view', () => {
    const workers = mount();
    const view = HQ();
    workers.sync(crewOf(2, 1), view);

    workers.sync(crewOf(3, 2), view);

    expect(drawnWorker(workers, FIELD())).toBe(3);
  });

  it('clears the sprites when the selection stops being a building', () => {
    const workers = mount();
    workers.sync(crewOf(2, 1), HQ());

    workers.sync(crewOf(2, 2), viewOfKind(panelModelOf(staffer(2)), 'settler'));

    expect(drawnWorker(workers, FIELD())).toBeNull();
  });
});
