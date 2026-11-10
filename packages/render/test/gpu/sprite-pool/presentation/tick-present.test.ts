import type { Entity } from '@open-northland/sim';
import { Container, Sprite, Texture } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';
import type { DrawItem } from '../../../../src/data/scene/index.js';
import type { DirectionalAnim } from '../../../../src/data/sprites/settler-bindings.js';
import { spriteBloodEffect } from '../../../../src/gpu/selection/sprite-effect.js';
import { LayerBinder } from '../../../../src/gpu/sprite-pool/bind-layers.js';
import { type PoolFrame, SpritePool } from '../../../../src/gpu/sprite-pool/index.js';
import {
  createPresentationTrack,
  presentItem,
} from '../../../../src/gpu/sprite-pool/presentation/present-item.js';
import type { SettlerCharacter, SpriteSheet } from '../../../../src/gpu/textures/sprite-sheet.js';
import { TextureCache } from '../../../../src/gpu/textures/texture-cache.js';
import { entity, snapshotOf } from '../../../support/fixtures.js';

/** A settler presented again in the same tick repeats its last resolve while nothing it reads moved. */

const FRAMES = 8;
const body = {
  source: Texture.WHITE.source,
  atlas: {
    width: FRAMES,
    height: 1,
    frames: new Map(
      Array.from({ length: FRAMES }, (_, bob) => [
        bob,
        { x: bob, y: 0, width: 1, height: 1, offsetX: 0, offsetY: 0 },
      ]),
    ),
  },
};
const IDLE: DirectionalAnim = { start: 0, dirs: 1, stride: FRAMES };
/** Two frames per tick: a present later in the same tick may show the next one. */
const SUBTICK_IDLE: DirectionalAnim = { ...IDLE, subtick: true, ticksPerFrame: 0.5 };
const TICK = 10;

function sheetWith(look: Partial<SettlerCharacter> = {}): SpriteSheet {
  const character: SettlerCharacter = { body, binding: { idle: IDLE, moving: IDLE }, ...look };
  return {
    ...body,
    bindings: { settler: 0, building: 0, resource: 0 },
    characters: { default: character, byJob: {} },
  };
}

const idler: DrawItem = { kind: 'settler', ref: 1, x: 0, y: 20, depth: 0, state: 'idle' };

/** A fresh track and a count of the resolves it runs: each one refills the track's layer buffer. */
function tracked() {
  const track = createPresentationTrack('settler');
  return { track, resolves: vi.spyOn(track.layers, 'reset') };
}

/** Present `item` on a fresh track at `alpha`, for what a repeat must equal. */
function freshPresent(item: DrawItem, sheet: SpriteSheet, alpha: number) {
  const track = createPresentationTrack('settler');
  return [...(presentItem(track, item, TICK, alpha, sheet, true) ?? [])];
}

