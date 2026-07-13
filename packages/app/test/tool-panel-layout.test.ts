import { describe, expect, it } from 'vitest';
import { bakedIconOrigin } from '../src/hud/icon-texture.js';
import {
  buildToolPanelLayout,
  DEFAULT_UI_SCALE,
  hitTestToolPanel,
  pointOverToolPanel,
  TOOL_BUTTONS,
} from '../src/hud/tool-panel/layout.js';

describe('tool-panel-layout', () => {
  it('scales the pinned design rects by the uiscale, anchored top-left', () => {
    const one = buildToolPanelLayout(1);
    const two = buildToolPanelLayout(2);
    expect(one.strip).toEqual({ x: 0, y: 10, w: 50, h: 433 });
    expect(two.strip).toEqual({ x: 0, y: 20, w: 100, h: 866 });
    expect(one.width).toBe(50);
    expect(two.width).toBe(100);
    expect(one.buttons.find((button) => button.id === 'buildings')?.placed).toEqual({
      x: 0,
      y: 41,
      w: 40,
      h: 35,
    });
  });

  it('keeps a fractional uiscale and clamps a sub-1 one to ≥ 1', () => {
    expect(buildToolPanelLayout(1.2).scale).toBe(1.2);
    expect(buildToolPanelLayout(1.2).width).toBeCloseTo(60);
    expect(buildToolPanelLayout(0).scale).toBe(1);
    expect(buildToolPanelLayout(-3).scale).toBe(1);
    expect(DEFAULT_UI_SCALE).toBe(1.4);
  });

  it('reports the design-space bounds the supersample texture must cover', () => {
    expect(buildToolPanelLayout(1).designBounds).toEqual({ x: 0, y: 10, w: 50, h: 433 });
    expect(buildToolPanelLayout(1.2).designBounds).toEqual({ x: 0, y: 10, w: 50, h: 433 });
  });

  it('hit-tests the button under a point and returns null off the buttons', () => {
    const layout = buildToolPanelLayout(2);
    const speed = layout.buttons.find((button) => button.id === 'speed');
    if (speed === undefined) throw new Error('missing speed button');
    expect(
      hitTestToolPanel(layout, speed.placed.x + speed.placed.w / 2, speed.placed.y + speed.placed.h / 2),
    ).toBe('speed');
    expect(hitTestToolPanel(layout, 2, 2)).toBeNull();
    expect(hitTestToolPanel(layout, 5000, 5000)).toBeNull();
  });

  it('claims any point over the strip for the HUD', () => {
    const layout = buildToolPanelLayout(2);
    expect(pointOverToolPanel(layout, 10, 30)).toBe(true);
    expect(pointOverToolPanel(layout, 10, 5)).toBe(false);
    expect(pointOverToolPanel(layout, 200, 30)).toBe(false);
  });

  it('carries the pinned original gfx ids for every button', () => {
    const byId = new Map(TOOL_BUTTONS.map((button) => [button.id, button.gfx]));
    expect(byId.get('buildings')).toBe(0x2a);
    expect(byId.get('statistics')).toBe(0x32);
    expect(byId.get('speed')).toBe(0x31);
  });
});

describe('baked-icon placement', () => {
  it('centres horizontally and bottom-anchors vertically', () => {
    expect(bakedIconOrigin({ x: 100, y: 200, w: 60, h: 60 }, 40, 40)).toEqual({ x: 110, y: 250 });
    expect(bakedIconOrigin({ x: 0, y: 0, w: 50, h: 50 }, 30, 20)).toEqual({ x: 10, y: 35 });
    expect(bakedIconOrigin({ x: 0, y: 0, w: 55, h: 55 }, 40, 40)).toEqual({ x: 8, y: 48 });
  });
});
