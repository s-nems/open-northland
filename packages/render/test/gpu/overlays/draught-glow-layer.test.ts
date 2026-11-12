import type { SimEvent } from '@open-northland/sim';
import { Container } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import type { Viewport } from '../../../src/data/projection/index.js';
import { DRAUGHT_GLOW_TICKS, DraughtGlowLayer } from '../../../src/gpu/overlays/draught-glow-layer.js';
import { drawnGeometry } from '../../support/fixtures.js';

const VIEW_ALL: Viewport = { minX: -1e6, maxX: 1e6, minY: -1e6, maxY: 1e6 };
const DRINKER = 7;
const POTION = 14;
const MEAD = 13;
const RED = 0xff0000;
const BLUE = 0x0000ff;
const SIP_TICK = 100;
/** The drinker's painter depth, as on raised ground: not the depth of its drawn feet. */
const DRINKER_DEPTH = 500;
/** A ring under the drinker and one node over it. */
const NODES_PER_SIP = 2;

const sip = (goodType: number): SimEvent => ({ kind: 'draughtDrunk', entity: DRINKER as never, goodType });
const standing = drawnGeometry({
  anchorOf: () => ({ x: 50, y: 80 }),
  depthOf: () => DRINKER_DEPTH,
});

function layerOf(colours: ReadonlyMap<number, number> | null = new Map([[POTION, RED]])) {
  const world = new Container();
  const layer = new DraughtGlowLayer(world);
  layer.setColours(colours);
  const draw = (renderTime: number, drawn = standing) =>
    layer.draw({ drawn, viewport: VIEW_ALL, renderTime });
  return { world, layer, draw };
}

describe('draught glow', () => {
  it('shows a sip of a coloured good on the drawn drinker and retires it when its time is up', () => {
    const { world, layer, draw } = layerOf();
    layer.ingest([sip(POTION)], SIP_TICK);

    draw(SIP_TICK + 1);
    expect(world.children).toHaveLength(NODES_PER_SIP);
    expect(world.children[0]?.tint).toBe(RED);
    // The ring sorts just under the drinker and the glow just over it, whatever the ground's lift.
    expect(world.children[0]?.zIndex).toBeLessThan(DRINKER_DEPTH);
    expect(world.children[1]?.zIndex).toBeGreaterThan(DRINKER_DEPTH);

    draw(SIP_TICK + DRAUGHT_GLOW_TICKS);
    expect(world.children).toHaveLength(0);
  });

  it('shows nothing for a good without a colour, or with no colours set', () => {
    const coloured = layerOf();
    coloured.layer.ingest([sip(MEAD)], SIP_TICK);
    coloured.draw(SIP_TICK + 1);
    expect(coloured.world.children).toHaveLength(0);

    const bare = layerOf(null);
    bare.layer.ingest([sip(POTION)], SIP_TICK);
    bare.draw(SIP_TICK + 1);
    expect(bare.world.children).toHaveLength(0);
  });

  it('hides while the pool does not draw the drinker and comes back with it', () => {
    const { world, layer, draw } = layerOf();
    layer.ingest([sip(POTION)], SIP_TICK);

    draw(SIP_TICK + 1, drawnGeometry());
    expect(world.children).toHaveLength(0);
    draw(SIP_TICK + 2);
    expect(world.children).toHaveLength(NODES_PER_SIP);
  });

  it('restarts in the new colour when the drinker sips another draught mid-glow', () => {
    const { world, layer, draw } = layerOf(
      new Map([
        [POTION, RED],
        [MEAD, BLUE],
      ]),
    );
    layer.ingest([sip(POTION)], SIP_TICK);
    draw(SIP_TICK + 1);
    layer.ingest([sip(MEAD)], SIP_TICK + 5);
    draw(SIP_TICK + DRAUGHT_GLOW_TICKS + 1);

    expect(world.children).toHaveLength(NODES_PER_SIP);
    expect(world.children[0]?.tint).toBe(BLUE);
  });
});
