import { type Entity, positionOfNode, type SimEvent } from '@open-northland/sim';
import { Container, Sprite } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import {
  BLOOD_AIR_TICKS,
  BLOOD_LIFETIME_TICKS,
  type BloodDropPose,
  bloodDroplet,
  bloodDrops,
  bloodFade,
  foldBloodMarks,
  MAX_BLOOD_MARKS,
  MAX_BLOOD_PER_NODE,
} from '../src/data/effects/blood.js';
import { screenDepth } from '../src/data/scene/index.js';
import { NO_WATER } from '../src/data/terrain/index.js';
import { type BloodFrame, BloodLayer } from '../src/gpu/overlays/blood-layer.js';
import { cameraViewport, makeElevationField } from '../src/index.js';
import { snapshotOf } from './support/fixtures.js';

const hit = (target = 2, weaponMainType = 3, hx = 4, hy = 6): SimEvent => ({
  kind: 'combatHit',
  attacker: 1 as Entity,
  target: target as Entity,
  weaponMainType,
  at: { hx, hy },
});
const shot: SimEvent = {
  kind: 'projectileHit',
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
  const result = foldBloodMarks([], [hit()], 0)[0];
  if (result === undefined) throw new Error('hit must produce a mark');
  return result;
}

describe('blood event history', () => {
  it('distinguishes cuts, punctures and blunt hits; only a hit paired with death leaves a pool', () => {
    expect(
      foldBloodMarks([], [hit(), hit(3, 2, 5), hit(4, 1, 6), shot, death], 10).map((m) => [
        m.profile,
        m.fatal,
      ]),
    ).toEqual([
      ['cut', false],
      ['pierce', false],
      ['blunt', false],
      ['pierce', true],
    ]);
    expect(foldBloodMarks([], [death, { ...death, cause: 'starvation' }], 10)).toEqual([]);
    expect(
      foldBloodMarks([], [{ ...shot, structure: true }, { ...hit(), structure: true } as SimEvent], 10),
    ).toEqual([]);
  });

  it('uses the attacker and the isometric row stagger for the incoming direction', () => {
    const source = (hx: number, hy: number) =>
      snapshotOf([{ id: 1, components: { Position: positionOfNode(hx, hy) } }]);
    expect(foldBloodMarks([], [hit(2, 3, 5, 7)], 0, source(4, 7))[0]?.heading).toBeCloseTo(0);
    expect(foldBloodMarks([], [hit(2, 3, 5, 7)], 0, source(6, 7))[0]?.heading).toBeCloseTo(Math.PI);
    expect(foldBloodMarks([], [hit(2, 3, 5, 7)], 0, source(5, 6))[0]?.heading).toBeCloseTo(Math.PI / 2);
  });

  it('uses a projectile launch origin after the shooter moves or disappears', () => {
    const launches = new Map([[7, { hx: 2, hy: 6 }]]);
    const moved = snapshotOf([{ id: 1, components: { Position: positionOfNode(8, 6) } }]);
    expect(foldBloodMarks([], [shot], 20, moved, launches)[0]?.heading).toBeCloseTo(0);
    expect(foldBloodMarks([], [shot], 20, snapshotOf([]), launches)[0]?.heading).toBeCloseTo(0);
  });

  it('gives simultaneous impacts on the same victim different patterns', () => {
    const marks = foldBloodMarks([], [hit(), { ...hit(), attacker: 8 as Entity } as SimEvent, shot], 1);
    expect(new Set(marks.map((m) => m.seed)).size).toBe(3);
  });

  it('bounds both a crowded node and a whole battlefield, keeping the newest marks', () => {
    const crowded = foldBloodMarks(
      [],
      Array.from({ length: 1000 }, (_, i) => hit(i)),
      10,
    );
    expect(crowded).toHaveLength(MAX_BLOOD_PER_NODE);
    const battlefield = foldBloodMarks(
      [],
      Array.from({ length: 1000 }, (_, i) => hit(i, 3, i)),
      0,
    );
    expect(battlefield).toHaveLength(MAX_BLOOD_MARKS);
    expect(battlefield[0]?.hx).toBe(1000 - MAX_BLOOD_MARKS);
    const later = foldBloodMarks(battlefield, [hit(4000, 3, 4000)], 1);
    expect(later.at(-1)?.hx).toBe(4000);
    expect(foldBloodMarks(later, [], 2)).toBe(later);
    expect(foldBloodMarks(later, [], BLOOD_LIFETIME_TICKS)).toHaveLength(1);
    expect(foldBloodMarks(later, [], BLOOD_LIFETIME_TICKS + 1)).toEqual([]);
  });
});

