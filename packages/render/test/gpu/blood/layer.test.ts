import { type Entity, positionOfNode, type SimEvent } from '@open-northland/sim';
import { Container, Mesh, Rectangle, Texture, TextureSource } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';
import {
  BLOOD_AIR_TICKS,
  BLOOD_LIFETIME_TICKS,
  type BloodDropPose,
  type BloodMark,
  bloodDroplet,
  bloodDrops,
  MAX_BLOOD_MARKS,
  MAX_BLOOD_PER_NODE,
  makeBloodMarks,
} from '../../../src/data/effects/blood.js';
import { BloodHistory } from '../../../src/data/effects/blood-history.js';
import { screenDepth } from '../../../src/data/scene/index.js';
import { NO_WATER } from '../../../src/data/terrain/index.js';
import { GROUND_QUAD_DATA_FLOATS, GROUND_QUAD_INDICES } from '../../../src/gpu/blood/ground.js';
import { type BloodFrame, BloodLayer } from '../../../src/gpu/blood/layer.js';
import { BloodSurfaceSprite, bloodSurface } from '../../../src/gpu/blood/surface-sprite.js';
import * as alphaMasks from '../../../src/gpu/sprite-pool/picking/alpha-mask.js';
import { cameraViewport, makeElevationField, TILE_HALF_W } from '../../../src/index.js';
import { snapshotOf } from '../../support/fixtures.js';
import { useHeadlessShaderContext } from '../../support/shader-context.js';

const hit = (target = 2, weaponMainType = 3, hx = 4, hy = 6): SimEvent => ({
  kind: 'combatHit',
  damage: 250,
  targetMaxHealth: 1000,
  attacker: 1 as Entity,
  target: target as Entity,
  weaponMainType,
  at: { hx, hy },
});
const shot: SimEvent = {
  kind: 'projectileHit',
  damage: 250,
  targetMaxHealth: 1000,
  shooter: 1 as Entity,
  projectile: 7 as Entity,
  target: 2 as Entity,
  munitionType: 1,
  at: { hx: 4, hy: 6 },
};
const death: SimEvent = {
  kind: 'settlerDied',
  entity: 2 as Entity,
  cause: 'damage',
  player: 0,
  at: { hx: 4, hy: 6 },
};
const flat = makeElevationField(undefined, 0, 0);
const vp = cameraViewport({ offsetX: 400, offsetY: 300, scale: 1 }, 800, 600, 512);
const draw = (layer: BloodLayer, renderTime: number, over: Partial<BloodFrame> = {}): void => {
  layer.draw({ elevation: flat, viewport: vp, water: NO_WATER, renderTime, ...over });
};
const pose = (): BloodDropPose => ({
  x: 0,
  y: 0,
  groundY: 0,
  angle: 0,
  stretch: 1,
  landed: false,
  visible: false,
});

function mark() {
  const result = makeBloodMarks([hit()], 0)[0];
  if (result === undefined) throw new Error('hit must produce a mark');
  return result;
}

