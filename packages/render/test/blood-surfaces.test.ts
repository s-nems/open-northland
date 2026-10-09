import { Container, Rectangle, Texture, TextureSource } from 'pixi.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BLOOD_LIFETIME_TICKS, type BloodDrop } from '../src/data/effects/blood.js';
import { BloodSurfaceSprite, bloodSurface, surfaceOf } from '../src/gpu/blood-surface.js';
import { DepthSortedLayer } from '../src/gpu/depth-sorted-layer.js';
import { BloodSurfaces, MAX_BLOOD_SURFACES } from '../src/gpu/overlays/blood-surfaces.js';
import * as masks from '../src/gpu/sprite-pool/alpha-mask.js';

const drop: BloodDrop = { vx: 4, vy: 0, rise: 20, lift: 0.2, delay: 0.5, flight: 6, size: 1.5 };
const solid = { width: 64, height: 64, bits: new Uint8Array(512).fill(255) };
function sprite(root: Container, x = 10, y = -25): BloodSurfaceSprite {
  const texture = new Texture({
    source: new TextureSource({ width: 64, height: 64 }),
    frame: new Rectangle(0, 0, 32, 32),
  });
  const s = root.addChild(new BloodSurfaceSprite(texture));
  s.position.set(x, y);
  bloodSurface(s, 0);
  return s;
}

afterEach(() => vi.restoreAllMocks());

