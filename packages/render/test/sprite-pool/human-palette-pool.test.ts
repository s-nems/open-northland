import type { Entity } from '@open-northland/sim';
import { Container, TextureSource } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';
import type { Viewport } from '../../src/data/projection/index.js';
import type { ElevationField } from '../../src/data/terrain/index.js';
import { HumanPaletteLut } from '../../src/gpu/human-palette-lut.js';
import { PalettedQuad } from '../../src/gpu/paletted-sprite/index.js';
import { LayerBinder } from '../../src/gpu/sprite-pool/bind-layers.js';
import { type PoolFrame, SpritePool } from '../../src/gpu/sprite-pool/index.js';
import { spriteBloodEffect } from '../../src/gpu/sprite-selection-effect.js';
import { TextureCache } from '../../src/gpu/texture-cache.js';
import type { SpriteAtlas, SpriteSheet } from '../../src/index.js';
import { entity, snapshotOf } from '../support/fixtures.js';
import { syntheticHumanLut } from '../support/human-palettes.js';

/**
 * The sprite pool asks the human LUT for every drawn human's row each frame, whether or not it rebinds
 * the human, and flushes the LUT once the frame's rows are all asked for.
 */

const FLAT: ElevationField = { maxLift: 0, liftAt: () => 0, liftAtNode: () => 0 };
const BODY_BOB = 1;
const CHAIN_MAIL = 35;
const CHAIN_TIER = 1;
/** Two private humans past the shared and team rows. */
const PRIVATE_HUMANS = 2;
const SMALL_ROWS = HumanPaletteLut.rowsFor(PRIVATE_HUMANS);
/** Tiles far enough apart that a viewport can hold one group and not the other. */
const WEST = 0;
const EAST = 100;
const SPLIT_X = 3000;
const ALL: Viewport = { minX: -1e6, maxX: 1e6, minY: -1e6, maxY: 1e6 };
const WEST_ONLY: Viewport = { ...ALL, maxX: SPLIT_X };
const EAST_ONLY: Viewport = { ...ALL, minX: SPLIT_X };
const ROW_BYTES = 256 * 4;
const TEAM_TEXEL = 15 * 16;

const indexed = new TextureSource({ width: 64, height: 64 });
const atlas: SpriteAtlas = {
  width: 32,
  height: 32,
  frames: new Map([[BODY_BOB, { x: 0, y: 0, width: 16, height: 32, offsetX: -8, offsetY: -32 }]]),
};

function poolWith(lut: HumanPaletteLut): { pool: SpritePool; layer: Container } {
  const sheet: SpriteSheet = {
    source: indexed,
    atlas: { width: 0, height: 0, frames: new Map() },
    bindings: { settler: BODY_BOB, resource: 1, building: 1 },
    characters: { byJob: {}, default: { body: { source: indexed, atlas }, binding: { idle: BODY_BOB } } },
    palette: lut,
  };
  const layer = new Container();
  return { pool: new SpritePool(layer, new TextureCache(), sheet), layer };
}

const human = (id: number, tileX: number, extra: Record<string, unknown> = {}) =>
  entity(id, tileX, id, { Settler: { tribe: 0 }, Owner: { player: 0 }, ...extra });

function frameOf(snapshot: ReturnType<typeof snapshotOf>, viewport: Viewport = ALL): PoolFrame {
  return {
    snapshot,
    viewport,
    tick: snapshot.tick,
    camera: { offsetX: 0, offsetY: 0 },
    screenW: 800,
    screenH: 600,
    elevation: FLAT,
    alpha: 1,
  };
}

/** The body quad rows of the drawn humans, west of the split or east of it. */
function rowsIn(layer: Container, side: 'west' | 'east'): number[] {
  const rows: number[] = [];
  for (const child of layer.children) {
    const container = child as Container;
    if (!container.visible || container.position.x < SPLIT_X !== (side === 'west')) continue;
    const quad = container.children.find((c): c is PalettedQuad => c instanceof PalettedQuad);
    if (quad !== undefined) rows.push(quad.lutRow);
  }
  return rows;
}

function teamTexel(lut: HumanPaletteLut, row: number): number[] {
  const bytes = lut.source.resource as Uint8Array;
  const at = row * ROW_BYTES + TEAM_TEXEL * 4;
  return [bytes[at] ?? -1, bytes[at + 1] ?? -1, bytes[at + 2] ?? -1];
}