describe('blood event history', () => {
  it('distinguishes cuts, punctures and blunt hits and marks only the final impact as fatal', () => {
    expect(
      makeBloodMarks([hit(), hit(3, 2, 5), hit(4, 1, 6), shot, death], 10).map((m) => [m.profile, m.fatal]),
    ).toEqual([
      ['cut', false],
      ['pierce', false],
      ['blunt', false],
      ['pierce', true],
    ]);
    expect(makeBloodMarks([death, { ...death, cause: 'starvation' }], 10)).toEqual([]);
    expect(
      makeBloodMarks([{ ...shot, structure: true }, { ...hit(), structure: true } as SimEvent], 10),
    ).toEqual([]);
  });

  it('suppresses protected hits and scales blood to damage after armor, including a small lethal wound', () => {
    expect(makeBloodMarks([{ ...shot, damage: 0 }], 0)).toEqual([]);
    const [graze, wound] = makeBloodMarks(
      [
        { ...shot, damage: 1 },
        { ...shot, damage: 250 },
      ],
      0,
    );
    if (graze === undefined || wound === undefined) throw new Error('Missing wounds');
    expect(graze.amount).toBeCloseTo(0.004);
    expect(wound.amount).toBe(1);
    const small = bloodDrops(graze);
    const large = bloodDrops(wound);
    expect(small.length).toBeLessThan(large.length);
    expect(Math.max(...small.map((drop) => drop.size))).toBeLessThan(
      Math.min(...large.map((drop) => drop.size)),
    );
    const [fatal] = makeBloodMarks([{ ...shot, damage: 1 }, death], 0);
    expect(fatal).toMatchObject({ fatal: true, amount: graze.amount });
  });

  it('uses the attacker and the isometric row stagger for the incoming direction', () => {
    const source = (hx: number, hy: number) =>
      snapshotOf([{ id: 1, components: { Position: positionOfNode(hx, hy) } }]);
    expect(makeBloodMarks([hit(2, 3, 5, 7)], 0, source(4, 7))[0]?.heading).toBeCloseTo(0);
    expect(makeBloodMarks([hit(2, 3, 5, 7)], 0, source(6, 7))[0]?.heading).toBeCloseTo(Math.PI);
    // Two half-rows straight up the column; one half-row up is a slanted edge.
    expect(makeBloodMarks([hit(2, 3, 5, 7)], 0, source(5, 5))[0]?.heading).toBeCloseTo(Math.PI / 2);
  });

  it('uses a projectile launch origin after the shooter moves or disappears', () => {
    const launches = new Map([[7, { hx: 2, hy: 6 }]]);
    const moved = snapshotOf([{ id: 1, components: { Position: positionOfNode(8, 6) } }]);
    expect(makeBloodMarks([shot], 20, moved, launches)[0]?.heading).toBeCloseTo(0);
    expect(makeBloodMarks([shot], 20, snapshotOf([]), launches)[0]?.heading).toBeCloseTo(0);
  });

  it('gives simultaneous impacts on the same victim different patterns', () => {
    const marks = makeBloodMarks([hit(), { ...hit(), attacker: 8 as Entity } as SimEvent, shot], 1);
    expect(new Set(marks.map((m) => m.seed)).size).toBe(3);
  });

  it('bounds crowded nodes and the battlefield incrementally, preserving the newest marks', () => {
    const removed = vi.fn();
    const history = new BloodHistory(removed);
    history.ingest(
      Array.from({ length: 1000 }, (_, i) => hit(i)),
      10,
    );
    expect(history.size).toBe(MAX_BLOOD_PER_NODE);
    history.clear();
    history.ingest(
      Array.from({ length: MAX_BLOOD_MARKS + 100 }, (_, i) => hit(i, 3, i)),
      20,
    );
    expect(history.size).toBe(MAX_BLOOD_MARKS);
    expect(history.values()[0]?.hx).toBe(100);
    history.ingest([hit(9000, 3, 9000)], 21);
    expect(history.values().at(-1)?.hx).toBe(9000);
    const revision = history.revision;
    history.ingest([], 22);
    expect(history.revision).toBe(revision);
    history.expire(20 + BLOOD_LIFETIME_TICKS);
    expect(history.size).toBe(1);
    history.expire(21 + BLOOD_LIFETIME_TICKS);
    expect(history.size).toBe(0);
    expect(removed).toHaveBeenCalledTimes(1000 + MAX_BLOOD_MARKS + 101);
  });
});

