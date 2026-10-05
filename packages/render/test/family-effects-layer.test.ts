import type { Entity } from '@open-northland/sim';
import { Container, type Sprite, type TextureSource } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { ONE, tileToScreen } from '../src/data/projection/index.js';
import { FamilyEffectsLayer } from '../src/gpu/overlays/family-effects-layer.js';
import { TextureCache } from '../src/gpu/texture-cache.js';
import type { SpriteSheet } from '../src/index.js';
import { drawnGeometry, entity, snapshotOf } from './support/fixtures.js';

const source = {} as TextureSource;
const flightFrames = Array.from({ length: 90 }, (_, i) => i + 10);
const sheet: SpriteSheet = {
  source,
  atlas: { width: 0, height: 0, frames: new Map() },
  bindings: {
    settler: 0,
    resource: 0,
    building: 0,
    familyEffects: {
      hearts: { layer: 'family', valencies: [[1, 2]], loop: true, directional: false },
      stork: { layer: 'family', valencies: [flightFrames], loop: false, directional: false },
    },
  },
  families: {
    family: {
      source,
      atlas: {
        width: 512,
        height: 32,
        frames: new Map(
          [1, 2, ...flightFrames].map((i) => [
            i,
            {
              x: i * 4,
              y: 0,
              width: 4,
              height: 8,
              offsetX: i >= 10 ? 100 - i : -2,
              offsetY: -20,
            },
          ]),
        ),
      },
    },
  },
};
const base = tileToScreen(3, 5);
const badge = { id: 1, x: 3 * ONE, y: 5 * ONE, dx: 120, dy: 60, rows: [], hearts: true };
const elevation = { maxLift: 7, liftAt: () => 7, liftAtNode: () => 7 };
const viewport = { minX: -10000, minY: -10000, maxX: 10000, maxY: 10000 };
const drawn = drawnGeometry({ anchorOf: () => base });
const house = (elapsed?: number) =>
  entity(1, 3, 5, {
    Building: { typeId: 1 },
    ...(elapsed === undefined ? {} : { MakingLove: { wife: 2, elapsed, duration: 200 } }),
  });
function setup() {
  const root = new Container();
  const layer = new FamilyEffectsLayer(root, new TextureCache(), sheet);
  const draw = (elapsed?: number, tick = 100, visible = true, view = viewport) =>
    layer.draw({
      snapshot: snapshotOf([house(elapsed)], tick),
      renderTime: tick,
      elevation,
      viewport: view,
      doorBadges: [{ ...badge, hearts: elapsed !== undefined }],
      drawn: visible ? drawn : drawnGeometry(),
    });
  return { root, layer, draw };
}

describe('family effects', () => {
  it('loops the authored hearts at the lifted house base, independently of the sign post', () => {
    const { root, draw } = setup();
    draw(10);
    const first = root.children[0] as Sprite;
    expect(first.texture.frame.x).toBe(4);
    expect(first?.position).toMatchObject({ x: base.x - 2, y: base.y - 27 });
    draw(11, 101);
    expect(root.children[0]).toBe(first);
    expect(first.texture.frame.x).toBe(8);
    draw(12, 102, false);
    expect(root.children).toHaveLength(0);
  });

  it('keeps the approach, delivers at birth and finishes the departure exactly once', () => {
    const { root, layer, draw } = setup();
    draw(124);
    expect(root.children).toHaveLength(1);
    draw(125, 101);
    expect(root.children).toHaveLength(2);
    const stork = root.children[1];
    expect(stork?.x).toBe(base.x + 90);
    draw(150, 126);
    expect(root.children[1]).toBe(stork);
    expect(stork?.x).toBe(base.x + 65);
    layer.ingest([{ kind: 'settlerBorn', entity: 3 as Entity }], 176);
    layer.draw({
      snapshot: snapshotOf([house(), entity(3, 0, 0, { Residence: { home: 1 } })], 176),
      renderTime: 176,
      elevation,
      viewport,
      doorBadges: [{ ...badge, hearts: false }],
      drawn,
    });
    expect(root.children).toEqual([stork]);
    expect(stork?.x).toBe(base.x + 15);
    draw(undefined, 190);
    expect(root.children).toHaveLength(1);
    draw(undefined, 191);
    expect(root.children).toHaveLength(0);
  });

  it('recovers a batched birth at delivery instead of replaying the approach', () => {
    const { root, layer } = setup();
    layer.ingest([{ kind: 'settlerBorn', entity: 3 as Entity }], 200);
    layer.draw({
      snapshot: snapshotOf([house(), entity(3, 0, 0, { Residence: { home: 1 } })], 200),
      renderTime: 200,
      elevation,
      viewport,
      doorBadges: [{ ...badge, hearts: false }],
      drawn,
    });
    expect(root.children).toHaveLength(1);
    expect(root.children[0]?.x).toBe(base.x + 15);
  });

  it('cancels an interrupted approach and hides effects with the house', () => {
    const { root, draw } = setup();
    draw(150);
    expect(root.children).toHaveLength(2);
    draw(151, 101, false);
    expect(root.children).toHaveLength(0);
    draw(152, 102);
    expect(root.children).toHaveLength(2);
    draw(undefined, 103);
    expect(root.children).toHaveLength(0);
  });

  it('culls using the flight frame bounds rather than the house or cropped-frame origin', () => {
    const { root, draw } = setup();
    const flightOnly = { minX: base.x + 91, maxX: base.x + 92, minY: base.y - 24, maxY: base.y - 22 };
    draw(125, 100, true, flightOnly);
    expect(root.children).toHaveLength(1);
    expect(root.children[0]?.x).toBe(base.x + 90);
  });

  it('hides a continuing flight and a birth over a remembered house in fog', () => {
    const { root, layer, draw } = setup();
    draw(150);
    expect(root.children).toHaveLength(2);
    const fogFrame = {
      snapshot: snapshotOf([house(151)], 101),
      renderTime: 101,
      elevation,
      viewport,
      doorBadges: [],
      drawn,
    };
    // A remembered building still has drawn geometry, but no live door badge.
    layer.draw(fogFrame);
    expect(root.children).toHaveLength(0);
    layer.ingest([{ kind: 'settlerBorn', entity: 3 as Entity }], 150);
    layer.draw({
      ...fogFrame,
      renderTime: 150,
      snapshot: snapshotOf([house(), entity(3, 0, 0, { Residence: { home: 1 } })], 150),
    });
    expect(root.children).toHaveLength(0);
  });

  it('draws nothing when the particle art is unavailable', () => {
    const root = new Container();
    const layer = new FamilyEffectsLayer(root, new TextureCache(), undefined);
    layer.ingest([{ kind: 'settlerBorn', entity: 3 as Entity }], 100);
    layer.draw({
      snapshot: snapshotOf([house(150)]),
      renderTime: 1,
      elevation,
      viewport,
      doorBadges: [badge],
      drawn,
    });
    expect(root.children).toHaveLength(0);
    layer.destroy();
  });
});