describe('presentItem - a repeat within one tick', () => {
  it('skips the resolve of an unchanged settler when only the frame alpha moved', () => {
    const sheet = sheetWith();
    const { track, resolves } = tracked();
    const first = [...(presentItem(track, idler, TICK, 0.25, sheet, true) ?? [])];
    const again = presentItem(track, idler, TICK, 0.75, sheet, true);
    expect(resolves).toHaveBeenCalledTimes(1);
    expect(again).toEqual(first);
    expect(again).toEqual(freshPresent(idler, sheet, 0.75));
  });

  it('resolves again on a new tick, a new item, or an alpha that steps the animation clock', () => {
    const sheet = sheetWith();
    for (const [item, tick, alpha] of [
      [idler, TICK + 1, 0.25],
      [{ ...idler }, TICK, 0.25],
      [idler, TICK, 1],
    ] as const) {
      const { track, resolves } = tracked();
      presentItem(track, idler, TICK, 0.25, sheet, true);
      presentItem(track, item, tick, alpha, sheet, true);
      expect(resolves).toHaveBeenCalledTimes(2);
    }
  });

  it('repeats an acting settler at alpha 1, whose clock is the tick alone', () => {
    const sheet = sheetWith();
    const actor: DrawItem = { ...idler, state: 'acting', atomicId: 3, elapsed: 2 };
    const { track, resolves } = tracked();
    presentItem(track, actor, TICK, 0.25, sheet, true);
    presentItem(track, actor, TICK, 1, sheet, true);
    expect(resolves).toHaveBeenCalledTimes(1);
  });

  it('resolves every present of a subtick look, whose frame moves within a tick', () => {
    const sheet = sheetWith({ binding: { idle: SUBTICK_IDLE } });
    const { track, resolves } = tracked();
    presentItem(track, idler, TICK, 0.25, sheet, true);
    const later = [...(presentItem(track, idler, TICK, 0.75, sheet, true) ?? [])];
    expect(resolves).toHaveBeenCalledTimes(2);
    expect(later).toEqual(freshPresent(idler, sheet, 0.75));
    expect(later).not.toEqual(freshPresent(idler, sheet, 0.25));
  });

  /** Clips without the subtick flag whose frame time is fractional: each steps between two presents
   *  of the same tick at alpha 0.25 and 0.75. */
  const FRACTIONAL_CLIPS: readonly (readonly [string, DirectionalAnim])[] = [
    ['ticks per frame', { ...IDLE, ticksPerFrame: 2.5 }],
    ['frame durations', { ...IDLE, frameDurations: Array.from({ length: FRAMES }, () => 0.5) }],
  ];
  for (const [name, idle] of FRACTIONAL_CLIPS) {
    it(`resolves every present of a look with fractional ${name}`, () => {
      const sheet = sheetWith({ binding: { idle } });
      const { track, resolves } = tracked();
      presentItem(track, idler, TICK, 0.25, sheet, true);
      const later = [...(presentItem(track, idler, TICK, 0.75, sheet, true) ?? [])];
      expect(resolves).toHaveBeenCalledTimes(2);
      expect(later).toEqual(freshPresent(idler, sheet, 0.75));
      expect(later).not.toEqual(freshPresent(idler, sheet, 0.25));
    });
  }

  it('resolves every present of a look that moves between tick anchors', () => {
    const sheet = sheetWith({ interpolateMotion: true });
    const { track, resolves } = tracked();
    presentItem(track, idler, TICK, 0.25, sheet, true);
    presentItem(track, idler, TICK, 0.75, sheet, true);
    expect(resolves).toHaveBeenCalledTimes(2);
  });

  it('resolves again once the pool resets the motion track', () => {
    const sheet = sheetWith();
    const { track, resolves } = tracked();
    presentItem(track, idler, TICK, 0.25, sheet, true);
    track.motion.tick = -1;
    presentItem(track, idler, TICK, 0.75, sheet, true);
    expect(resolves).toHaveBeenCalledTimes(2);
  });
});