describe('blood history query', () => {
  it('returns the marks in a view oldest first, both for a few and for most of the battlefield', () => {
    const history = new BloodHistory(() => undefined);
    // Alternate marks between a far-east and a far-west bucket, so the bucket walk meets every even
    // mark before any odd one.
    const SPREAD = 64;
    const NODE_COLUMNS = 8;
    for (let i = 0; i < SPREAD; i++) {
      const k = Math.floor(i / 2);
      const hx = (i % 2 === 0 ? 4000 : 8) + (k % NODE_COLUMNS);
      history.ingest([hit(i, 3, hx, Math.floor(k / NODE_COLUMNS))], i);
    }
    // A small cluster split over two neighbouring buckets, the newer marks in the western one.
    const CLUSTER = 6;
    for (let j = 0; j < CLUSTER; j++)
      history.ingest([hit(SPREAD + j, 3, (j % 2 === 0 ? 2008 : 2000) + j, 0)], SPREAD + j);
    const targets = (marks: readonly BloodMark[]): number[] => marks.map((mark) => mark.target);
    const ids = (from: number, count: number): number[] => Array.from({ length: count }, (_, i) => from + i);
    const out: BloodMark[] = [];
    history.query({ minX: -1000, minY: -1000, maxX: 200000, maxY: 2000 }, 0, out);
    expect(targets(out)).toEqual(ids(0, SPREAD + CLUSTER));
    expect(out).toEqual(history.values());
    history.query({ minX: 2000 * TILE_HALF_W, minY: -100, maxX: 2015 * TILE_HALF_W, maxY: 100 }, 0, out);
    expect(targets(out)).toEqual(ids(SPREAD, CLUSTER));
  });
});

describe('ballistics', () => {
  it('launches near the torso and lands at a stable ground point without a layer-change jump', () => {
    for (let seed = 0; seed < 32; seed++) {
      for (const drop of bloodDrops({ ...mark(), seed, fatal: true }, 34)) {
        const p = pose();
        bloodDroplet(drop, 0, p);
        expect(p.y).toBeLessThan(-8);
        expect(p.landed).toBe(false);
        bloodDroplet(drop, drop.delay + drop.flight - 0.0001, p);
        const contactX = p.x;
        const contactY = p.y;
        bloodDroplet(drop, drop.delay + drop.flight, p);
        expect(p.landed).toBe(true);
        expect(p.x).toBeCloseTo(contactX, 2);
        expect(p.y).toBeCloseTo(contactY, 2);
        expect(p.y).toBeCloseTo(p.groundY);
        const landing = { ...p };
        bloodDroplet(drop, 100, p);
        expect(p).toEqual(landing);
        expect(drop.delay + drop.flight).toBeLessThan(BLOOD_AIR_TICKS);
        expect(Math.abs(drop.vy * drop.flight)).toBeLessThan(24); // Facade projection's broad-phase margin.
      }
    }
  });

  it('keeps normal hits smaller than fatal hits and fists quieter than blades', () => {
    const cut = bloodDrops(mark());
    expect(bloodDrops({ ...mark(), profile: 'blunt' }).length).toBeLessThan(cut.length);
    expect(bloodDrops({ ...mark(), fatal: true }).length).toBeGreaterThan(cut.length);
    expect(new Set(cut.map((d) => d.flight)).size).toBe(cut.length);
  });
});

