import type { AtlasFrame, SpriteSheet, TextureSource } from '@open-northland/render';
import { fx } from '@open-northland/sim';
import { type Application, Container, Sprite } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { MAX_WORKERS } from '../src/hud/details-panel/worker-selection.js';
import { WorkerSpriteOverlay } from '../src/hud/details-panel/worker-sprites.js';
import { type Ent, snapshotOf } from './support/snapshot.js';

/**
 * The details-panel worker overlay's two contracts with the rest of the frame machinery: which animation
 * clock each drawn worker runs on, and how many display objects it retains. Both are observed through the
 * stage it draws to, over the no-LUT sheet path (a plain `Sprite` per layer, the one draw path that needs
 * no GL program).
 */

const BUILDING = 500;
/** A one-facing, four-frame idle loop at one frame per tick, laid out so the atlas frame's `x` IS the bob
 *  id - so a drawn sprite reads back as `IDLE_START + clock % IDLE_FRAMES`, revealing its clock. */
const IDLE_START = 10;
const IDLE_FRAMES = 4;
const frame = (bob: number): [number, AtlasFrame] => [
  bob,
  { x: bob, y: 0, width: 10, height: 20, offsetX: -5, offsetY: -20 },
];
const SHEET: SpriteSheet = {
  source: {} as TextureSource,
  atlas: {
    width: IDLE_START + IDLE_FRAMES,
    height: 20,
    frames: new Map(Array.from({ length: IDLE_FRAMES }, (_, i) => frame(IDLE_START + i))),
  },
  bindings: {
    settler: { idle: { start: IDLE_START, dirs: 1, stride: IDLE_FRAMES } },
    resource: IDLE_START,
    building: { byType: {}, default: IDLE_START },
  },
};
const FIELD = { x: 0, y: 0, w: 400, h: 60 };

/** A stage-only stand-in: the overlay adds its container to the stage and reads the screen size. */
function stubApp(stage: Container): Application {
  return { stage, screen: { width: 800, height: 600 } } as unknown as Application;
}

function at(x: number, y: number): Record<string, unknown> {
  return { Position: { x: fx.fromInt(x), y: fx.fromInt(y) } };
}

function worker(id: number, extra: Record<string, unknown> = {}): Ent {
  return {
    id,
    components: { Settler: { jobType: 0 }, JobAssignment: { workplace: BUILDING }, ...at(2, 2), ...extra },
  };
}

/** The completed store the workers below staff (no `built` field reads as finished, so it is enterable).
 *  Its id sorts last so a fixture stays in the ascending-id order a real snapshot guarantees. */
const STORE: Ent = { id: BUILDING, components: { Building: { buildingType: 1 }, ...at(2, 2) } };

/** The overlay's visible sprites in paint order, each as the bob id it drew. */
function drawnBobs(stage: Container): number[] {
  const layers = stage.children[0]?.children ?? [];
  return layers.flatMap((c) => (c instanceof Sprite && c.visible ? [c.texture.frame.x] : []));
}

describe('WorkerSpriteOverlay animation clock', () => {
  it('freezes a worker inside the store on its stance frame while one out working animates', () => {
    const stage = new Container();
    const overlay = new WorkerSpriteOverlay(stubApp(stage), SHEET, 0);
    const tick = 5;
    const snapshot = snapshotOf(
      [
        worker(1), // out working - animates on the sim tick
        // Mid-exchange INSIDE the store it staffs. Resolving this needs the store itself, which is why the
        // overlay must hand the builder the whole snapshot: narrowed to the workers, no building is left
        // for the enterable-store scan to find and this worker animates like the one outside.
        worker(2, { CurrentAtomic: { effect: { kind: 'pickup', from: BUILDING, goodType: 1, amount: 1 } } }),
        STORE,
      ],
      tick,
    );

    overlay.update(snapshot, BUILDING, FIELD);

    // One body layer per worker, drawn in slot order.
    expect(drawnBobs(stage)).toEqual([IDLE_START + (tick % IDLE_FRAMES), IDLE_START]);
    overlay.dispose();
  });
});