describe('the sprite pool over the human palette LUT', () => {
  it('keeps the row of a human whose bind is skipped, so a newcomer never takes it', () => {
    const lut = syntheticHumanLut(new Map(), SMALL_ROWS);
    const { pool, layer } = poolWith(lut);
    // The kept human has the highest id, so the newcomers ask for rows before it does next frame.
    const alone = snapshotOf([human(3, WEST)]);
    for (let i = 0; i < 3; i++) pool.reconcile(frameOf(alone));
    const [row] = rowsIn(layer, 'west');
    expect(lut.stats.composed).toBe(1);

    pool.reconcile(frameOf(snapshotOf([human(1, EAST), human(2, EAST), human(3, WEST)], 2)));
    expect(rowsIn(layer, 'west')).toEqual([row]);
    expect(rowsIn(layer, 'east')).not.toContain(row);
  });

  it('recomposes an owner or armor change in the same row', () => {
    const lut = syntheticHumanLut(new Map([[CHAIN_MAIL, CHAIN_TIER]]), SMALL_ROWS);
    const { pool, layer } = poolWith(lut);
    pool.reconcile(frameOf(snapshotOf([human(1, WEST)])));
    const [row = -1] = rowsIn(layer, 'west');
    expect(teamTexel(lut, row)).toEqual([255, 0, 0]);

    pool.reconcile(frameOf(snapshotOf([human(1, WEST, { Owner: { player: 1 } })], 2)));
    expect(rowsIn(layer, 'west')).toEqual([row]);
    // Player 1 has no recipe in the synthetic lane, so the team band falls back to the grey base.
    expect(teamTexel(lut, row)).toEqual([TEAM_TEXEL, TEAM_TEXEL, TEAM_TEXEL]);

    const armored = { Owner: { player: 1 }, Equipment: { weapon: null, armor: { goodType: CHAIN_MAIL } } };
    pool.reconcile(frameOf(snapshotOf([human(1, WEST, armored)], 3)));
    expect(rowsIn(layer, 'west')).toEqual([row]);
    expect(lut.stats.composed).toBe(3);
  });

  it('rebinds a human whose row went to another while it was off screen', () => {
    const lut = syntheticHumanLut(new Map(), SMALL_ROWS);
    const { pool, layer } = poolWith(lut);
    const everyone = (tick: number) => snapshotOf([human(1, WEST), human(2, EAST), human(3, EAST)], tick);
    pool.reconcile(frameOf(everyone(1), WEST_ONLY));
    const [before] = rowsIn(layer, 'west');
    pool.reconcile(frameOf(everyone(2), EAST_ONLY));
    pool.reconcile(frameOf(everyone(3), EAST_ONLY));
    pool.reconcile(frameOf(everyone(4), ALL));
    const [after = -1] = rowsIn(layer, 'west');
    expect(rowsIn(layer, 'east')).toContain(before);
    expect(rowsIn(layer, 'east')).not.toContain(after);
  });

  it('flushes the LUT once per frame, after the rows are asked for', () => {
    const lut = syntheticHumanLut(new Map(), SMALL_ROWS);
    const { pool } = poolWith(lut);
    const calls: string[] = [];
    vi.spyOn(lut, 'rowFor').mockImplementation(function (this: HumanPaletteLut, ...args) {
      calls.push('row');
      return Object.getPrototypeOf(lut).rowFor.apply(this, args);
    });
    vi.spyOn(lut, 'flush').mockImplementation(() => {
      calls.push('flush');
    });
    pool.reconcile(frameOf(snapshotOf([human(1, WEST), human(2, EAST)])));
    expect(calls.filter((c) => c === 'flush')).toHaveLength(1);
    expect(calls.at(-1)).toBe('flush');
    expect(calls.filter((c) => c === 'row').length).toBeGreaterThanOrEqual(2);
  });
});

describe('SpritePool - a pan re-places the kept paletted quads', () => {
  it('snaps a human quad to the moved camera device grid without binding it again', () => {
    const { pool, layer } = poolWith(syntheticHumanLut(new Map(), SMALL_ROWS));
    const snapshot = snapshotOf([human(1, WEST)]);
    const quad = (): PalettedQuad => {
      const container = layer.children[0] as Container;
      const found = container.children.find((c): c is PalettedQuad => c instanceof PalettedQuad);
      if (found === undefined) throw new Error('the human drew no paletted quad');
      return found;
    };
    const SNAP = 2;
    const at = (offsetX: number): PoolFrame => ({
      ...frameOf(snapshot),
      camera: { offsetX, offsetY: 0 },
      snapResolution: SNAP,
    });
    pool.reconcile(at(0));
    const bind = vi.spyOn(LayerBinder.prototype, 'bind');
    const panned = at(0.3);
    pool.reconcile(panned);
    expect(bind).not.toHaveBeenCalled();
    const expected = new PalettedQuad();
    expected.offsetX = quad().offsetX;
    expected.offsetY = quad().offsetY;
    const container = layer.children[0] as Container;
    expected.placeFor(panned.camera, container.position.x, container.position.y, SNAP);
    expect(quad().position.x).toBe(expected.position.x);
    expect(quad().position.x).not.toBe(quad().offsetX);
  });
});

it('keeps blood on visible bodies across culling and clears even detached fighters when disabled', () => {
  const lut = syntheticHumanLut();
  const { pool, layer } = poolWith(lut);
  const world = snapshotOf([human(1, WEST), human(2, WEST)], 1);
  const frame = frameOf(world);
  pool.reconcile(frame);
  const bodies = layer.children
    .flatMap((c) => c.children)
    .filter((c) => c instanceof PalettedQuad && !c.glow);
  expect(bodies).toHaveLength(2);
  expect(bodies.map(spriteBloodEffect)).toEqual([0, 0]);
  pool.ingestBlood(
    [
      {
        kind: 'combatHit',
        damage: 250,
        targetMaxHealth: 1000,
        attacker: 1 as Entity,
        target: 2 as Entity,
        weaponMainType: 3,
        at: { hx: 0, hy: 4 },
      },
    ],
    1,
  );
  pool.reconcile({ ...frame, tick: 2 });
  expect(bodies.every((b) => spriteBloodEffect(b) > 0)).toBe(true);
  pool.reconcile({ ...frame, tick: 3, viewport: EAST_ONLY });
  pool.reconcile({ ...frame, tick: 120 });
  expect(bodies.every((b) => spriteBloodEffect(b) > 0)).toBe(true);
  pool.reconcile({ ...frame, tick: 121, viewport: EAST_ONLY });
  pool.setBloodEnabled(false);
  expect(bodies.map(spriteBloodEffect)).toEqual([0, 0]);
  pool.setBloodEnabled(true);
  pool.reconcile({ ...frame, tick: 122 });
  expect(bodies.map(spriteBloodEffect)).toEqual([0, 0]);
  pool.destroy();
  lut.source.destroy();
});