describe('blood layer', () => {
  it('sorts the burst on the victim and leaves lasting stains solely on the ground', () => {
    const sprites = new Container();
    const layer = new BloodLayer(sprites);
    layer.ingest([hit(), death], 0);
    draw(layer, 3);
    const air = sprites.children[0];
    const ground = layer.groundContainer.children[0];
    expect(air?.zIndex).toBeCloseTo(screenDepth(4 * 34, 6 * 19, 'settler') + 0.125);
    expect(air?.children.some((c) => c.visible)).toBe(true);
    draw(layer, 30);
    expect(air?.destroyed).toBe(true);
    expect(ground).toBeInstanceOf(Mesh);
    expect(ground?.visible).toBe(true);
    draw(layer, 300);
    expect(layer.groundContainer.children[0]).toBe(ground);
    draw(layer, BLOOD_LIFETIME_TICKS);
    expect(ground?.visible).toBe(false);
    expect(air?.destroyed).toBe(true);
    layer.destroy();
  });

  it('hides an airborne burst when its cell becomes fogged without replaying it on return', () => {
    const sprites = new Container();
    const layer = new BloodLayer(sprites);
    layer.ingest([hit()], 0);
    draw(layer, 3, { fogVisible: () => true });
    expect(sprites.children[0]?.visible).toBe(true);
    draw(layer, 4, { fogVisible: () => false });
    expect(sprites.children[0]?.visible).toBe(false);
    draw(layer, 5, { fogVisible: () => true });
    expect(sprites.children[0]?.visible).toBe(true);
    draw(layer, 30, { fogVisible: () => true });
    expect(sprites.children).toHaveLength(0);
    layer.destroy();
  });

  it('retains the flight origin across frames and positions the burst on elevated ground', () => {
    const sprites = new Container();
    const layer = new BloodLayer(sprites);
    layer.ingest(
      [
        {
          kind: 'projectileLaunched',
          projectile: 7 as Entity,
          shooter: 1 as Entity,
          target: 2 as Entity,
          munitionType: 1,
          at: { hx: 0, hy: 6 },
        },
      ],
      0,
    );
    layer.ingest([shot], 20, snapshotOf([]));
    draw(layer, 23, { elevation: { maxLift: 50, liftAt: () => 50, liftAtNode: () => 50 } });
    expect(sprites.children[0]?.y).toBe(6 * 19 - 50);
    expect(sprites.children[0]?.children.slice(1).every((c) => c.x > 0)).toBe(true);
    layer.destroy();
  });

  it('clears immediately when disabled, ignores disabled hits, and never resurrects them', () => {
    const sprites = new Container();
    const layer = new BloodLayer(sprites);
    layer.ingest([hit()], 0);
    draw(layer, 3);
    const air = sprites.children[0];
    expect(air?.children[0]?.alpha).toBeGreaterThan(0); // the impact reads before the drops land
    expect(layer.groundContainer.children[0]?.visible).toBe(true);
    layer.setEnabled(false);
    expect(air?.destroyed).toBe(true);
    expect(layer.groundContainer.children.every((node) => !node.visible)).toBe(true);
    layer.ingest([hit()], 10);
    layer.setEnabled(true);
    draw(layer, 20);
    expect(sprites.children).toHaveLength(0);
    layer.ingest([hit()], 21);
    draw(layer, 22);
    expect(sprites.children).toHaveLength(1);
    layer.destroy();
    expect(sprites.children).toHaveLength(0);
  });

  it('retires off-screen sprites, restores only ground on return, and suppresses stains on water', () => {
    const sprites = new Container();
    const layer = new BloodLayer(sprites);
    layer.ingest([hit()], 0, snapshotOf([{ id: 1, components: { Position: positionOfNode(4, 8) } }]));
    // The feet are below the screen, but the upward jet from a tall fighter still crosses its edge.
    draw(layer, 3, {
      screenViewport: { minX: 0, maxX: 300, minY: 0, maxY: 60 },
      drawn: { anchorOf: () => undefined, boundsOf: () => ({ minX: 0, maxX: 40, minY: 0, maxY: 80 }) },
    });
    expect(sprites.children).toHaveLength(1);
    const air = sprites.children[0];
    draw(layer, 3, { screenViewport: { minX: 10000, maxX: 11000, minY: 10000, maxY: 11000 } });
    expect(air?.destroyed).toBe(true);
    draw(layer, 50, { water: { ...NO_WATER, surface: () => 1 } });
    expect(layer.groundContainer.children[0]?.visible).toBe(false);
    expect(sprites.children).toHaveLength(0);
    draw(layer, 51);
    expect(layer.groundContainer.children[0]?.visible).toBe(true);
    layer.destroy();
  });

  it('fits the wound to the body and keeps the first landing pattern after a camera return', () => {
    const sprites = new Container();
    const layer = new BloodLayer(sprites);
    layer.ingest([hit()], 0);
    draw(layer, 0, {
      drawn: { anchorOf: () => undefined, boundsOf: () => ({ minX: 0, maxX: 20, minY: 0, maxY: 20 }) },
    });
    expect(sprites.children[0]?.children.every((c) => c.y > -14 && c.y < -11)).toBe(true);
    draw(layer, 30);
    const ground = groundMesh(layer);
    const landings = [...ground.geometry.getBuffer('aPosition').data];
    draw(layer, 31, { viewport: { minX: 10000, maxX: 11000, minY: 10000, maxY: 11000 } });
    draw(layer, 32, {
      drawn: { anchorOf: () => undefined, boundsOf: () => ({ minX: 0, maxX: 40, minY: 0, maxY: 60 }) },
    });
    expect([...ground.geometry.getBuffer('aPosition').data]).toEqual(landings);
    layer.destroy();
  });

  it('keeps atlas corners transparent, shares one source and frees it at teardown', () => {
    const layer = new BloodLayer(new Container());
    layer.ingest([hit(), hit(3, 2, 5), hit(4, 1, 6)], 0);
    draw(layer, 30);
    const textures = [groundMesh(layer).texture];
    expect(new Set(textures.map((texture) => texture.source)).size).toBe(1);
    const source = textures[0]?.source;
    const pixels = source?.resource;
    if (source === undefined || !(pixels instanceof Uint8Array)) throw new Error('missing blood atlas');
    for (const texture of textures) {
      const { x, y, width, height } = texture.frame;
      for (const [px, py] of [
        [x, y],
        [x + width - 1, y],
        [x, y + height - 1],
        [x + width - 1, y + height - 1],
      ]) {
        if (px === undefined || py === undefined) throw new Error('missing atlas corner');
        expect(pixels[(py * source.width + px) * 4 + 3]).toBe(0);
      }
    }
    const buffers = [...groundMesh(layer).geometry.buffers];
    layer.destroy();
    expect(source?.destroyed).toBe(true);
    expect(buffers.every((buffer) => buffer.destroyed)).toBe(true);
  });
});

