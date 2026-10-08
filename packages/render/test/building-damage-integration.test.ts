import { type Entity, ONE } from '@open-northland/sim';
import { Container, Sprite, type Texture, TextureSource } from 'pixi.js';
import { afterEach, expect, it, vi } from 'vitest';
import { COLLAPSE_LIFETIME_TICKS, COLLAPSE_TICKS } from '../src/data/effects/collapse.js';
import type { ElevationField } from '../src/data/terrain/index.js';
import * as drawable from '../src/gpu/drawable-resource.js';
import { CollapseLayer } from '../src/gpu/overlays/collapse-layer.js';
import { type PoolFrame, SpritePool } from '../src/gpu/sprite-pool/index.js';
import { SelectionSprite } from '../src/gpu/sprite-selection-effect.js';
import type { SpriteSheet } from '../src/gpu/sprite-sheet.js';
import { TextureCache } from '../src/gpu/texture-cache.js';
import { entity, snapshotOf } from './support/fixtures.js';

const REF = 1 as Entity;
const SIZE = 100;
const FLAT: ElevationField = { maxLift: 0, liftAt: () => 0, liftAtNode: () => 0 };
const VIEW = { minX: -1000, minY: -1000, maxX: 1000, maxY: 1000 };

function mockCanvas(): void {
  vi.spyOn(drawable, 'isDrawableResource').mockReturnValue(true);
  vi.spyOn(drawable, 'readable2dContext').mockImplementation(
    (width, height) =>
      ({
        canvas: { width, height },
        clearRect: vi.fn(),
        drawImage: vi.fn(),
        putImageData: vi.fn(),
        createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
        getImageData: (_x: number, _y: number, w: number, h: number) => {
          const data = new Uint8ClampedArray(w * h * 4);
          for (let at = 0; at < data.length; at += 4) data.set([150, 110, 80, 255], at);
          return { data };
        },
      }) as unknown as CanvasRenderingContext2D,
  );
}

function frame(hitpoints: number | null, tick: number): PoolFrame {
  const house = entity(REF, 0, 0, {
    Building: { buildingType: 1, tribe: 1, built: ONE, level: 0 },
    Health: { hitpoints, max: 1000 },
  });
  return {
    snapshot: snapshotOf(hitpoints === null ? [] : [house], tick),
    tick,
    viewport: VIEW,
    camera: { offsetX: 0, offsetY: 0 },
    screenW: 800,
    screenH: 600,
    elevation: FLAT,
    alpha: 0,
    buildingDamage: true,
    selection: new Set([REF]),
    selectionStyle: 'outline',
  };
}

/** The selected body's stamps must follow its current texture before the next world render. */
function selectedTexture(layer: Container): Texture {
  const house = layer.children[0];
  if (house === undefined) throw new Error('Missing selected house');
  const body = house.children.find((child) => child instanceof SelectionSprite);
  if (!(body instanceof SelectionSprite)) throw new Error('Missing building body');
  const outline = house.children[0];
  expect(outline?.children).toHaveLength(16);
  for (const stamp of outline?.children ?? []) {
    expect(stamp).toBeInstanceOf(SelectionSprite);
    if (!(stamp instanceof SelectionSprite)) throw new Error('Missing outline stamp');
    expect(stamp.texture).toBe(body.texture);
    expect(stamp.texture.destroyed).toBe(false);
  }
  return body.texture;
}

afterEach(() => vi.restoreAllMocks());

it('keeps selected textures current through live settings and repair, then leases the damaged body through collapse', () => {
  mockCanvas();
  const source = new TextureSource({ width: SIZE, height: SIZE });
  const sheet: SpriteSheet = {
    source,
    atlas: {
      width: SIZE,
      height: SIZE,
      frames: new Map([[1, { x: 0, y: 0, width: SIZE, height: SIZE, offsetX: -SIZE / 2, offsetY: -SIZE }]]),
    },
    bindings: { building: 1, settler: 1, resource: 1 },
  };
  const layer = new Container();
  const textures = new TextureCache();
  const pool = new SpritePool(layer, textures, sheet);
  const collapses = new CollapseLayer(layer, textures, sheet, (ref) => pool.captureBuildingDamage(ref));
  try {
    pool.reconcile(frame(1000, 1));
    const pristine = selectedTexture(layer);
    const damagedFrame = frame(100, 2);
    pool.reconcile(damagedFrame);
    const firstBake = selectedTexture(layer);
    expect(firstBake).not.toBe(pristine);

    // The same snapshot and clock exercise a setting flip while paused.
    pool.reconcile({ ...damagedFrame, buildingDamage: false });
    expect(selectedTexture(layer)).toBe(pristine);
    expect(firstBake.destroyed).toBe(true);
    pool.reconcile(damagedFrame);
    const secondBake = selectedTexture(layer);
    expect(secondBake).not.toBe(pristine);

    pool.reconcile(frame(1000, 3));
    expect(selectedTexture(layer)).toBe(pristine);
    expect(secondBake.destroyed).toBe(true);
    pool.reconcile(frame(100, 4));
    const lastBake = selectedTexture(layer);
    expect(lastBake).not.toBe(pristine);

    // The runtime ingests events before reconciling the snapshot that has lost the building.
    const deathTick = 5;
    collapses.ingest(
      [
        {
          kind: 'buildingDestroyed',
          entity: REF,
          player: 0,
          tribe: 1,
          buildingType: 1,
          built: ONE,
          at: { hx: 0, hy: 0 },
        },
      ],
      deathTick,
    );
    pool.reconcile(frame(null, deathTick));
    expect(layer.children).toHaveLength(0);
    expect(lastBake.destroyed).toBe(false);
    collapses.draw(FLAT, VIEW, deathTick);
    expect(layer.children).toHaveLength(1);
    const body = layer.children[0]?.children[0];
    if (!(body instanceof Sprite)) throw new Error('Missing collapsing body');
    const collapseView = body.texture;
    expect(collapseView.source).toBe(lastBake.source);
    expect(collapseView.frame).toEqual(lastBake.frame);
    expect(body.position).toMatchObject({ x: -SIZE / 2, y: -SIZE });

    collapses.draw(FLAT, VIEW, deathTick + COLLAPSE_TICKS / 2);
    expect(collapseView.frame.height).toBe(SIZE / 2);
    expect(lastBake.frame.height).toBe(SIZE);
    expect(lastBake.destroyed).toBe(false);
    const expiry = deathTick + COLLAPSE_LIFETIME_TICKS;
    collapses.ingest([], expiry);
    collapses.draw(FLAT, VIEW, expiry);
    expect(layer.children).toHaveLength(0);
    expect(lastBake.destroyed).toBe(true);
    expect(collapseView.destroyed).toBe(true);
  } finally {
    collapses.destroy();
    pool.destroy();
    textures.clear();
    source.destroy();
    layer.destroy({ children: true });
  }
});
