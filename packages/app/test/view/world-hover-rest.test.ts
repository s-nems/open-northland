// @vitest-environment jsdom
import type { DrawItem, EntityBounds, WorldRenderer } from '@open-northland/render';
import type { WorldSnapshot } from '@open-northland/sim';
import { afterEach, describe, expect, it } from 'vitest';
import type { HoverCard } from '../../src/hud/dom/hover-card.js';
import type {
  BuildingHoverModel,
  HoverCardModel,
  SettlerHoverModel,
} from '../../src/hud/hover-card/model.js';
import { createWorldHover, type WorldHover } from '../../src/view/world-hover.js';

const HOUSE = 1;
const FIGHTER = 2;
const WALL = 3;
/** A worker whose sign row hangs on the house. */
const WORKER = 4;
/** One rendered frame at 60 fps. */
const FRAME_MS = 16;
/** Longer than the card's rest. */
const PAST_REST_MS = 400;
/** Less than a pixel: the pointer still lies on the same targets, but the view has moved. */
const CAMERA_NUDGE_PX = 0.5;

const HOUSE_BOX: EntityBounds = { minX: -40, minY: -100, maxX: 40, maxY: 0 };
/** The fighter's swing reaches over the house's middle. */
const SWING_BOX: EntityBounds = { minX: -10, minY: -60, maxX: 10, maxY: -20 };
const AT_REST: EntityBounds = { minX: 60, minY: -60, maxX: 80, maxY: -20 };
/** A wall post standing in front of the house's middle. */
const WALL_BOX: EntityBounds = { minX: -5, minY: -50, maxX: 5, maxY: -10 };
/** On the house, under the swing and the post. */
const ON_HOUSE = { clientX: 0, clientY: -40 };

function card(): HoverCard & { readonly title: () => string | null } {
  let shown: HoverCardModel | null = null;
  return {
    show: (_x, _y, model) => {
      shown = model;
    },
    hide: () => {
      shown = null;
    },
    showing: () => shown,
    dispose: () => {},
    title: () => shown?.title ?? null,
  };
}

function snapshot(tick: number): WorldSnapshot {
  return {
    tick,
    events: [],
    entities: [
      { id: FIGHTER, components: { Settler: { jobType: 0 }, Person: {} } },
      { id: WALL, components: { Palisade: { gate: null } } },
    ],
  };
}

/** `alternate`: the fighter swings over the house on every other frame; `held`: on every frame; `away`:
 *  never. */
type Swing = 'alternate' | 'held' | 'away';

