import { Container, Rectangle, Sprite, Texture, TextureSource } from 'pixi.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readHpFraction } from '../src/data/scene/snapshot-readers/index.js';
import { DamageAtlas } from '../src/gpu/building-damage/atlas.js';
import { BuildingDamage } from '../src/gpu/building-damage/building-damage.js';
import { analyseSurface, damageStage, scarSurface } from '../src/gpu/building-damage/surface.js';
import * as drawable from '../src/gpu/drawable-resource.js';

const W = 96,
  H = 100;

/** Synthetic gable, warm roof and grey walls, surrounded by transparent pixels. */
function housePixels(): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(W * H * 4);
  for (let y = 4; y < H - 8; y++)
    for (let x = 8; x < W - 8; x++) {
      if (y < 45 && Math.abs(x - W / 2) > (y - 3) * 1.1) continue;
      pixels.set(y < 50 ? [165 + (x % 7), 110, 59, 255] : [131, 131 + (y % 7), 129, 255], (y * W + x) * 4);
    }
  return pixels;
}

function mockCanvas() {
  const reads = vi.fn((x: number, y: number, w: number, h: number) => {
    void x;
    void y;
    return { data: w === W && h === H ? housePixels() : new Uint8ClampedArray(w * h * 4) };
  });
  vi.spyOn(drawable, 'isDrawableResource').mockReturnValue(true);
  vi.spyOn(drawable, 'readable2dContext').mockImplementation(
    (width, height) =>
      ({
        canvas: { width, height },
        clearRect: vi.fn(),
        drawImage: vi.fn(),
        getImageData: reads,
        putImageData: vi.fn(),
        createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      }) as unknown as CanvasRenderingContext2D,
  );
  return reads;
}

function subject() {
  const texture = new Texture({
    source: new TextureSource({ width: W, height: H }),
    frame: new Rectangle(0, 0, W, H),
  });
  const body = new Sprite(texture);
  const container = new Container();
  container.addChild(body);
  return { container, damageBodies: [body], body, texture };
}

afterEach(() => vi.restoreAllMocks());

