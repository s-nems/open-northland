import type { WorldSnapshot } from '@open-northland/sim';
import { Container, type Sprite } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { ARC_DOTS } from '../../../src/data/effects/amulet-arcs.js';
import type { Viewport } from '../../../src/data/projection/index.js';
import { AmuletArcLayer } from '../../../src/gpu/overlays/amulet-arc-layer.js';
import { drawnGeometry, snapshotOf } from '../../support/fixtures.js';

const VIEW_ALL: Viewport = { minX: -1e6, maxX: 1e6, minY: -1e6, maxY: 1e6 };
const WEARER = 7;
const STRENGTH = 52;
const DEFENCE = 53;
const MEAD = 13;
const RED = 0xff0000;
const BLUE = 0x0000ff;
const WEARER_DEPTH = 500;
const FEET = { x: 50, y: 80 };
/** Each dot keeps a sprite under the wearer and one over. */
const ARC_SPRITES = 2 * ARC_DOTS;

const standing = drawnGeometry({ anchorOf: () => FEET, depthOf: () => WEARER_DEPTH });

const carrying = (...goods: number[]): WorldSnapshot =>
  snapshotOf([
    {
      id: WEARER,
      components: {
        Equipment: {
          boots: null,
          tool: null,
          weapon: null,
          armor: null,
          misc: goods.map((goodType) => ({ goodType, degreeOfUse: 0 })),
        },
      },
    },
  ]);

function setup(
  colours: ReadonlyMap<number, number> | null = new Map([
    [STRENGTH, RED],
    [DEFENCE, BLUE],
  ]),
) {
  const world = new Container();
  const layer = new AmuletArcLayer(world);
  layer.setColours(colours);
  const draw = (snapshot: WorldSnapshot, drawn = true, renderTime = 0) =>
    layer.draw({
      snapshot,
      walkers: drawn ? [{ ref: WEARER, marksGround: true }] : [],
      drawn: standing,
      viewport: VIEW_ALL,
      renderTime,
    });
  return { world, layer, draw };
}

describe('AmuletArcLayer', () => {
  it('draws one arc round a carrier of a coloured amulet, part over the body and part under it', () => {
    const { world, draw } = setup();
    draw(carrying(STRENGTH));
    expect(world.children).toHaveLength(ARC_SPRITES);
    const sides = new Set<number>();
    for (let time = 0; time < 50; time += 5) {
      draw(carrying(STRENGTH), true, time);
      const lit = world.children.filter((child) => child.alpha > 0);
      expect(lit).toHaveLength(ARC_DOTS);
      for (const child of lit) {
        const side = Math.sign(child.zIndex - WEARER_DEPTH);
        sides.add(side);
        // A dot under the body sits behind the feet line, one over it in front.
        expect(Math.sign(child.y - FEET.y) * side).toBeGreaterThanOrEqual(0);
      }
    }
    expect([...sides].sort()).toEqual([-1, 1]);
  });

  it('keeps every sprite at one depth while its wearer stands, so the arcs re-sort nothing', () => {
    const { world, draw } = setup();
    draw(carrying(STRENGTH));
    const depths = world.children.map((child) => child.zIndex);
    for (let time = 0; time < 50; time += 5) {
      draw(carrying(STRENGTH), true, time);
      expect(world.children.map((child) => child.zIndex)).toEqual(depths);
    }
  });

  it('draws one arc per kind carried, however many amulets of a kind', () => {
    const { world, draw } = setup();
    draw(carrying(STRENGTH, STRENGTH, STRENGTH));
    expect(world.children).toHaveLength(ARC_SPRITES);
    draw(carrying(STRENGTH, MEAD, DEFENCE));
    expect(world.children).toHaveLength(2 * ARC_SPRITES);
    const frames = new Set(world.children.map((child) => (child as Sprite).texture.frame.x));
    expect(frames.size).toBe(2);
  });

  it('drops the arc when the amulet is gone or the carrier is not drawn', () => {
    const { world, draw } = setup();
    draw(carrying(STRENGTH, DEFENCE));
    draw(carrying(DEFENCE));
    expect(world.children).toHaveLength(ARC_SPRITES);
    draw(carrying(MEAD));
    expect(world.children).toHaveLength(0);
    draw(carrying(DEFENCE));
    draw(carrying(DEFENCE), false);
    expect(world.children).toHaveLength(0);
  });

  it('draws nothing with no colours set', () => {
    const { world, draw } = setup(null);
    draw(carrying(STRENGTH));
    expect(world.children).toHaveLength(0);
  });
});