function groundMesh(layer: BloodLayer): Mesh {
  const mesh = layer.groundContainer.children[0];
  if (!(mesh instanceof Mesh)) throw new Error('missing ground mesh');
  return mesh;
}

it('does no terrain or body work for offscreen history, and does not rewrite a settled mesh each frame', () => {
  const sprites = new Container();
  const layer = new BloodLayer(sprites);
  layer.ingest(
    Array.from({ length: MAX_BLOOD_MARKS }, (_, i) => hit(i, 3, 1000 + i)),
    0,
  );
  const liftAtNode = vi.fn(() => 0);
  const surface = vi.fn(() => 0);
  const boundsOf = vi.fn(() => undefined);
  const frame = {
    elevation: { ...flat, maxLift: 1, liftAtNode },
    water: { ...NO_WATER, surface },
    drawn: { anchorOf: () => undefined, boundsOf },
  };
  draw(layer, 50, frame);
  expect(liftAtNode).not.toHaveBeenCalled();
  expect(surface).not.toHaveBeenCalled();
  expect(boundsOf).not.toHaveBeenCalled();
  expect(layer.groundContainer.children).toHaveLength(0);
  layer.ingest([hit()], 51);
  draw(layer, 100, frame);
  expect(liftAtNode).toHaveBeenCalledTimes(1);
  const mesh = groundMesh(layer);
  const updates = vi.fn();
  for (const buffer of mesh.geometry.buffers) {
    buffer.on('update', updates);
    buffer.on('change', updates);
  }
  for (let tick = 100; tick < 120; tick += 0.25) {
    layer.ingest([], Math.floor(tick));
    draw(layer, tick, frame);
  }
  expect(liftAtNode).toHaveBeenCalledTimes(1);
  expect(surface).toHaveBeenCalledTimes(1);
  expect(updates).not.toHaveBeenCalled();
  expect(layer.groundContainer.children).toHaveLength(1);
  layer.destroy();
});

it('restores overlapping stains in chronological order after a partial camera departure', () => {
  const layer = new BloodLayer(new Container());
  layer.ingest([hit(2, 3, 0, 0), hit(3, 3, 3, 0)], 0);
  const full = { minX: -50, maxX: 200, minY: -50, maxY: 50 };
  draw(layer, 100, { screenViewport: full });
  const mesh = groundMesh(layer);
  const original = [...mesh.geometry.getBuffer('aPosition').data];
  draw(layer, 100, { screenViewport: { ...full, minX: 100 } });
  draw(layer, 100, { screenViewport: full });
  expect([...mesh.geometry.getBuffer('aPosition').data]).toEqual(original);
  layer.destroy();
});

