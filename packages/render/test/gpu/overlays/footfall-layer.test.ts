import { ONE, positionOfNode, type WorldSnapshot } from '@open-northland/sim';
import { Container, type Sprite, type TextureSource } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import type { FootfallGround } from '../../../src/data/effects/index.js';
import { halfCellToScreen } from '../../../src/data/projection/index.js';
import { FootfallLayer } from '../../../src/gpu/overlays/footfall-layer.js';
import { TextureCache } from '../../../src/gpu/textures/texture-cache.js';
import type { SpriteSheet } from '../../../src/index.js';
import { snapshotOf } from '../../support/fixtures.js';

const source = {} as TextureSource;
/** One print bob per valency quarter, so the frame names the heading. */
const PRINT_BOBS = [[220], [221], [222], [223]];
const DUST_BOBS = [187, 188, 189];
const frames = [220, 221, 222, 223, ...DUST_BOBS];
const sheet: SpriteSheet = {
  source,
  atlas: { width: 0, height: 0, frames: new Map() },
  bindings: {
    settler: 0,
    resource: 0,
    building: 0,
    footfall: {
      snowSteps: { layer: 'smoke', valencies: PRINT_BOBS, loop: true, directional: false },
      beachSteps: { layer: 'smoke', valencies: PRINT_BOBS, loop: true, directional: false },
      dust: { layer: 'smoke', valencies: [DUST_BOBS], loop: false, directional: false },
    },
  },
  families: {
    smoke: {
      source,
      atlas: {
        width: 64,
        height: 8,
        frames: new Map(
          frames.map((bob, i) => [bob, { x: i * 4, y: 0, width: 4, height: 4, offsetX: 0, offsetY: 0 }]),
        ),
      },
    },
  },
};

/** Cells 0..9 of row 0 and 1 snow, cells 10.. sand. */
const WIDTH = 20;
const ground: FootfallGround = {
  width: WIDTH,
  height: 4,
  cells: Uint8Array.from({ length: WIDTH * 4 }, (_, i) => (i % WIDTH < 10 ? 1 : 3)),
};
const FLAT = { maxLift: 0, liftAt: () => 0, liftAtNode: () => 0 };
const VIEW_ALL = { minX: -1e6, maxX: 1e6, minY: -1e6, maxY: 1e6 };
const WALKER = 4;
/** A road node in the snow. */
const ROAD_HX = 8;
const ROAD_HY = 2;

/** A pair of boots worn to `degreeOfUse`. */
const bootsAt = (degreeOfUse: number) => ({
  Equipment: { boots: { goodType: 1, degreeOfUse }, tool: null, weapon: null, armor: null, misc: [] },
});

function walkerAt(hx: number, hy: number, person = true, extra: Record<string, unknown> = {}) {
  return {
    id: WALKER,
    components: { Position: positionOfNode(hx, hy), ...(person ? { Person: {} } : {}), ...extra },
  };
}

function setup(marksGround = true, footfallGround: FootfallGround | null = ground) {
  const sprites = new Container();
  const layer = new FootfallLayer(sprites, new TextureCache(), sheet);
  layer.setGround(footfallGround);
  const draw = (snapshot: WorldSnapshot, drawn = true) =>
    layer.draw({
      snapshot,
      walkers: drawn ? [{ ref: WALKER, marksGround }] : [],
      roadAt: (hx: number, hy: number) => hx === ROAD_HX && hy === ROAD_HY,
      elevation: FLAT,
      viewport: VIEW_ALL,
      renderTime: snapshot.tick,
    });
  const step = (hx: number, hy: number, tick: number, person = true) =>
    draw(snapshotOf([walkerAt(hx, hy, person)], tick));
  return { sprites, layer, step, draw };
}

const bobOf = (node: Sprite | undefined) => frames[(node?.texture.frame.x ?? -4) / 4];