describe('WorkerSpriteOverlay field selection', () => {
  it('falls through an EMPTY resident grouping to the site crew, rather than blanking the field', () => {
    // A home still going up: it houses nobody (no families), but the crew raising it must still show.
    const stage = new Container();
    const overlay = new WorkerSpriteOverlay(stubApp(stage), SHEET, 0);
    const site: Ent = {
      id: BUILDING,
      components: { Building: { buildingType: 1 }, UnderConstruction: { labor: 0 }, ...at(2, 2) },
    };
    const builder: Ent = {
      id: 1,
      components: { Settler: { jobType: 0 }, SiteAssignment: { site: BUILDING }, ...at(2, 2) },
    };

    overlay.update(snapshotOf([builder, site]), BUILDING, FIELD, { siteCrew: true, groups: [] });

    expect(drawnBobs(stage)).toHaveLength(1);
    overlay.dispose();
  });
});

describe('WorkerSpriteOverlay hit boxes', () => {
  it('answers each slot with the worker drawn there, and stops answering a vacated slot', () => {
    const stage = new Container();
    const overlay = new WorkerSpriteOverlay(stubApp(stage), SHEET, 0);
    const ids = [11, 22, 33];
    // Slot centres: the field packs left-to-right by a fixed cell width from its padded left edge.
    const slotCentre = (slot: number): { x: number; y: number } => {
      const inner = { x: FIELD.x + 4, y: FIELD.y + 4, h: FIELD.h - 8 };
      const slotW = inner.h * 0.72;
      return { x: inner.x + slotW * (slot + 0.5), y: inner.y + inner.h / 2 };
    };

    overlay.update(snapshotOf([...ids.map((id) => worker(id)), STORE], 0), BUILDING, FIELD);
    expect(ids.map((_, slot) => overlay.hitTest(slotCentre(slot).x, slotCentre(slot).y))).toEqual(ids);

    // Pooled sprites are keyed by slot, but a hit box belongs to the worker that filled it: a shorter
    // crew must not leave slot 2 still answering with the settler who stood there a panel ago.
    overlay.update(snapshotOf([worker(44), STORE], 0), BUILDING, FIELD);
    expect(overlay.hitTest(slotCentre(0).x, slotCentre(0).y)).toBe(44);
    expect(overlay.hitTest(slotCentre(2).x, slotCentre(2).y)).toBeNull();

    overlay.dispose();
  });
});

describe('WorkerSpriteOverlay display-object pool', () => {
  /** A staffed building whose `crew` workers all carry ids unique to `round` - the panel one building later. */
  function crew(round: number, size: number): Ent[] {
    return [...Array.from({ length: size }, (_, i) => worker(round * 1000 + i + 1)), STORE];
  }

  /** The overlay's retained display objects - its container is the only child it puts on the stage. */
  function retained(stage: Container): number {
    return stage.children[0]?.children.length ?? 0;
  }

  it('holds its object count across a long sequence of different worker ids', () => {
    const stage = new Container();
    const overlay = new WorkerSpriteOverlay(stubApp(stage), SHEET, 0);

    overlay.update(snapshotOf(crew(0, MAX_WORKERS), 0), BUILDING, FIELD);
    const afterFirstPanel = retained(stage);
    expect(afterFirstPanel).toBeGreaterThan(0); // it really drew - the bound below is not vacuous

    // Every round is a different building with a wholly different crew, as clicking through a settlement
    // is. Keying the pool by entity id grew it by a full crew per round and never released the old ones.
    for (let round = 1; round <= 40; round++) {
      overlay.update(snapshotOf(crew(round, MAX_WORKERS), round), BUILDING, FIELD);
    }
    expect(retained(stage)).toBe(afterFirstPanel);

    // A smaller crew leaves the extra slots pooled-but-hidden, and a full one refills them in place.
    overlay.update(snapshotOf(crew(41, 2), 41), BUILDING, FIELD);
    expect(retained(stage)).toBe(afterFirstPanel);
    overlay.update(snapshotOf(crew(42, MAX_WORKERS), 42), BUILDING, FIELD);
    expect(retained(stage)).toBe(afterFirstPanel);

    overlay.dispose();
  });
});