describe('SpritePool - a frame between ticks', () => {
  const SETTLER = 1;
  const snapshot = snapshotOf([entity(SETTLER, 0, 0, { Settler: { tribe: 0 } })], TICK);
  const still: Omit<PoolFrame, 'alpha'> = {
    snapshot,
    viewport: { minX: -1e6, maxX: 1e6, minY: -1e6, maxY: 1e6 },
    tick: TICK,
    camera: { offsetX: 0, offsetY: 0 },
    screenW: 800,
    screenH: 600,
    elevation: { maxLift: 0, liftAt: () => 0, liftAtNode: () => 0 },
    environmentMotion: true,
  };
  const frameAt = (alpha: number): PoolFrame => ({ ...still, alpha });
  /** A pool over `look` that counts the presents reading its characters, the first step of a resolve. */
  function countingPool(look: Partial<SettlerCharacter> = {}) {
    const plain = sheetWith(look);
    const characters = plain.characters;
    if (characters === undefined) throw new Error('the sheet has no characters');
    let reads = 0;
    const counted: SpriteSheet = {
      ...plain,
      get characters() {
        reads++;
        return characters;
      },
    };
    const layer = new Container();
    return { layer, pool: new SpritePool(layer, new TextureCache(), counted), reads: () => reads };
  }
  const bodyFrameX = (layer: Container) => {
    const sprites = (layer.children[0] as Container | undefined)?.children ?? [];
    const body = sprites.find((child): child is Sprite => child instanceof Sprite && child.alpha > 0);
    return body?.texture.frame.x;
  };

  it('neither presents nor binds a settler whose present would repeat', () => {
    const { layer, pool, reads } = countingPool();
    const bind = vi.spyOn(LayerBinder.prototype, 'bind');
    pool.reconcile(frameAt(0.25));
    const first = reads();
    const container = layer.children[0];
    if (container === undefined) throw new Error('the settler was not drawn');
    // Every present places the entity's container.
    const placed = vi.spyOn(container.position, 'set');
    pool.reconcile(frameAt(0.5));
    pool.reconcile(frameAt(0.75));
    expect(reads()).toBe(first);
    expect(placed).not.toHaveBeenCalled();
    expect(bind).toHaveBeenCalledTimes(1);
    bind.mockRestore();
  });

  it('presents and binds again a subtick look whose frame moved within the tick', () => {
    const { layer, pool, reads } = countingPool({ binding: { idle: SUBTICK_IDLE } });
    pool.reconcile(frameAt(0.25));
    const first = reads();
    const before = bodyFrameX(layer);
    pool.reconcile(frameAt(0.75));
    expect(reads()).toBeGreaterThan(first);
    expect(bodyFrameX(layer)).not.toBe(before);
  });

  /** The refs presented since the call, read through the returned function. */
  function presentedRefs(): () => number[] {
    type PresentPooled = (pe: unknown, item: DrawItem) => void;
    const spy = vi.spyOn(
      SpritePool.prototype as unknown as { presentPooled: PresentPooled },
      'presentPooled',
    );
    return () => spy.mock.calls.map((call) => call[1].ref);
  }

  it('leaves a settler whose present holds for the whole tick out of the frames between ticks', () => {
    const { pool } = countingPool();
    pool.reconcile({ ...frameAt(0.25), environmentMotion: false });
    const refs = presentedRefs();
    pool.reconcile({ ...frameAt(0.5), environmentMotion: false });
    pool.reconcile({ ...frameAt(1), environmentMotion: false });
    expect(refs()).toEqual([]);
    vi.restoreAllMocks();
  });

  it('presents a settler on its tick anchor once when the animation clock reaches the next tick', () => {
    const { layer, pool } = countingPool();
    pool.reconcile(frameAt(0.25));
    const before = bodyFrameX(layer);
    const refs = presentedRefs();
    pool.reconcile(frameAt(0.5));
    expect(refs()).toEqual([]);
    expect(bodyFrameX(layer)).toBe(before);
    pool.reconcile(frameAt(1));
    pool.reconcile(frameAt(1));
    expect(refs()).toEqual([SETTLER]);
    expect(bodyFrameX(layer)).not.toBe(before);
    vi.restoreAllMocks();
  });

  it('presents a selected settler on every frame between ticks, and one selected between them', () => {
    const { pool } = countingPool();
    const selection = new Set([SETTLER]);
    const pulsing = (alpha: number): PoolFrame => ({ ...frameAt(alpha), selection, selectionStyle: 'pulse' });
    pool.reconcile(pulsing(0.25));
    const refs = presentedRefs();
    pool.reconcile(pulsing(0.5));
    pool.reconcile(pulsing(0.75));
    expect(refs()).toEqual([SETTLER, SETTLER]);
    vi.restoreAllMocks();

    const late = countingPool();
    late.pool.reconcile({ ...frameAt(0.25), selectionStyle: 'pulse' });
    const lateRefs = presentedRefs();
    late.pool.reconcile(pulsing(0.5));
    expect(lateRefs()).toEqual([SETTLER]);
    vi.restoreAllMocks();
  });

  it('presents a settler in a drying blood coat on every frame between ticks', () => {
    const { pool } = countingPool();
    pool.ingestBlood(
      [
        {
          kind: 'combatHit',
          damage: 250,
          targetMaxHealth: 1000,
          attacker: SETTLER as Entity,
          target: SETTLER as Entity,
          at: { hx: 0, hy: 0 },
        },
      ],
      TICK,
    );
    pool.reconcile(frameAt(0.25));
    const refs = presentedRefs();
    pool.reconcile(frameAt(0.5));
    expect(refs()).toEqual([SETTLER]);
    vi.restoreAllMocks();
  });

  it('coats a settler whose blood arrived after the pass of its tick', () => {
    const { layer, pool } = countingPool();
    pool.reconcile(frameAt(0.25));
    const sprites = (layer.children[0] as Container | undefined)?.children ?? [];
    expect(sprites.some((sprite) => spriteBloodEffect(sprite) > 0)).toBe(false);
    pool.ingestBlood(
      [
        {
          kind: 'combatHit',
          damage: 250,
          targetMaxHealth: 1000,
          attacker: SETTLER as Entity,
          target: SETTLER as Entity,
          at: { hx: 0, hy: 0 },
        },
      ],
      TICK,
    );
    pool.reconcile(frameAt(0.5));
    expect(sprites.some((sprite) => spriteBloodEffect(sprite) > 0)).toBe(true);
  });
});