describe('structural damage surfaces', () => {
  it('anchors wounds on solid pixels, changes the roof silhouette and preserves transparent surroundings', () => {
    const original = housePixels();
    const untouched = original.slice();
    const sites = analyseSurface(original, W, H, 73);
    expect(sites.length).toBeGreaterThan(3);
    expect(sites.every((p) => original[(p.y * W + p.x) * 4 + 3] === 255)).toBe(true);
    const damaged = scarSurface(original, W, H, sites, 5);
    let lostCoverage = 0,
      changed = 0;
    for (let i = 0; i < original.length; i += 4) {
      if (original[i + 3] === 0) expect(damaged[i + 3]).toBe(0);
      if (original[i + 3] === 255 && damaged[i + 3] === 0) lostCoverage++;
      if (original[i] !== damaged[i]) changed++;
    }
    expect(lostCoverage).toBeGreaterThan(5);
    expect(changed).toBeGreaterThan(300);
    expect(changed).toBeLessThan((W * H) / 2);
    expect(original).toEqual(untouched);
    expect(scarSurface(original, W, H, sites, 0)).toEqual(untouched);
  });

  it('keeps the same fractures through worsening damage and makes neighbouring houses differ', () => {
    const original = housePixels();
    const sites = analyseSurface(original, W, H, 12);
    const changed = (stage: number) =>
      scarSurface(original, W, H, sites, stage).filter((v, i) => v !== original[i]).length;
    expect(changed(5)).toBeGreaterThan(changed(3));
    expect(changed(3)).toBeGreaterThan(changed(1));
    expect(analyseSurface(original, W, H, 13)).not.toEqual(sites);
    expect([1, 0.85, 0.6, 0.4, 0.2, 0.05].map(damageStage)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(damageStage(Number.NaN)).toBe(0);
  });
});

describe('health relative to construction', () => {
  const state = (hp: number, built: number, upgrading = false) => ({
    Health: { hitpoints: hp, max: 1000 },
    Building: { built },
    ...(upgrading ? { Upgrading: {} } : {}),
  });
  it('distinguishes siege damage from unfinished work, including the first foundation point', () => {
    expect(readHpFraction(state(500, 32768))).toBeUndefined();
    expect(readHpFraction(state(250, 32768))).toBe(0.5);
    expect(readHpFraction(state(1, 0))).toBeUndefined();
    expect(readHpFraction(state(750, 65536))).toBe(0.75);
    expect(readHpFraction(state(1000, 1000, true))).toBeUndefined();
    expect(readHpFraction(state(500, 1000, true))).toBe(0.5);
    expect(readHpFraction({ Health: { hitpoints: 1, max: Infinity } })).toBeUndefined();
    expect(readHpFraction({})).toBeUndefined();
  });
});

describe('visible damage ownership', () => {
  it('retains one bake through ordinary rebinds and releases it on repair, cull and a live option flip', () => {
    const reads = mockCanvas();
    const damage = new BuildingDamage();
    const house = subject();
    const draw = (hp: number, detailed = true) =>
      damage.draw([{ ref: 7, hpFrac: hp }], () => house, 10, undefined, detailed, true, 1);
    draw(0.1);
    const baked = house.body.texture;
    expect(baked).not.toBe(house.texture);
    const count = reads.mock.calls.length;
    house.body.texture = house.texture; // The ordinary binder visits the same source frame.
    draw(0.1);
    expect(house.body.texture).toBe(baked);
    expect(reads).toHaveBeenCalledTimes(count);
    draw(0.1, false);
    expect(house.body.texture).toBe(house.texture);
    expect(baked.destroyed).toBe(true);
    draw(0.1);
    expect(house.body.texture).not.toBe(house.texture);
    draw(1);
    expect(house.body.texture).toBe(house.texture);
    expect(house.container.children).toEqual([house.body]);
    draw(0.2);
    damage.draw([], () => undefined, 11, undefined, true, true, 1);
    expect(house.body.texture).toBe(house.texture);
    expect(house.container.children).toEqual([house.body]);
    damage.destroy();
  });

  it('moves the last damaged pixels into a collapse lease instead of flashing pristine art', () => {
    mockCanvas();
    const damage = new BuildingDamage(),
      house = subject();
    damage.draw([{ ref: 12, hpFrac: 0.1 }], () => house, 4, undefined, true, true, 1);
    const damaged = house.body.texture;
    const fallen = damage.capture(12);
    expect(fallen).toHaveLength(1);
    expect(fallen?.[0]?.texture).toBe(damaged);
    expect(damaged.destroyed).toBe(false);
    expect(house.body.texture).toBe(house.texture);
    fallen?.[0]?.release();
    expect(damaged.destroyed).toBe(true);
    damage.destroy();
  });

  it('freezes unbaked construction layers and animated extras with their current fade', () => {
    mockCanvas();
    const damage = new BuildingDamage(),
      house = subject();
    const stage = subject(),
      rotor = subject();
    house.damageBodies.push(stage.body);
    house.container.addChild(stage.body, rotor.body);
    house.body.alpha = 0.4;
    damage.draw([{ ref: 12, hpFrac: 0.1 }], () => house, 4, undefined, true, true, 1);
    const fallen = damage.capture(12, [house.body, stage.body, rotor.body]);
    expect(fallen).toHaveLength(3);
    expect(fallen?.[0]?.alpha).toBe(0.4);
    expect(fallen?.[1]?.texture.source).not.toBe(stage.texture.source);
    expect(fallen?.[2]?.texture.source).not.toBe(rotor.texture.source);
    stage.texture.destroy(true);
    rotor.texture.destroy(true);
    expect(fallen?.every((body) => !body.texture.source.destroyed)).toBe(true);
    for (const body of fallen ?? []) body.release();
    damage.destroy();
  });

  it('keeps remembered scars without emitting fire or smoke under fog', () => {
    mockCanvas();
    const damage = new BuildingDamage(),
      house = subject();
    damage.draw([{ ref: 7, hpFrac: 0.1, ghost: true }], () => house, 4, undefined, true, true, 1);
    expect(house.body.texture).not.toBe(house.texture);
    expect(house.container.children[1]?.visible).toBe(false);
    damage.draw([{ ref: 7, hpFrac: 0.1 }], () => house, 5, undefined, true, true, 1);
    expect(house.container.children[1]?.visible).toBe(true);
    damage.destroy();
  });

  it('lets a pending neighbour bake while a construction layer changes every frame', () => {
    mockCanvas();
    const damage = new BuildingDamage(),
      site = subject(),
      neighbour = subject();
    const list = [
      { ref: 1, hpFrac: 0.1 },
      { ref: 2, hpFrac: 0.1 },
    ];
    damage.draw(list, (ref) => (ref === 1 ? site : neighbour), 0, undefined, true, true, 1);
    site.body.texture = subject().texture;
    damage.draw(list, (ref) => (ref === 1 ? site : neighbour), 1, undefined, true, true, 1);
    expect(neighbour.body.texture).not.toBe(neighbour.texture);
    damage.destroy();
  });

  it('reuses atlas space after scrolling through many settlements', () => {
    mockCanvas();
    const damage = new BuildingDamage(),
      house = subject();
    let first: TextureSource | undefined;
    for (let i = 0; i < 40; i++) {
      damage.draw([{ ref: i, hpFrac: 0.1 }], () => house, i, undefined, true, true, 1);
      first ??= house.body.texture.source;
      expect(house.body.texture.source).toBe(first);
      damage.draw([], () => undefined, i, undefined, true, true, 1);
    }
    damage.destroy();
  });

  it('does not repeatedly read an unavailable source or block readable neighbours', () => {
    const reads = mockCanvas();
    const damage = new BuildingDamage(),
      a = subject(),
      b = subject();
    vi.spyOn(drawable, 'isDrawableResource').mockReturnValue(false);
    damage.draw([{ ref: 1, hpFrac: 0.1 }], () => a, 0, undefined, true, true, 1);
    vi.spyOn(drawable, 'isDrawableResource').mockReturnValue(true);
    damage.draw(
      [
        { ref: 1, hpFrac: 0.1 },
        { ref: 2, hpFrac: 0.1 },
      ],
      (ref) => (ref === 1 ? a : b),
      1,
      undefined,
      true,
      true,
      1,
    );
    expect(reads).toHaveBeenCalledTimes(1);
    expect(b.body.texture).not.toBe(b.texture);
    damage.destroy();
  });
});

describe('damage atlas budget', () => {
  it('refuses excess live allocations and can reuse a released slot without changing another texture', () => {
    mockCanvas();
    const atlas = new DamageAtlas();
    const tiles = Array.from({ length: 16 }, () => atlas.allocate(500, 500, Texture.WHITE));
    expect(tiles.every((t) => t !== null)).toBe(true);
    expect(atlas.allocate(500, 500, Texture.WHITE)).toBeNull();
    const released = tiles[0];
    if (released === null || released === undefined) throw new Error('missing first tile');
    atlas.release(released);
    const replacement = atlas.allocate(500, 500, Texture.WHITE);
    expect(replacement?.texture.source).toBe(released.page.source);
    expect(tiles[1]?.texture.destroyed).toBe(false);
    if (replacement !== null) atlas.release(replacement);
    for (const tile of tiles.slice(1)) if (tile !== null) atlas.release(tile);
    atlas.destroy();
  });
});
