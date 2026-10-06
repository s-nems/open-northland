import { Container, TextureSource } from 'pixi.js';
import { expect, it } from 'vitest';
import type { Camera, Viewport } from '../../src/data/projection/index.js';
import type { ElevationField } from '../../src/data/terrain/index.js';
import { HumanPaletteLut } from '../../src/gpu/human-palette-lut.js';
import { PalettedQuad } from '../../src/gpu/paletted-sprite/index.js';
import { type PoolFrame, SpritePool } from '../../src/gpu/sprite-pool/index.js';
import { TextureCache } from '../../src/gpu/texture-cache.js';
import type { SpriteAtlas, SpriteSheet } from '../../src/index.js';
import { entity, snapshotOf } from '../support/fixtures.js';
import { syntheticHumanLut } from '../support/human-palettes.js';

/** A selected settler standing still while the camera pans keeps its bind; its outline must still sit
 *  where its quad snaps for the new camera, not where it snapped for the old one. */

const FLAT: ElevationField = { maxLift: 0, liftAt: () => 0, liftAtNode: () => 0 };
const ALL: Viewport = { minX: -1e6, maxX: 1e6, minY: -1e6, maxY: 1e6 };
const BODY_BOB = 1;
const SETTLER = 1;
/** Device px per screen px the quads snap to. */
const SNAP = 1;
/** A pan step that moves the feet anchor across a device-pixel boundary. */
const PAN_STEP = 0.4;
const indexed = new TextureSource({ width: 64, height: 64 });
const atlas: SpriteAtlas = {
  width: 32,
  height: 32,
  frames: new Map([[BODY_BOB, { x: 0, y: 0, width: 16, height: 32, offsetX: -8, offsetY: -32 }]]),
};

function frameOf(snapshot: ReturnType<typeof snapshotOf>, camera: Camera): PoolFrame {
  return {
    snapshot,
    viewport: ALL,
    tick: snapshot.tick,
    camera,
    screenW: 800,
    screenH: 600,
    elevation: FLAT,
    alpha: 1,
    snapResolution: SNAP,
    selection: new Set([SETTLER]),
    selectionStyle: 'outline',
  };
}

/** Each outline stamp's offset from the body quad it copies. */
function stampOffsets(layer: Container): string[] {
  const entityContainer = layer.children[0] as Container;
  const quad = entityContainer.children.find((c): c is PalettedQuad => c instanceof PalettedQuad);
  const outline = entityContainer.children[0] as Container;
  if (quad === undefined || outline === quad) throw new Error('expected an outlined quad');
  return outline.children
    .filter((stamp) => stamp.visible)
    .map((stamp) => `${(stamp.x - quad.x).toFixed(6)},${(stamp.y - quad.y).toFixed(6)}`);
}

it('keeps an outline on its still body while the camera pans across device pixels', () => {
  const sheet: SpriteSheet = {
    source: indexed,
    atlas: { width: 0, height: 0, frames: new Map() },
    bindings: { settler: BODY_BOB, resource: 1, building: 1 },
    characters: { byJob: {}, default: { body: { source: indexed, atlas }, binding: { idle: BODY_BOB } } },
    palette: syntheticHumanLut(new Map(), HumanPaletteLut.rowsFor(1)),
  };
  const layer = new Container();
  const pool = new SpritePool(layer, new TextureCache(), sheet);
  const snapshot = snapshotOf([entity(SETTLER, 3, 3, { Settler: { tribe: 0 }, Owner: { player: 0 } })]);
  pool.reconcile(frameOf(snapshot, { offsetX: 0, offsetY: 0 }));
  pool.reconcile(frameOf(snapshot, { offsetX: 0, offsetY: 0 }));
  const settled = stampOffsets(layer);
  expect(settled.length).toBeGreaterThan(0);
  for (let step = 1; step <= 3; step++) {
    pool.reconcile(frameOf(snapshot, { offsetX: step * PAN_STEP, offsetY: step * PAN_STEP }));
    expect(stampOffsets(layer)).toEqual(settled);
  }
});
