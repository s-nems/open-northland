import { describe, expect, it } from 'vitest';
import { navBeamRect } from '../../src/hud/nav-beam.js';
import { chatLogPlacement } from '../../src/view/net/chat-panel.js';

const VIEWPORT = { width: 1600, height: 1000 };
const HUD_SCALE = 1.5;
const BEAM = navBeamRect(VIEWPORT, HUD_SCALE);
/** The log's column width and the design-px gap above the beam, as the panel names them. */
const LOG_WIDTH = 380;
const BEAM_GAP = 8;

describe('chat log placement', () => {
  it('centres a fixed column on the beam, its foot a scaled gap above the beam top', () => {
    const placed = chatLogPlacement(VIEWPORT, BEAM, HUD_SCALE);
    expect(placed.width).toBe(LOG_WIDTH);
    expect(placed.left + placed.width / 2).toBe(BEAM.x + BEAM.w / 2);
    expect(VIEWPORT.height - placed.bottom).toBe(BEAM.y - BEAM_GAP * HUD_SCALE);
  });

  it('narrows and stays inside a viewport narrower than the column', () => {
    const narrow = { width: 300, height: 600 };
    const placed = chatLogPlacement(narrow, navBeamRect(narrow, 1), 1);
    expect(placed.left).toBeGreaterThanOrEqual(0);
    expect(placed.left + placed.width).toBeLessThanOrEqual(narrow.width);
    expect(placed.width).toBeLessThan(LOG_WIDTH);
  });
});
