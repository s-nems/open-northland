import { describe, expect, it } from 'vitest';
import { extractBuildingLandscapeOverlays, parseIniSections } from '../src/ini.js';

describe('building landscape overlays', () => {
  it('joins the authored level to a type and retains case-sensitive keys, offsets and slots', () => {
    const sections = parseIniSections(
      '[GfxHouse]\nEditName "test monument"\nLogicTribeType 2\nLogicType 0 42\nLogicType 1 43\ngfxoverlaylandscape 1 3 -8 12 "test flame"\nGfxOverlayLandscape 0 2 0 0 "ignored"\ngfxoverlaylandscape 0 10 0 0 "invalid"',
    );
    const rows = extractBuildingLandscapeOverlays(sections, { file: 'test.ini', layer: 'base' });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tribeId: 2,
      typeId: 43,
      level: 1,
      slot: 3,
      x: -8,
      y: 12,
      landscape: 'test flame',
    });
  });
});