describe('ballistics and drying', () => {
  it('launches near the torso and lands at a stable ground point without a layer-change jump', () => {
    for (let seed = 0; seed < 32; seed++) {
      for (const drop of bloodDrops({ ...mark(), seed, fatal: true })) {
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
        expect(drop.delay + drop.flight + 1.5).toBeLessThan(BLOOD_AIR_TICKS);
      }
    }
  });

  it('keeps normal hits smaller than fatal hits and fists quieter than blades', () => {
    const cut = bloodDrops(mark());
    expect(bloodDrops({ ...mark(), profile: 'blunt' }).length).toBeLessThan(cut.length);
    expect(bloodDrops({ ...mark(), fatal: true }).length).toBeGreaterThan(cut.length);
    expect(new Set(cut.map((d) => d.flight)).size).toBe(cut.length);
    expect(bloodFade(0)).toBe(1);
    expect(bloodFade(300)).toBe(1);
    expect(bloodFade(600)).toBeGreaterThan(bloodFade(600.5));
    expect(bloodFade(BLOOD_LIFETIME_TICKS)).toBe(0);
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
    const freshTint = ground?.tint;
    draw(layer, 30);
    expect(air?.visible).toBe(false);
    expect(ground?.children[0]?.alpha).toBeGreaterThan(0);
    draw(layer, 300);
    expect(ground?.tint).not.toBe(freshTint);
    expect(layer.groundContainer.children[0]).toBe(ground);
    draw(layer, BLOOD_LIFETIME_TICKS);
    expect(layer.groundContainer.children).toHaveLength(0);
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
    expect(sprites.children[0]?.visible).toBe(false);
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
    expect(sprites.children[0]?.children.every((c) => c.x > 0)).toBe(true);
    layer.destroy();
  });

  it('clears immediately when disabled, ignores disabled hits, and never resurrects them', () => {
    const sprites = new Container();
    const layer = new BloodLayer(sprites);
    layer.ingest([hit()], 0);
    draw(layer, 3);
    const air = sprites.children[0];
    layer.setEnabled(false);
    expect(air?.destroyed).toBe(true);
    expect(layer.groundContainer.children).toHaveLength(0);
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
    layer.ingest([hit()], 0);
    draw(layer, 2);
    const air = sprites.children[0];
    draw(layer, 3, { viewport: { minX: 10000, maxX: 11000, minY: 10000, maxY: 11000 } });
    expect(air?.destroyed).toBe(true);
    draw(layer, 50, { water: { ...NO_WATER, surface: () => 1 } });
    expect(layer.groundContainer.children[0]?.alpha).toBe(0);
    expect(sprites.children[0]?.visible).toBe(false);
    draw(layer, 51);
    expect(layer.groundContainer.children[0]?.alpha).toBe(1);
    layer.destroy();
  });

  it('fits the wound to the body and keeps the first landing pattern after a camera return', () => {
    const sprites = new Container();
    const layer = new BloodLayer(sprites);
    layer.ingest([hit()], 0);
    draw(layer, 0, {
      drawn: { anchorOf: () => undefined, boundsOf: () => ({ minX: 0, maxX: 20, minY: 0, maxY: 20 }) },
    });
    expect(sprites.children[0]?.children.every((c) => c.y > -10 && c.y < -5)).toBe(true);
    draw(layer, 30);
    const ground = layer.groundContainer.children[0]?.children[1];
    const landings = ground?.children.map((c) => [c.x, c.y]);
    draw(layer, 31, { viewport: { minX: 10000, maxX: 11000, minY: 10000, maxY: 11000 } });
    draw(layer, 32, {
      drawn: { anchorOf: () => undefined, boundsOf: () => ({ minX: 0, maxX: 40, minY: 0, maxY: 60 }) },
    });
    expect(layer.groundContainer.children[0]?.children[1]?.children.map((c) => [c.x, c.y])).toEqual(landings);
    layer.destroy();
  });

  it('shares one texture source across all impressions and frees it at teardown', () => {
    const layer = new BloodLayer(new Container());
    layer.ingest([hit(), hit(3, 2, 5), hit(4, 1, 6)], 0);
    draw(layer, 30);
    const textures = layer.groundContainer.children
      .flatMap((node) => node.children)
      .filter((node): node is Sprite => node instanceof Sprite)
      .map((node) => node.texture);
    expect(new Set(textures.map((texture) => texture.source)).size).toBe(1);
    const source = textures[0]?.source;
    layer.destroy();
    expect(source?.destroyed).toBe(true);
  });
});
