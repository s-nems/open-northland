// @vitest-environment jsdom
import type { DrawItem, EntityBounds, WorldRenderer } from '@open-northland/render';
import type { WorldSnapshot } from '@open-northland/sim';
import { afterEach, describe, expect, it } from 'vitest';
import type { HoverCard } from '../../src/hud/dom/hover-card.js';
import type { BuildingHoverModel } from '../../src/hud/hover-card/model.js';
import { createWorldHover, type WorldHover } from '../../src/view/world-hover.js';

/** A row of houses, each in its own box, the pointer over one of them. */
const HOUSES = 50;
const HOUSE_SPACING = 100;
const HOUSE_HALF_WIDTH = 40;
const HOUSE_HEIGHT = 80;
const POINTED_HOUSE = 7;
/** Longer than the card's rest. */
const PAST_REST_MS = 400;
const FRAME_MS = 16;

describe('world hover scan', () => {
  let hover: WorldHover | null = null;
  afterEach(() => hover?.destroy());

  it('tests the pixels of the houses under the pointer alone, every frame while it rests', () => {
    const items = Array.from(
      { length: HOUSES },
      (_, i) => ({ kind: 'building', ref: i + 1, x: i * HOUSE_SPACING, y: 0, depth: i }) as DrawItem,
    );
    const boxOf = (ref: number): EntityBounds => {
      const x = (ref - 1) * HOUSE_SPACING;
      return { minX: x - HOUSE_HALF_WIDTH, minY: -HOUSE_HEIGHT, maxX: x + HOUSE_HALF_WIDTH, maxY: 0 };
    };
    const tested: number[] = [];
    let shown: string | null = null;
    const card: HoverCard = {
      show: (_x, _y, model) => {
        shown = model.title;
      },
      hide: () => {
        shown = null;
      },
      showing: () => null,
      dispose: () => {},
    };
    const snapshot: WorldSnapshot = { tick: 1, events: [], entities: [] };
    hover = createWorldHover({
      renderer: { drawnItems: () => items, entityBounds: boxOf } as unknown as WorldRenderer,
      camera: () => ({ offsetX: 0, offsetY: 0, scale: 1 }),
      clientToScreen: (x, y) => ({ x, y }),
      goodLabel: () => undefined,
      chestLabel: () => '',
      chestOrderLine: () => null,
      card,
      buildingModel: (_s, id) => ({ kind: 'building', title: `house ${id}` }) as BuildingHoverModel,
      settlerModel: () => null,
      vehicleModel: () => null,
      palisadeModel: () => null,
      wallHovers: () => false,
      modelVersion: () => 0,
      pixelHitOf: (ref) => {
        tested.push(ref);
        return true;
      },
      pointer: () => ({ clientX: (POINTED_HOUSE - 1) * HOUSE_SPACING, clientY: -HOUSE_HEIGHT / 2 }),
      suppressed: () => false,
    });
    let frames = 0;
    for (let ms = 0; ms <= PAST_REST_MS; ms += FRAME_MS, frames++) hover.update(snapshot, ms);
    expect(shown).toBe(`house ${POINTED_HOUSE}`);
    // Every frame tests the live pixels again, since a sprite moves and animates within a tick.
    expect(tested).toEqual(Array.from({ length: frames }, () => POINTED_HOUSE));
  });

  it('names the card target for the hover outline, and nothing behind a chip or a claim', () => {
    const HOUSE = 1;
    const SETTLER = 2;
    const CHEST = 3;
    const PILE = 4;
    const pointed = (x: number): { clientX: number; clientY: number } => ({ clientX: x, clientY: -20 });
    const items: DrawItem[] = [
      { kind: 'building', ref: HOUSE, x: 0, y: 0, depth: 0 },
      { kind: 'settler', ref: SETTLER, x: 200, y: 0, depth: 1 },
      { kind: 'chest', ref: CHEST, x: 400, y: 0, depth: 2 },
      { kind: 'grounddrop', ref: PILE, x: 600, y: 0, depth: 3, goodType: 7 },
    ] as unknown as DrawItem[];
    const bounds = (ref: number): EntityBounds => {
      const x = (ref - 1) * 200;
      return { minX: x - 50, minY: -40, maxX: x + 50, maxY: 0 };
    };
    const card: HoverCard = { show: () => {}, hide: () => {}, showing: () => null, dispose: () => {} };
    const snapshot: WorldSnapshot = {
      tick: 1,
      events: [],
      entities: [
        { id: SETTLER, components: { Settler: { jobType: 0 }, Person: {} } },
        { id: CHEST, components: { Chest: { kind: 'wooden' } } },
      ],
    };
    let pointer = pointed(0);
    let claim = false;
    hover = createWorldHover({
      renderer: { drawnItems: () => items, entityBounds: bounds } as unknown as WorldRenderer,
      camera: () => ({ offsetX: 0, offsetY: 0, scale: 1 }),
      clientToScreen: (x, y) => ({ x, y }),
      goodLabel: () => 'Wood',
      chestLabel: () => 'Chest',
      chestOrderLine: () => null,
      card,
      buildingModel: () => ({ kind: 'building', title: 'house' }) as BuildingHoverModel,
      settlerModel: () => null,
      vehicleModel: () => null,
      palisadeModel: () => null,
      wallHovers: () => false,
      modelVersion: () => 0,
      pixelHitOf: undefined,
      pointer: () => pointer,
      suppressed: () => claim,
    });
    hover.update(snapshot, 0);
    expect(hover.hovered()).toBe(HOUSE); // a building takes the outline

    pointer = pointed(200);
    hover.update(snapshot, FRAME_MS);
    expect(hover.hovered()).toBe(SETTLER); // a settler too

    pointer = pointed(400);
    hover.update(snapshot, 2 * FRAME_MS);
    expect(hover.hovered()).toBeNull(); // a chest shows the chip alone

    pointer = pointed(600);
    hover.update(snapshot, 3 * FRAME_MS);
    expect(hover.hovered()).toBeNull(); // a good pile as well

    pointer = pointed(0);
    hover.update(snapshot, 4 * FRAME_MS);
    expect(hover.hovered()).toBe(HOUSE);
    claim = true;
    hover.update(snapshot, 5 * FRAME_MS);
    expect(hover.hovered()).toBeNull(); // a claimed pointer holds no outline
  });
});
