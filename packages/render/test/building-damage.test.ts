import { Container, Graphics, Rectangle, Sprite, Texture, TextureSource } from 'pixi.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readHpFraction } from '../src/data/scene/snapshot-readers/index.js';
import { DamageAtlas } from '../src/gpu/building-damage/atlas.js';
import { BuildingDamage } from '../src/gpu/building-damage/building-damage.js';
import { DamageEffectTextures } from '../src/gpu/building-damage/effect-textures.js';
import { DamageEffects } from '../src/gpu/building-damage/effects.js';
import { DamagePaintCache } from '../src/gpu/building-damage/paint-cache.js';
import { groundContacts } from '../src/gpu/building-damage/rubble.js';
import { analyseSurface, damageLevel, scarSurface } from '../src/gpu/building-damage/surface.js';
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
    expect([1, 0.9, 0.75, 0.6, 0.45, 0.3, 0.2].map(damageLevel)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(damageLevel(Number.NaN)).toBe(0);
  });

  it('gradually reveals wounds across health anchors, including the first chips and exposed backing', () => {
    const original = housePixels();
    const sites = analyseSurface(original, W, H, 73);
    const backing = original.slice();
    for (let at = 0; at < backing.length; at += 4) backing.set([60, 180, 80], at);
    for (const hp of [1, 0.9, 0.75, 0.6, 0.45, 0.3, 0.2]) {
      const before = scarSurface(original, W, H, sites, damageLevel(hp + 0.001), backing);
      const after = scarSurface(original, W, H, sites, damageLevel(hp - 0.001), backing);
      let maxChange = 0;
      for (let at = 0; at < original.length; at += 4) {
        if (original[at + 3] === 0) expect(after[at + 3]).toBe(0);
        for (let c = 0; c < 4; c++)
          maxChange = Math.max(maxChange, Math.abs((after[at + c] ?? 0) - (before[at + c] ?? 0)));
      }
      expect(maxChange).toBeGreaterThan(0);
      expect(maxChange).toBeLessThan(5);
    }
  });
  it('makes light damage visible and critical damage extensive without deleting the building', () => {
    const original = housePixels();
    for (const seed of [1, 12, 73, 104]) {
      const sites = analyseSurface(original, W, H, seed);
      const light = scarSurface(original, W, H, sites, damageLevel(0.9));
      const critical = scarSurface(original, W, H, sites, damageLevel(0.04));
      let chips = 0,
        wounds = 0,
        lost = 0,
        solid = 0;
      for (let at = 0; at < original.length; at += 4) {
        if (original[at + 3] !== 255) continue;
        solid++;
        if (Math.abs((light[at] ?? 0) - (original[at] ?? 0)) > 25) chips++;
        if (Math.abs((critical[at] ?? 0) - (original[at] ?? 0)) > 25) wounds++;
        if (critical[at + 3] === 0) lost++;
      }
      expect(chips).toBeGreaterThan(70);
      expect(wounds).toBeGreaterThan(chips * 3);
      expect(lost).toBeLessThan(solid * 0.06);
    }
  });

  it('uncovers aligned construction inside cavities while preserving the original surroundings', () => {
    const original = housePixels();
    const backing = new Uint8ClampedArray(original.length);
    for (let at = 0; at < backing.length; at += 4) backing.set([60, 180, 90, 255], at);
    const result = scarSurface(original, W, H, analyseSurface(original, W, H, 73), 6, backing);
    let exposed = 0;
    for (let at = 0; at < original.length; at += 4) {
      if (original[at + 3] === 0) expect(result[at + 3]).toBe(0);
      else {
        expect(result[at + 3]).toBe(original[at + 3]);
        if (result[at] === 39 && result[at + 1] === 117) exposed++;
      }
    }
    expect(exposed).toBeGreaterThan(200);
    expect(scarSurface(original, W, H, analyseSurface(original, W, H, 73), 0, backing)).toEqual(original);
  });

  it('places rubble under the local foot of a sloped silhouette', () => {
    const pixels = housePixels();
    for (let x = 0; x < W; x++)
      for (let y = 80 + Math.floor(x / 10); y < H; y++) pixels[(y * W + x) * 4 + 3] = 0;
    const feet = groundContacts(pixels, W, H, -10, -20, 2);
    expect(feet.length).toBeGreaterThan(8);
    for (const foot of feet) {
      const x = (foot.x + 10) / 2,
        y = (foot.y + 20) / 2;
      expect(pixels[(y * W + x) * 4 + 3]).toBe(255);
      expect(pixels[((y + 1) * W + x) * 4 + 3]).toBe(0);
    }
    expect(new Set(feet.map((p) => p.y)).size).toBeGreaterThan(4);
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
  it('keeps disabled effects smoke-only and creates detailed art only when enabled', () => {
    mockCanvas();
    const damage = new BuildingDamage(),
      house = subject();
    const draw = (detailed: boolean) =>
      damage.draw([{ ref: 7, hpFrac: 0.1 }], () => house, 10, undefined, detailed, true, 1);
    draw(false);
    const smoke = house.container.children[1];
    expect(smoke?.children).toHaveLength(3);
    expect(
      smoke?.children.every((child) => child instanceof Sprite && child.texture.source.width === 256),
    ).toBe(true);
    draw(true);
    expect(smoke?.destroyed).toBe(true);
    const detailed = house.container.children[1];
    expect(detailed?.children.filter((child) => child instanceof Graphics)).toHaveLength(9);
    draw(false);
    expect(detailed?.destroyed).toBe(true);
    expect(house.container.children[1]?.children).toHaveLength(3);
    damage.destroy();
  });

  it('releases the atlas and endpoint cache when a hidden body has its effects disabled', () => {
    mockCanvas();
    let painter: DamagePaintCache | undefined;
    const paint = DamagePaintCache.prototype.paint;
    vi.spyOn(DamagePaintCache.prototype, 'paint').mockImplementation(function (
      this: DamagePaintCache,
      surface,
      level,
    ) {
      painter = this;
      return paint.call(this, surface, level);
    });
    const damage = new BuildingDamage(),
      house = subject();
    const draw = (detailed: boolean) =>
      damage.draw([{ ref: 7, hpFrac: 0.5 }], () => house, 10, undefined, detailed, true, 1);
    for (const hide of ['visibility', 'alpha']) {
      house.body.visible = true;
      house.body.alpha = 1;
      draw(true);
      expect(painter?.retainedBytes).toBeGreaterThan(0);
      const baked = house.body.texture;
      if (hide === 'visibility') house.body.visible = false;
      else house.body.alpha = 0;
      draw(false);
      expect(house.body.texture).toBe(house.texture);
      expect(baked.destroyed).toBe(true);
      expect(painter?.retainedBytes).toBe(0);
    }
    damage.destroy();
  });

  it('destroys owned fragment contexts while preserving shared effect textures', () => {
    mockCanvas();
    const art = new DamageEffectTextures();
    const effects = new DamageEffects(art, 7);
    const contexts = effects.container.children
      .filter((child): child is Graphics => child instanceof Graphics)
      .map((child) => child.context);
    expect(contexts).toHaveLength(9);
    effects.destroy();
    expect(contexts.every((context) => context.destroyed)).toBe(true);
    expect(art.flames.every((texture) => !texture.destroyed && !texture.source.destroyed)).toBe(true);
    art.destroy();
  });

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

  it('captures a healthy construction layer without requiring a damage node', () => {
    mockCanvas();
    const damage = new BuildingDamage(),
      house = subject();
    const layer = {
      source: house.texture.source,
      frame: { x: 0, y: 0, width: W, height: H, offsetX: -W / 2, offsetY: -H },
      scale: 1,
      reveal: 0.37,
      revealWindow: [20, 100] as const,
    };
    const fallen = damage.capture(12, [house.body], () => layer);
    expect(fallen).toHaveLength(1);
    expect(fallen?.[0]?.texture.source).not.toBe(house.texture.source);
    expect(fallen?.[0]?.layer).toBe(layer);
    house.texture.destroy(true);
    expect(fallen?.[0]?.texture.source.destroyed).toBe(false);
    fallen?.[0]?.release();
    expect(fallen?.[0]?.texture.destroyed).toBe(true);
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
      { ref: 1, hpFrac: 0.5 },
      { ref: 2, hpFrac: 0.5 },
    ];
    damage.draw(list, (ref) => (ref === 1 ? site : neighbour), 0, undefined, true, true, 1);
    site.body.texture = subject().texture;
    damage.draw(list, (ref) => (ref === 1 ? site : neighbour), 1, undefined, true, true, 1);
    expect(neighbour.body.texture).not.toBe(neighbour.texture);
    damage.destroy();
  });

  it('charges both endpoint paints to the frame budget for blended damage', () => {
    mockCanvas();
    const writes = vi.spyOn(DamageAtlas.prototype, 'write');
    const damage = new BuildingDamage();
    const houses = [subject(), subject(), subject()];
    const list = houses.map((_, ref) => ({ ref, hpFrac: 0.5 }));
    for (let tick = 0; tick < 8; tick++) {
      writes.mockClear();
      damage.draw(list, (ref) => houses[ref], tick, undefined, true, true, 1);
      expect(writes.mock.calls.length).toBeLessThanOrEqual(1);
    }
    expect(houses.every((house) => house.body.texture !== house.texture)).toBe(true);
    damage.destroy();
  });

  it('bakes changing construction sources without starving another layer of the same building', () => {
    mockCanvas();
    const damage = new BuildingDamage();
    const site = subject(),
      stable = subject();
    let bakedChanging = 0;
    for (let tick = 0; tick < 5; tick++) {
      if (tick === 1) {
        site.damageBodies.push(stable.body);
        site.container.addChild(stable.body);
      }
      const source = subject().texture;
      site.body.texture = source;
      damage.draw([{ ref: 1, hpFrac: 0.5 }], () => site, tick, undefined, true, true, 1);
      if (site.body.texture !== source) bakedChanging++;
      if (tick === 0) expect(bakedChanging).toBe(1);
    }
    expect(bakedChanging).toBeGreaterThan(1);
    expect(stable.body.texture).not.toBe(stable.texture);
    damage.destroy();
  });

  it('gives pending layers work when two changing construction sites alternate priority', () => {
    mockCanvas();
    const damage = new BuildingDamage();
    const a = subject(),
      b = subject(),
      stable = subject();
    a.damageBodies.push(stable.body);
    a.container.addChild(stable.body);
    const list = [
      { ref: 1, hpFrac: 0.5 },
      { ref: 2, hpFrac: 0.5 },
    ];
    for (let tick = 0; tick < 8; tick++) {
      a.body.texture = subject().texture;
      b.body.texture = subject().texture;
      damage.draw(list, (ref) => (ref === 1 ? a : b), tick, undefined, true, true, 1);
    }
    expect(stable.body.texture).not.toBe(stable.texture);
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