it('samples body height when a coarse bucket candidate first crosses the exact viewport', () => {
  const sprites = new Container();
  const layer = new BloodLayer(sprites);
  layer.ingest([hit(2, 3, 3, 0)], 0);
  const boundsOf = vi.fn(() => ({ minX: 0, maxX: 20, minY: 0, maxY: 20 }));
  const over = { drawn: { anchorOf: () => undefined, boundsOf } };
  draw(layer, 0, { ...over, screenViewport: { minX: -50, maxX: 10, minY: -50, maxY: 50 } });
  expect(boundsOf).not.toHaveBeenCalled();
  draw(layer, 0, { ...over, screenViewport: { minX: -50, maxX: 30, minY: -50, maxY: 50 } });
  expect(boundsOf).toHaveBeenCalledTimes(1);
  expect(sprites.children[0]?.children[0]?.y).toBeCloseTo(-12.4);
  layer.destroy();
});

it('keeps GPU buffers untouched through small pans and offscreen impacts with the same visible marks', () => {
  const layer = new BloodLayer(new Container());
  layer.ingest([hit()], 0);
  draw(layer, 100);
  const mesh = groundMesh(layer);
  const changed = vi.fn();
  for (const buffer of mesh.geometry.buffers) {
    buffer.on('update', changed);
    buffer.on('change', changed);
  }
  for (let step = 0; step < 8; step++) {
    layer.ingest([hit(99, 3, 10000 + step)], 100 + step);
    draw(layer, 100 + step, { viewport: { ...vp, minX: vp.minX + step, maxX: vp.maxX + step } });
  }
  expect(changed).not.toHaveBeenCalled();
  layer.destroy();
});

useHeadlessShaderContext();

it("uploads only the new marks' quads and the draw order when visible marks grow within capacity", () => {
  const layer = new BloodLayer(new Container());
  layer.ingest([hit()], 0);
  draw(layer, 50);
  const mesh = groundMesh(layer);
  const index = mesh.geometry.indexBuffer;
  if (index === undefined) throw new Error('missing indices');
  const data = mesh.geometry.getBuffer('aUV');
  const capacity = data.data.byteLength;
  const count = mesh.geometry.indexCount;
  const resized = vi.fn();
  data.on('change', resized);
  index.on('change', resized);
  layer.ingest([hit(3, 3, 5)], 51);
  draw(layer, 52);
  expect(mesh.geometry.indexCount).toBeGreaterThan(count);
  expect(data.data.byteLength).toBe(capacity);
  expect(resized).not.toHaveBeenCalled();
  // The first mark's quads stay where they were uploaded; only the second mark's go up.
  expect(data._updateOffset).toBe(
    (count / GROUND_QUAD_INDICES) * GROUND_QUAD_DATA_FLOATS * Float32Array.BYTES_PER_ELEMENT,
  );
  expect(index._updateSize).toBe(mesh.geometry.indexCount * Uint32Array.BYTES_PER_ELEMENT);
  layer.destroy();
});

it('deposits scenery blood at contact, retires caught drops, and clears through the blood switch', () => {
  const mask = vi
    .spyOn(alphaMasks, 'alphaMaskOf')
    .mockReturnValue({ width: 32, height: 32, bits: new Uint8Array(128).fill(255) });
  const root = new Container();
  const texture = new Texture({
    source: new TextureSource({ width: 32, height: 32 }),
    frame: new Rectangle(0, 0, 32, 32),
  });
  const wall = root.addChild(new BloodSurfaceSprite(texture));
  wall.position.set(140, 80);
  const surface = bloodSurface(wall, 114);
  const layer = new BloodLayer(root);
  try {
    layer.ingest([hit()], 0, snapshotOf([{ id: 1, components: { Position: positionOfNode(3, 6) } }]));
    draw(layer, 0);
    expect([...surface.packed]).toEqual(new Array(4).fill(0));
    const mesh = layer.groundContainer.children[0];
    if (!(mesh instanceof Mesh)) throw new Error('missing ground blood');
    const marks = layer.marks[0];
    if (marks === undefined) throw new Error('missing burst');
    expect(mesh.geometry.indexCount).toBeLessThan((bloodDrops(marks).length + 1) * 6);
    draw(layer, BLOOD_AIR_TICKS);
    expect(Math.abs(surface.packed[3] ?? 0)).toBeGreaterThan(0);
    expect(root.children).toEqual([wall]);
    layer.setEnabled(false);
    expect([...surface.packed]).toEqual(new Array(4).fill(0));
  } finally {
    mask.mockRestore();
    layer.destroy();
    root.destroy({ children: true });
  }
});