describe('blood meeting scenery', () => {
  it('hits the first solid face along the swept arc and respects transparent holes', () => {
    vi.spyOn(masks, 'alphaMaskOf').mockReturnValue(solid);
    const root = new Container();
    const back = sprite(root, 16);
    const front = sprite(root, 8);
    const surfaces = new BloodSurfaces();
    surfaces.prepare([root], 0);
    const hit = surfaces.trace(drop, 0, 0);
    expect(hit?.surface.sprite).toBe(front);
    expect(hit?.age).toBeGreaterThan(drop.delay);
    expect(hit?.age).toBeLessThan(drop.flight);
    vi.spyOn(masks, 'alphaMaskOf').mockImplementation((source) =>
      source === front.texture.source ? { ...solid, bits: new Uint8Array(512) } : solid,
    );
    expect(surfaces.trace(drop, 0, 0)?.surface.sprite).toBe(back);
    root.destroy({ children: true });
  });

  it('uses painter order for overlapping faces, including queued depth changes', () => {
    vi.spyOn(masks, 'alphaMaskOf').mockReturnValue(solid);
    const root = new DepthSortedLayer();
    const front = sprite(root);
    front.zIndex = 50;
    const back = sprite(root);
    back.zIndex = 10;
    const surfaces = new BloodSurfaces();
    surfaces.prepare([root], 0);
    expect(surfaces.trace(drop, 0, 0)?.surface.sprite).toBe(front);
    back.zIndex = 70;
    surfaces.prepare([root], 0);
    expect(surfaces.trace(drop, 0, 0)?.surface.sprite).toBe(back);
    root.destroy({ children: true });
  });

  it('ignores shadows, hidden/fogged surfaces and distant silhouettes', () => {
    vi.spyOn(masks, 'alphaMaskOf').mockReturnValue(solid);
    const root = new Container();
    const s = sprite(root);
    const surfaces = new BloodSurfaces();
    for (const [enabled, visible, groundY] of [
      [false, true, 0],
      [true, false, 0],
      [true, true, 200],
    ] as const) {
      bloodSurface(s, groundY, { enabled });
      s.visible = visible;
      surfaces.prepare([root], 0);
      expect(surfaces.trace(drop, 0, 0)).toBeUndefined();
    }
    root.destroy({ children: true });
  });

  it('stores local coordinates through nested transforms and excludes the camera transform', () => {
    vi.spyOn(masks, 'alphaMaskOf').mockReturnValue(solid);
    const root = new Container();
    root.position.set(500, 400);
    root.scale.set(3);
    const parent = root.addChild(new Container());
    parent.position.set(8, -25);
    const s = sprite(parent, 0, 0);
    s.scale.set(2);
    s.skew.x = 0.1;
    const surfaces = new BloodSurfaces();
    surfaces.prepare([root], 0);
    const contact = surfaces.trace(drop, 0, 0);
    expect(contact?.surface.sprite).toBe(s);
    if (contact === undefined) throw new Error('missing contact');
    expect(contact.x).toBeGreaterThanOrEqual(0);
    expect(contact.x).toBeLessThan(1);
    expect(Number.isFinite(contact.angle)).toBe(true);
    surfaces.stamp(contact, 1);
    const packed = [...contact.surface.packed];
    s.position.set(10, 10);
    expect([...contact.surface.packed]).toEqual(packed);
    root.destroy({ children: true });
  });

  it('accumulates bounded spots, dries, survives a bone remint and clears immediately', () => {
    const root = new Container();
    const s = sprite(root);
    const surfaces = new BloodSurfaces();
    surfaces.restore(s, 42, 0);
    const surface = bloodSurface(s, 0, { flat: true });
    for (let i = 0; i < 3; i++)
      surfaces.stamp({ surface, x: i * 0.35, y: 0.5, radius: 2, angle: 0, age: 1 }, 10);
    expect([...surface.packed].filter((n) => n > 0)).toHaveLength(4);
    const viewTick = s._didViewChangeTick;
    surfaces.stamp({ surface, x: 0.7, y: 0.5, radius: 4, angle: 0, age: 1 }, 10);
    expect(s._didViewChangeTick).toBeGreaterThan(viewTick);
    surfaces.draw(490);
    expect(Math.floor((surface.packed[3] ?? 0) / 65536)).toBe(109);
    s.destroy();
    const next = sprite(root);
    surfaces.restore(next, 42, 0);
    expect(surfaceOf(next)?.packed).toEqual(surface.packed);
    surfaces.draw(10 + BLOOD_LIFETIME_TICKS);
    expect([...bloodSurface(next, 0).packed]).toEqual(new Array(4).fill(0));
    surfaces.stamp({ surface: bloodSurface(next, 0), x: 0.5, y: 0.5, radius: 4, angle: 0, age: 0 }, 1500);
    surfaces.clear();
    expect([...bloodSurface(next, 0).packed]).toEqual(new Array(4).fill(0));
    root.destroy({ children: true });
  });

  it('keeps a delayed bone contact when culling destroys its first sprite before impact', () => {
    const root = new Container();
    const first = sprite(root);
    const surfaces = new BloodSurfaces();
    surfaces.restore(first, 12, 0);
    const contact = {
      surface: bloodSurface(first, 0, { flat: true }),
      x: 0.5,
      y: 0.5,
      radius: 4,
      angle: 0,
      age: 3,
    };
    first.destroy();
    surfaces.stamp(contact, 3);
    const next = sprite(root);
    surfaces.restore(next, 12, 0);
    expect(surfaceOf(next)?.packed[3]).toBeGreaterThan(0);
    surfaces.draw(3 + BLOOD_LIFETIME_TICKS);
    expect([...bloodSurface(next, 0).packed]).toEqual(new Array(4).fill(0));
    root.destroy({ children: true });
  });

  it('evicts old surfaces at the global budget', () => {
    const root = new Container();
    const surfaces = new BloodSurfaces();
    const first = bloodSurface(sprite(root), 0);
    surfaces.stamp({ surface: first, x: 0.5, y: 0.5, radius: 4, angle: 0, age: 0 }, 0);
    for (let i = 0; i < MAX_BLOOD_SURFACES; i++) {
      surfaces.stamp(
        { surface: bloodSurface(sprite(root), 0), x: 0.5, y: 0.5, radius: 4, angle: 0, age: 0 },
        i + 1,
      );
    }
    expect([...first.packed]).toEqual(new Array(4).fill(0));
    root.destroy({ children: true });
  });

  it('rejects the visible face from behind, including elevated ground, but accepts a front strike', () => {
    vi.spyOn(masks, 'alphaMaskOf').mockReturnValue(solid);
    const root = new Container();
    const wall = sprite(root);
    const surfaces = new BloodSurfaces();
    bloodSurface(wall, 19);
    surfaces.prepare([root]);
    expect(surfaces.trace(drop, 0, 0, 0)).toBeUndefined();
    // Same projected overlap, now with the emitter in front of the building's ground row.
    bloodSurface(wall, 0);
    surfaces.prepare([root]);
    expect(surfaces.trace(drop, 0, 0, 0)?.surface.sprite).toBe(wall);
    wall.y -= 40;
    bloodSurface(wall, 0, { lift: 40 });
    surfaces.prepare([root]);
    expect(surfaces.trace(drop, 0, -40, -1)).toBeUndefined();
    expect(surfaces.trace(drop, 0, -40, 0)?.surface.sprite).toBe(wall);
    root.destroy({ children: true });
  });

  it('does not treat a high roof as a reachable wall when terrain brings the pixels together', () => {
    vi.spyOn(masks, 'alphaMaskOf').mockReturnValue(solid);
    const root = new Container();
    sprite(root, 10, -85);
    const surfaces = new BloodSurfaces();
    surfaces.prepare([root]);
    expect(surfaces.trace(drop, 0, -60, 0)).toBeUndefined();
    root.destroy({ children: true });
  });

  it('lets drops fall to a low pile instead of catching them above the ground', () => {
    vi.spyOn(masks, 'alphaMaskOf').mockReturnValue(solid);
    const root = new Container();
    const pile = sprite(root, 0, -25);
    bloodSurface(pile, 0, { flat: true });
    const surfaces = new BloodSurfaces();
    surfaces.prepare([root]);
    const contact = surfaces.trace(drop, 0, 0);
    expect(contact?.surface.sprite).toBe(pile);
    expect(contact?.age).toBeGreaterThan(5);
    expect(contact?.age).toBeLessThanOrEqual(drop.flight + drop.delay);
    root.destroy({ children: true });
  });

  it('uses the front footing of a large building and keeps splats below its entrance awning', () => {
    vi.spyOn(masks, 'alphaMaskOf').mockReturnValue({
      width: 64,
      height: 192,
      bits: new Uint8Array(1536).fill(255),
    });
    const root = new Container();
    const wall = root.addChild(
      new BloodSurfaceSprite(
        new Texture({
          source: new TextureSource({ width: 64, height: 192 }),
        }),
      ),
    );
    wall.position.set(10, -128); // An interior anchor at 0, but the front footing is at 64.
    const surface = bloodSurface(wall, 0, { facade: true });
    const surfaces = new BloodSurfaces();
    surfaces.prepare([root]);
    expect(surfaces.trace(drop, 0, -19, -19)).toBeUndefined(); // rear roof
    expect(surfaces.trace(drop, 0, 38, 38)).toBeUndefined(); // entrance awning
    const contact = surfaces.trace(drop, 0, 76, 76);
    expect(contact?.surface).toBe(surface);
    if (contact === undefined) throw new Error('missing facade contact');
    for (let tick = 0; tick < 100; tick++) surfaces.stamp(contact, tick);
    const radius = Math.floor((surface.packed[0] ?? 0) / 65536) % 16;
    expect(radius).toBe(15); // A sideways/downward splash can spread broadly below the awning.
    expect(surface.clipY * 192 - 128).toBeCloseTo(24);
    expect(contact.y).toBeGreaterThanOrEqual(surface.clipY);
    const turn = Math.floor((surface.packed[0] ?? 0) / 1048576);
    surfaces.stamp({ ...contact, angle: -Math.PI / 2 }, 101);
    expect(Math.floor((surface.packed[0] ?? 0) / 1048576)).toBe(turn);

    const farther = surfaces.trace(drop, 0, 90, 90);
    expect(farther?.y).toBeCloseTo(contact.y); // Same height above the facade's own footing.
    wall.x = 2;
    surfaces.prepare([root]);
    const upward = surfaces.trace({ ...drop, rise: 23, lift: 10 }, 0, 76, 76);
    if (upward === undefined) throw new Error('missing upward facade contact');
    expect(upward.y).toBeGreaterThanOrEqual(surface.clipY);

    // The raw late-flight point can cross a bucket boundary while its facade projection stays solid.
    wall.position.set(26.8, -172);
    bloodSurface(wall, -44, { facade: true });
    surfaces.prepare([root]);
    const flight = (1.29 + Math.sqrt(1.29 ** 2 + 2 * 1.2 * 37)) / 1.2;
    const drifting = surfaces.trace(
      { vx: 3, vy: 1.39, rise: 37, lift: 1.29, delay: 0.1, flight, size: 1.5 },
      0,
      54,
      54,
    );
    expect(drifting?.surface).toBe(surface);
    expect(drifting?.age).toBeCloseTo(flight + 0.1);

    root.destroy({ children: true });
  });

  it('ages patches independently so a new splash cannot freshen or preserve an old one', () => {
    const root = new Container();
    const surface = bloodSurface(sprite(root), 0);
    const surfaces = new BloodSurfaces();
    const base = { surface, y: 0.5, radius: 2, angle: Math.PI / 2, age: 0 };
    surfaces.stamp({ ...base, x: 0.1 }, 0);
    surfaces.stamp({ ...base, x: 0.9 }, 600);
    const ages = Math.abs(surface.packed[3] ?? 0);
    expect(ages % 256).toBeGreaterThan(100);
    expect(Math.floor(ages / 256)).toBe(1);
    surfaces.draw(BLOOD_LIFETIME_TICKS);
    expect((surface.packed[0] ?? 0) % 256).toBe(Math.round(0.9 * 255));
    expect(surface.packed[1]).toBe(0);
    expect(Math.abs(surface.packed[3] ?? 0)).toBeGreaterThan(0);
    surfaces.draw(600 + BLOOD_LIFETIME_TICKS);
    expect([...surface.packed]).toEqual(new Array(4).fill(0));
    root.destroy({ children: true });
  });

  it('does not rewind newer patches when the camera first reveals an older impact', () => {
    const root = new Container();
    const surface = bloodSurface(sprite(root), 0);
    const surfaces = new BloodSurfaces();
    const base = { surface, y: 0.5, radius: 2, angle: Math.PI / 2, age: 0 };
    for (let i = 0; i < 3; i++) surfaces.stamp({ ...base, x: 0.1 + i * 0.4 }, 5 + i);
    surfaces.draw(14);
    const recent = [...surface.packed];
    surfaces.stamp({ ...base, x: 0.9, y: 0.9, angle: 0 }, 1);
    expect([...surface.packed]).toEqual(recent);
    surfaces.stamp({ ...base, x: 0.9, angle: 0 }, 1);
    expect(surface.packed[3]).toBe(recent[3]);
    expect(Math.floor((surface.packed[2] ?? 0) / 1048576)).toBe(4); // The latest direction survives.
    surfaces.draw(10 + BLOOD_LIFETIME_TICKS);
    expect([...surface.packed]).toEqual(new Array(4).fill(0));
    root.destroy({ children: true });
  });

  it('keeps separate stains until the ground-blood lifetime even when new impacts saturate a surface', () => {
    const root = new Container();
    const surface = bloodSurface(sprite(root), 0);
    const surfaces = new BloodSurfaces();
    const base = { surface, radius: 2, angle: 0, age: 0 };
    for (let i = 0; i < 3; i++) surfaces.stamp({ ...base, x: 0.1 + (i % 2) * 0.8, y: i < 2 ? 0.1 : 0.9 }, 0);
    surfaces.draw(10);
    const shapes = [0, 1, 2].map((i) => surface.packed[i]);
    for (const tick of [20, 600, 1000, BLOOD_LIFETIME_TICKS - 1]) {
      surfaces.stamp({ ...base, x: 0.5, y: 0.5 }, tick);
      surfaces.draw(tick);
      expect([0, 1, 2].map((i) => surface.packed[i])).toEqual(shapes);
      expect(Math.abs(surface.packed[3] ?? 0)).toBeGreaterThan(0);
    }
    surfaces.draw(BLOOD_LIFETIME_TICKS);
    expect([...surface.packed]).toEqual(new Array(4).fill(0));
    root.destroy({ children: true });
  });

  it('refreshes an impact inside a large stain without shrinking it or consuming another slot', () => {
    const root = new Container();
    const surface = bloodSurface(sprite(root), 0);
    const surfaces = new BloodSurfaces();
    const base = { surface, x: 0.5, y: 0.5, angle: 0, age: 0 };
    surfaces.stamp({ ...base, radius: 12 }, 0);
    surfaces.draw(600);
    const shape = surface.packed[0] ?? 0;
    surfaces.stamp({ ...base, x: 0.7, radius: 2, angle: Math.PI / 2 }, 600);
    expect((surface.packed[0] ?? 0) % 65536).toBe(shape % 65536);
    expect(Math.floor((surface.packed[0] ?? 0) / 65536) % 16).toBeGreaterThanOrEqual(12);
    expect(surface.packed[1]).toBe(0);
    expect(Math.abs(surface.packed[3] ?? 0)).toBe(1);
    surfaces.draw(BLOOD_LIFETIME_TICKS);
    expect(surface.packed[0]).toBeGreaterThan(0);
    surfaces.draw(600 + BLOOD_LIFETIME_TICKS);
    expect([...surface.packed]).toEqual(new Array(4).fill(0));
    root.destroy({ children: true });
  });

  it('retains the newest stain when earlier stains expire', () => {
    const root = new Container();
    const surface = bloodSurface(sprite(root), 0);
    const surfaces = new BloodSurfaces();
    for (let i = 0; i < 3; i++)
      surfaces.stamp(
        { surface, x: 0.1 + (i % 3) * 0.4, y: i < 2 ? 0.1 : 0.9, radius: 2, angle: 0, age: 0 },
        i < 2 ? 0 : 600 + i,
      );
    surfaces.draw(700);
    const newerShape = surface.packed[2];
    surfaces.draw(BLOOD_LIFETIME_TICKS);
    expect(surface.packed[0]).toBe(newerShape);
    expect(surface.packed.slice(1, 3).every((value) => value === 0)).toBe(true);
    const ages = Math.abs(surface.packed[3] ?? 0);
    expect(ages).toBeGreaterThan(100);
    expect(ages).toBeLessThan(200);
    surfaces.draw(605 + BLOOD_LIFETIME_TICKS);
    expect([...surface.packed]).toEqual(new Array(4).fill(0));
    root.destroy({ children: true });
  });
});
