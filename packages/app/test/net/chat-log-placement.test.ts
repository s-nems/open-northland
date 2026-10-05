import { describe, expect, it } from 'vitest';
import { chatLogPlacement } from '../../src/view/net/chat-panel.js';

const VIEWPORT = { width: 1600, height: 1000 };
const BEAM = { x: 556, y: 916, w: 488, h: 84 };

describe('chat log placement', () => {
  it('stands on the bottom edge while it ends before the beam', () => {
    expect(chatLogPlacement(100, VIEWPORT, BEAM)).toEqual({ left: 100, bottom: 12, width: 380 });
  });

  it('narrows to end before the beam while a readable column is left', () => {
    expect(chatLogPlacement(250, VIEWPORT, BEAM)).toEqual({ left: 250, bottom: 12, width: 294 });
  });

  it('rises above the beam when too little is left beside it, never past the right edge', () => {
    expect(chatLogPlacement(489, VIEWPORT, BEAM)).toEqual({ left: 489, bottom: 96, width: 380 });
    expect(chatLogPlacement(489, { width: 700, height: 1000 }, BEAM)).toMatchObject({ width: 199 });
  });
});