it('stains each wall its own burst reaches when bursts on different rows share one contact walk', () => {
  const mask = vi
    .spyOn(alphaMasks, 'alphaMaskOf')
    .mockReturnValue({ width: 32, height: 32, bits: new Uint8Array(128).fill(255) });
  const texture = new Texture({
    source: new TextureSource({ width: 32, height: 32 }),
    frame: new Rectangle(0, 0, 32, 32),
  });
  const root = new Container();
  // Each wall sits in a container of its own, so the walk reaches it through a nested transform; the
  // second stands where the first does relative to its burst, eight nodes right and four rows down.
  const nearHolder = root.addChild(new Container());
  nearHolder.position.set(100, 50);
  const near = nearHolder.addChild(new BloodSurfaceSprite(texture));
  near.position.set(40, 30);
  const farHolder = root.addChild(new Container());
  farHolder.position.set(300, 120);
  const far = farHolder.addChild(new BloodSurfaceSprite(texture));
  far.position.set(112, 36);
  const nearSurface = bloodSurface(near, 114);
  const farSurface = bloodSurface(far, 190);
  const layer = new BloodLayer(root);
  try {
    const second: SimEvent = { ...hit(5, 3, 12, 10), attacker: 6 as Entity } as SimEvent;
    layer.ingest(
      [hit(), second],
      0,
      snapshotOf([
        { id: 1, components: { Position: positionOfNode(3, 6) } },
        { id: 6, components: { Position: positionOfNode(11, 10) } },
      ]),
    );
    draw(layer, 0);
    draw(layer, BLOOD_AIR_TICKS);
    expect(Math.abs(nearSurface.packed[3] ?? 0)).toBeGreaterThan(0);
    expect(Math.abs(farSurface.packed[3] ?? 0)).toBeGreaterThan(0);
  } finally {
    mask.mockRestore();
    layer.destroy();
    root.destroy({ children: true });
  }
});

it('delivers contacts once when the camera leaves during flight or returns before the burst ends', () => {
  const mask = vi
    .spyOn(alphaMasks, 'alphaMaskOf')
    .mockReturnValue({ width: 32, height: 32, bits: new Uint8Array(128).fill(255) });
  const far = { minX: 10000, minY: 10000, maxX: 11000, maxY: 11000 };
  function run(frames: readonly (readonly [number, boolean])[]): number[] {
    const root = new Container();
    const wall = root.addChild(
      new BloodSurfaceSprite(new Texture({ source: new TextureSource({ width: 32, height: 32 }) })),
    );
    wall.position.set(140, 80);
    const surface = bloodSurface(wall, 114);
    const layer = new BloodLayer(root);
    layer.ingest([hit()], 0, snapshotOf([{ id: 1, components: { Position: positionOfNode(3, 6) } }]));
    for (const [tick, visible] of frames) draw(layer, tick, { viewport: visible ? vp : far });
    const result = [...surface.packed];
    layer.destroy();
    root.destroy({ children: true });
    return result;
  }
  try {
    const continuous = run([
      [0, true],
      [4, true],
      [12, true],
    ]);
    expect(Math.abs(continuous[3] ?? 0)).toBeGreaterThan(0);
    expect(
      run([
        [0, true],
        [1, false],
        [12, true],
      ]),
    ).toEqual(continuous);
    expect(
      run([
        [0, true],
        [4, true],
        [5, false],
        [6, true],
        [12, true],
      ]),
    ).toEqual(continuous);
  } finally {
    mask.mockRestore();
  }
});

