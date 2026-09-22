import { uiManifest } from '@open-northland/art-contracts';
import { describe, expect, it } from 'vitest';
import { iconCellStyle, uiFoundationArt } from '../src/content/ui-foundation.js';

const icons = {
  file: 'icons.png',
  width: 300,
  height: 200,
  cell: 100,
  columns: 3,
  names: ['build', 'assistant', 'statistics', 'mission', 'diplomacy', 'knowledge'],
};
const manifest = {
  id: 'foundation',
  surface: { file: 'surface.png', width: 1024, height: 682 },
  icons,
  notices: {
    file: 'notices.png',
    width: 200,
    height: 100,
    cell: 100,
    columns: 2,
    names: ['shield', 'skull'],
  },
  sourceBasis: 'Synthetic fixture',
};

describe('ui foundation manifest', () => {
  it('accepts the delivered shape and rejects cells outside the atlas or duplicate names', () => {
    expect(uiManifest.safeParse(manifest).success).toBe(true);
    expect(uiManifest.safeParse({ ...manifest, icons: { ...icons, columns: 4 } }).success).toBe(false);
    expect(
      uiManifest.safeParse({ ...manifest, icons: { ...icons, names: [...icons.names, 'build'] } }).success,
    ).toBe(false);
    expect(
      uiManifest.safeParse({ ...manifest, icons: { ...icons, names: [...icons.names, 'extra'] } }).success,
    ).toBe(false);
  });
});

describe('iconCellStyle', () => {
  it('scales the atlas so one cell fills the requested box and offsets to the named cell', () => {
    expect(iconCellStyle(icons, 'build', 50)).toEqual({
      backgroundSize: '150px 100px',
      backgroundPosition: '0px 0px',
    });
    expect(iconCellStyle(icons, 'diplomacy', 50)).toEqual({
      backgroundSize: '150px 100px',
      backgroundPosition: '-50px -50px',
    });
    expect(iconCellStyle(icons, 'knowledge', 43)).toEqual({
      backgroundSize: '129px 86px',
      backgroundPosition: '-86px -43px',
    });
  });

  it('reports an unknown icon instead of showing the first cell', () => {
    expect(iconCellStyle(icons, 'people', 50)).toBeNull();
  });
});

describe('delivered ui foundation', () => {
  it('reads the public copy of the HUD chrome', () => {
    const art = uiFoundationArt();
    for (const url of [art?.surfaceUrl, art?.iconsUrl, art?.noticesUrl])
      expect(url).toContain('assets/ui/foundation/');
  });
});
