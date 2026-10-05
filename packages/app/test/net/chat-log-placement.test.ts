import { describe, expect, it } from 'vitest';
import { NOTICE_COLUMN } from '../../src/hud/regions.js';
import { chatLogArea, chatLogPlacement } from '../../src/view/net/chat-panel.js';

const VIEWPORT = { width: 1600, height: 1000 };
const BEAM = { x: 556, y: 916, w: 488, h: 84 };
const MINIMAP = { x: 0, y: 700, w: 300, h: 300 };
const HUD_SCALE = 1.5;

describe('chat log placement', () => {
  it('stands on the minimap, right of the notice column at the HUD scale', () => {
    const area = chatLogArea(HUD_SCALE, VIEWPORT.height, MINIMAP);
    expect(area.floor).toBe(MINIMAP.y);
    expect(area.left).toBeGreaterThan((NOTICE_COLUMN.left + NOTICE_COLUMN.width) * HUD_SCALE);
    expect(chatLogPlacement(area, VIEWPORT, BEAM)).toEqual({ left: area.left, bottom: 312, width: 380 });
  });

  it('stands on the bottom edge without a minimap, narrowed to end before the beam', () => {
    const area = chatLogArea(1, VIEWPORT.height, null);
    expect(area.floor).toBe(VIEWPORT.height);
    expect(chatLogPlacement({ left: 250, floor: VIEWPORT.height }, VIEWPORT, BEAM)).toEqual({
      left: 250,
      bottom: 12,
      width: 294,
    });
  });

  it('rises above the beam when too little is left beside it, never past the right edge', () => {
    const floor = VIEWPORT.height;
    expect(chatLogPlacement({ left: 489, floor }, VIEWPORT, BEAM)).toEqual({
      left: 489,
      bottom: 96,
      width: 380,
    });
    expect(chatLogPlacement({ left: 489, floor }, { width: 700, height: 1000 }, BEAM)).toMatchObject({
      width: 199,
    });
  });
});