it('keeps the same scenery patches when interleaved contacts arrive across skipped frames', () => {
  function run(frames: readonly number[], overlapping: boolean): number[] {
    const root = new Container();
    const wall = root.addChild(
      new BloodSurfaceSprite(
        new Texture({
          source: new TextureSource({ width: 64, height: 64 }),
        }),
      ),
    );
    const surface = bloodSurface(wall, 114);
    const layer = new BloodLayer(root);
    let index = 0;
    const trace = vi.spyOn(layer.surfaces, 'trace').mockImplementation(() => {
      const i = index++;
      return {
        surface,
        x: overlapping ? 0.5 : 0.1 + (i % 10) * 0.08,
        y: overlapping ? 0.5 : i < 10 ? 0.2 : 0.8,
        radius: 1,
        angle: i * 0.3,
        age: 10 - i * 0.45,
      };
    });
    try {
      layer.ingest([hit(2), hit(3)], 0);
      for (const tick of frames) draw(layer, tick);
      expect(index).toBe(20);
      return [...surface.packed];
    } finally {
      trace.mockRestore();
      layer.destroy();
      root.destroy({ children: true });
    }
  }
  const continuous = Array.from({ length: 49 }, (_, i) => i / 4);
  for (const overlapping of [false, true]) {
    const fine = run(continuous, overlapping);
    expect(fine.some((value) => value !== 0)).toBe(true);
    expect(run([0, 12], overlapping)).toEqual(fine);
  }
});

it('aligns the long axis of settled droplets with their travel on the projected ground', () => {
  for (const from of [positionOfNode(3, 6), positionOfNode(4, 5)]) {
    const layer = new BloodLayer(new Container());
    layer.ingest([hit()], 0, snapshotOf([{ id: 1, components: { Position: from } }]));
    draw(layer, 0);
    const burst = layer.marks[0];
    if (burst === undefined) throw new Error('missing burst');
    const drops = bloodDrops(burst);
    const positions = groundMesh(layer).geometry.getBuffer('aPosition').data;
    for (const [i, drop] of drops.entries()) {
      const at = (i + 1) * 8; // The central pool precedes the settled droplets.
      const dx = Number(positions[at + 2]) - Number(positions[at]);
      const dy = Number(positions[at + 3]) - Number(positions[at + 1]);
      expect(Math.abs(dx * drop.vy - dy * drop.vx)).toBeLessThan(0.001);
      expect(dx * drop.vx + dy * drop.vy).toBeGreaterThan(0);
    }
    layer.destroy();
  }
});

it('keeps creature pigment at death and sizes 20000 HP dragon wounds without suppressing ordinary hits', () => {
  const dragon = { tribe: 3, jobType: 32 };
  const [human, wolf, snake, beast, graze, fatal] = makeBloodMarks(
    [
      { ...shot, targetMaxHealth: 5000, targetIdentity: { tribe: 3, jobType: 32, humanForm: true } },
      { ...shot, targetMaxHealth: 5000, targetIdentity: { tribe: 6, jobType: 30 } },
      { ...shot, targetMaxHealth: 5000, targetIdentity: { tribe: 5, jobType: 30 } },
      { ...shot, targetMaxHealth: 20000, targetIdentity: dragon },
      { ...shot, damage: 1, targetMaxHealth: 20000, targetIdentity: dragon },
      { ...shot, damage: 20000, targetMaxHealth: 20000, targetIdentity: dragon },
      death,
    ],
    0,
    snapshotOf([]),
  );
  if (!human || !wolf || !snake || !beast || !graze || !fatal) throw new Error('Missing creature wounds');
  expect([human.palette, wolf.palette, snake.palette, beast.palette]).toEqual([0, 1, 2, 3]);
  expect(beast.amount).toBe(human.amount);
  expect(beast.amount).toBe(0.2);
  expect(bloodDrops(wolf).length).toBeGreaterThan(bloodDrops(human).length);
  expect(bloodDrops(beast).length).toBeGreaterThan(bloodDrops(wolf).length);
  expect(bloodDrops({ ...beast, seed: human.seed })[0]?.size).toBeGreaterThan(
    bloodDrops(human)[0]?.size ?? 0,
  );
  expect(graze.amount).toBeCloseTo(0.0008);
  expect(fatal).toMatchObject({ fatal: true, palette: 3, amount: 1 });
  expect(bloodDrops({ ...fatal, profile: 'cut' })).toHaveLength(21);
});