describe('world hover', () => {
  let hover: WorldHover | null = null;
  afterEach(() => hover?.destroy());

  function setup(opts: { readonly wall?: 'hovers' | 'own'; readonly signRow?: boolean } = {}) {
    let rowCovered = false;
    const pointer = { ...ON_HOUSE };
    const camera = { offsetX: 0, offsetY: 0, scale: 1 };
    let swinging = false;
    let suppressed = false;
    const items: DrawItem[] = [
      { kind: 'building', ref: HOUSE, x: 0, y: 0, depth: 0 } as DrawItem,
      { kind: 'settler', ref: FIGHTER, x: 70, y: 0, depth: 1 } as DrawItem,
    ];
    if (opts.wall !== undefined)
      items.push({ kind: 'palisade', ref: WALL, x: 0, y: 1, depth: 2 } as DrawItem);
    const bounds = (ref: number): EntityBounds =>
      ref === HOUSE ? HOUSE_BOX : ref === WALL ? WALL_BOX : swinging ? SWING_BOX : AT_REST;
    const renderer = { drawnItems: () => items, entityBounds: bounds } as unknown as WorldRenderer;
    const shown = card();
    hover = createWorldHover({
      renderer,
      camera: () => camera,
      clientToScreen: (x, y) => ({ x, y }),
      card: shown,
      buildingModel: (_s, id) => ({ kind: 'building', title: `house ${id}` }) as BuildingHoverModel,
      settlerModel: (_s, id) => ({ kind: 'settler', title: `fighter ${id}` }) as SettlerHoverModel,
      settlerProxyAt: () => (opts.signRow === true ? { ref: WORKER, covered: rowCovered } : null),
      vehicleModel: () => null,
      palisadeModel: (_s, id) => ({ kind: 'building', title: `wall ${id}` }) as BuildingHoverModel,
      wallHovers: () => opts.wall === 'hovers',
      modelVersion: () => 0,
      pixelHitOf: undefined,
      pointer: () => pointer,
      suppressed: () => suppressed,
    });
    let tick = 0;
    const run = (ms: number, swing: Swing = 'alternate'): void => {
      const start = tick * FRAME_MS;
      while (tick * FRAME_MS - start < ms) {
        swinging = swing === 'held' || (swing === 'alternate' && tick % 2 === 1);
        rowCovered = opts.signRow === true && swinging;
        hover?.update(snapshot(tick), tick * FRAME_MS);
        tick += 1;
      }
    };
    const suppress = (on: boolean): void => {
      suppressed = on;
    };
    return { shown, run, pointer, camera, items, suppress };
  }

  it('keeps the card on a house while a fighter swings across the resting pointer', () => {
    const { shown, run } = setup();
    run(PAST_REST_MS);
    expect(shown.title()).toBe(`house ${HOUSE}`);
  });

  it('picks the frontmost target again once the pointer moves', () => {
    const { shown, run, pointer } = setup();
    run(PAST_REST_MS);
    run(PAST_REST_MS, 'held');
    expect(shown.title()).toBe(`house ${HOUSE}`);

    // Onto the fighter, drawn in front of the house.
    pointer.clientX = 5;
    pointer.clientY = -30;
    run(PAST_REST_MS, 'held');
    expect(shown.title()).toBe(`fighter ${FIGHTER}`);
  });

  it("opens the worker's card over its sign row on the house", () => {
    const { shown, run } = setup({ signRow: true });
    run(PAST_REST_MS, 'away');
    expect(shown.title()).toBe(`fighter ${WORKER}`);
  });

  it("keeps the worker's card while a passer-by covers its sign row under a resting pointer", () => {
    const { shown, run } = setup({ signRow: true });
    run(PAST_REST_MS, 'away');
    // The fighter swings over the row on every other frame, covering it each time.
    run(PAST_REST_MS);
    expect(shown.title()).toBe(`fighter ${WORKER}`);
  });

  it('picks again once the camera moves under a resting pointer', () => {
    const { shown, run, camera } = setup();
    run(PAST_REST_MS, 'away');
    run(PAST_REST_MS, 'held');
    expect(shown.title()).toBe(`house ${HOUSE}`);

    camera.offsetX = CAMERA_NUDGE_PX;
    run(PAST_REST_MS, 'held');
    expect(shown.title()).toBe(`fighter ${FIGHTER}`);
  });

  it('lets go of a held target that leaves the drawn list, and of everything while suppressed', () => {
    const { shown, run, items, suppress } = setup();
    run(PAST_REST_MS, 'away');
    run(PAST_REST_MS, 'held');
    expect(shown.title()).toBe(`house ${HOUSE}`);

    items.splice(
      items.findIndex((item) => item.ref === HOUSE),
      1,
    );
    run(PAST_REST_MS, 'held');
    expect(shown.title()).toBe(`fighter ${FIGHTER}`);

    suppress(true);
    run(FRAME_MS);
    expect(shown.title()).toBeNull();
  });

  it("opens another seat's wall's card in front of a house", () => {
    const { shown, run } = setup({ wall: 'hovers' });
    run(PAST_REST_MS, 'away');
    expect(shown.title()).toBe(`wall ${WALL}`);
  });

  it("lets the house behind the viewer's own wall answer the pointer", () => {
    const { shown, run } = setup({ wall: 'own' });
    run(PAST_REST_MS, 'away');
    expect(shown.title()).toBe(`house ${HOUSE}`);
  });
});