describe('FootfallLayer', () => {
  it('prints a step on snow under the foot, in the ground slot, turned to the step and fading out', () => {
    const { layer, sprites, step } = setup();
    step(4, 2, 10);
    expect(layer.container.children).toHaveLength(0);
    step(5, 2, 14);
    const print = layer.container.children[0] as Sprite;
    expect(layer.container.children).toHaveLength(1);
    expect(sprites.children).toHaveLength(0);
    // East is a quarter turn: valency 1 of 4.
    expect(bobOf(print)).toBe(221);
    expect(print.alpha).toBe(0.75);
    expect(print.x).toBe(halfCellToScreen(5, 2).x);
    step(5, 2, 14 + 119);
    expect(layer.container.children[0]).toBe(print);
    step(5, 2, 14 + 120);
    expect(layer.container.children).toHaveLength(0);
  });

  it('raises dust on sand in the sprite layer, playing its frames once', () => {
    const { layer, sprites, step } = setup();
    step(24, 2, 10);
    step(25, 2, 11);
    expect(layer.container.children).toHaveLength(0);
    const dust = sprites.children[0] as Sprite;
    expect(bobOf(dust)).toBe(187);
    step(25, 2, 13);
    expect(bobOf(dust)).toBe(189);
    step(25, 2, 14);
    expect(sprites.children).toHaveLength(0);
  });

  it('leaves nothing for a jump, a road, a stand or a body that is not a person', () => {
    const { layer, step } = setup();
    step(ROAD_HX - 1, ROAD_HY, 8);
    step(ROAD_HX, ROAD_HY, 9);
    step(2, 2, 10);
    step(12, 2, 11);
    step(12, 2, 12);
    step(13, 2, 13, false);
    expect(layer.container.children).toHaveLength(0);
  });

  it('raises one mark per step however many frames draw its snapshot', () => {
    const { layer, step, draw } = setup();
    step(4, 2, 10);
    const stepped = snapshotOf([walkerAt(5, 2)], 11);
    draw(stepped);
    draw(stepped);
    expect(layer.container.children).toHaveLength(1);
  });

  it('forgets a walker that left the screen, so its return prints nothing', () => {
    const { layer, step, draw } = setup();
    step(4, 2, 10);
    draw(snapshotOf([walkerAt(5, 2)], 11), false);
    step(6, 2, 12);
    expect(layer.container.children).toHaveLength(0);
  });

  it('kicks up dust under live boots on every step, on any ground and road, even for a body that marks none', () => {
    const { layer, sprites, draw } = setup(false, null);
    const shod = (hx: number, tick: number, degree: number) =>
      draw(snapshotOf([walkerAt(hx, ROAD_HY, true, bootsAt(degree))], tick));
    shod(ROAD_HX, 10, 0);
    shod(ROAD_HX + 1, 11, 0);
    expect(layer.container.children).toHaveLength(0);
    expect(sprites.children).toHaveLength(1);
    // Worn-out boots kick up nothing.
    shod(ROAD_HX + 2, 20, ONE);
    expect(sprites.children).toHaveLength(0);
  });

  it('raises the ground mark beside the boots dust for a shod adult', () => {
    const { layer, sprites, draw } = setup();
    draw(snapshotOf([walkerAt(4, 2, true, bootsAt(0))], 10));
    draw(snapshotOf([walkerAt(5, 2, true, bootsAt(0))], 11));
    expect(layer.container.children).toHaveLength(1);
    expect(sprites.children).toHaveLength(1);
  });

  it('leaves a body that marks no ground without prints', () => {
    const { layer, step } = setup(false);
    step(4, 2, 10);
    step(5, 2, 11);
    expect(layer.container.children).toHaveLength(0);
  });

  it('holds a step past half way until the walker stands on its node', () => {
    const { layer, draw, step } = setup();
    step(4, 2, 10);
    const from = positionOfNode(4, 2);
    const to = positionOfNode(5, 2);
    const past = { x: Math.round(0.4 * from.x + 0.6 * to.x), y: to.y };
    draw(snapshotOf([{ id: WALKER, components: { Position: past, Person: {} } }], 11));
    expect(layer.container.children).toHaveLength(0);
    step(5, 2, 12);
    expect(layer.container.children).toHaveLength(1);
  });

  it('lands a held step when the walker turns to the next node before standing on it', () => {
    const { layer, draw, step } = setup();
    step(4, 2, 10);
    const a = positionOfNode(4, 2);
    const b = positionOfNode(5, 2);
    const c = positionOfNode(6, 2);
    const between = (p: typeof a, q: typeof a) => ({ x: Math.round(0.4 * p.x + 0.6 * q.x), y: p.y });
    draw(snapshotOf([{ id: WALKER, components: { Position: between(a, b), Person: {} } }], 11));
    draw(snapshotOf([{ id: WALKER, components: { Position: between(b, c), Person: {} } }], 12));
    const print = layer.container.children[0] as Sprite;
    expect(layer.container.children).toHaveLength(1);
    expect(print.x).toBe(halfCellToScreen(5, 2).x);
  });

  it('passes over the middle row of a column step, printing only the node it reaches', () => {
    const { layer, draw, step } = setup();
    step(4, 2, 10);
    const start = positionOfNode(4, 2);
    const end = positionOfNode(4, 4);
    // Just past half way, nudged off the line, the nearest node is the skipped row's.
    const middle = { x: Math.round((start.x + end.x) / 2) - 2000, y: Math.round((start.y + end.y) / 2) + 1 };
    draw(snapshotOf([{ id: WALKER, components: { Position: middle, Person: {} } }], 11));
    step(4, 4, 12);
    const print = layer.container.children[0] as Sprite;
    expect(layer.container.children).toHaveLength(1);
    expect(print.x).toBe(halfCellToScreen(4, 4).x);
    // Straight south: valency 2 of 4.
    expect(bobOf(print)).toBe(222);
  });

  it('reads the boots worn by the walk under way before the slot', () => {
    const { sprites, draw } = setup(false, null);
    const shod = (hx: number, tick: number, walked: number) =>
      draw(snapshotOf([walkerAt(hx, 2, true, { ...bootsAt(0), PathFollow: { bootsDegree: walked } })], tick));
    shod(4, 10, 0);
    shod(5, 11, ONE);
    expect(sprites.children).toHaveLength(0);
  });
});
