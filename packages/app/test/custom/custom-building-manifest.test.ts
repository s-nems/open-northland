import { halfCellToScreen, SYNTHETIC_BINDINGS } from '@open-northland/render';
import { describe, expect, it } from 'vitest';
import {
  customBuildingAtlas,
  customBuildingBindings,
  customBuildingFiles,
  customBuildingManifest,
  customLayerScale,
  customOverlayAtlas,
} from '../../src/custom/content/building-manifest.js';

const building = customBuildingManifest.parse({
  tribeId: 1,
  typeId: 1,
  layer: 'test-building',
  sprite: 'test.png',
  width: 200,
  height: 200,
  scale: 0.5,
  entrancePixel: { x: 100, y: 180 },
  doorNode: { x: -1, y: 3 },
  sourceBasis: 'Synthetic test fixture',
});

describe('own construction assets', () => {
  const construction = [
    { sprite: 'frame.png', timeMask: 'frame-time.png', fromPct: 0, toPct: 60 },
    { sprite: 'test.png', timeMask: 'body-time.png', fromPct: 20, toPct: 100 },
  ];
  it('binds ordered stages independently of the completed body', () => {
    const manifest = customBuildingManifest.parse({ ...building, construction });
    const binding = customBuildingBindings(SYNTHETIC_BINDINGS.building, [manifest]);
    expect(binding.byTribe?.[1]?.constructionByType?.[1]).toEqual([
      { layer: 'test-building-construction-0', bob: 0, fromPct: 0, toPct: 60 },
      { layer: 'test-building-construction-1', bob: 0, fromPct: 20, toPct: 100 },
    ]);
    expect(binding.byTribe?.[1]?.byType[1]).toEqual({ layer: 'test-building', bob: 0 });
    expect(customBuildingFiles(manifest)).toEqual([
      'test.png',
      'frame.png',
      'frame-time.png',
      'body-time.png',
    ]);
  });
  it('rejects unsafe masks, backwards windows and incomplete handoffs', () => {
    for (const stages of [
      [{ ...construction[0], timeMask: '../mask.png' }, construction[1]],
      [{ ...construction[0], fromPct: 70 }, construction[1]],
      [{ ...construction[0], fromPct: 10 }, construction[1]],
      [construction[0]],
      [construction[0], { ...construction[1], toPct: 99 }],
    ])
      expect(customBuildingManifest.safeParse({ ...building, construction: stages }).success).toBe(false);
  });
  it('rejects a stage family colliding with another building in either order', () => {
    const manifest = customBuildingManifest.parse({ ...building, construction });
    const other = { ...building, typeId: 2, layer: 'test-building-construction-0' };
    expect(() => customBuildingBindings(0, [manifest, other])).toThrow('Duplicate');
    expect(() => customBuildingBindings(0, [other, manifest])).toThrow('Duplicate');
  });
});

import { mapZoomParam } from '../../src/view/camera/map-zoom.js';

describe('custom building registry', () => {
  it('includes shadow in delivery files and rejects unsafe paths or detached anchors', () => {
    const shadow = { sprite: 'shadow.png', width: 300, height: 240, entrancePixel: { x: 150, y: 200 } };
    expect(customBuildingFiles(customBuildingManifest.parse({ ...building, shadow }))).toEqual([
      'test.png',
      'shadow.png',
    ]);
    for (const patch of [{ sprite: '../shadow.png' }, { width: 0 }, { entrancePixel: { x: 301, y: 200 } }]) {
      expect(customBuildingManifest.safeParse({ ...building, shadow: { ...shadow, ...patch } }).success).toBe(
        false,
      );
    }
  });
  it('places the authored entrance on the half-cell door point', () => {
    const frame = customBuildingAtlas(building).frames.get(0);
    expect(frame).toBeDefined();
    if (frame === undefined) return;
    const door = halfCellToScreen(building.doorNode.x, building.doorNode.y);
    expect((frame.offsetX + building.entrancePixel.x) * building.scale).toBeCloseTo(door.x);
    expect((frame.offsetY + building.entrancePixel.y) * building.scale).toBeCloseTo(door.y);
  });
  it('preserves a ground marker separately from image bounds and rejects invalid radii', () => {
    const selectionEllipse = { cx: 110, cy: 170, rx: 70, ry: 25 };
    const manifest = customBuildingManifest.parse({ ...building, selectionEllipse });
    expect(customBuildingAtlas(manifest).frames.get(0)?.selectionEllipse).toEqual(selectionEllipse);
    expect(
      customBuildingManifest.safeParse({
        ...building,
        selectionEllipse: { ...selectionEllipse, rx: 0 },
      }).success,
    ).toBe(false);
  });
  it('binds multiple approved entries while preserving missing placeholders', () => {
    const second = { ...building, typeId: 2, layer: 'test-second' };
    const binding = customBuildingBindings(SYNTHETIC_BINDINGS.building, [building, second]);
    expect(binding.byTribe?.[1]?.byType[2]).toEqual({ layer: 'test-second', bob: 0 });
    expect(binding.byTribe?.[1]?.byType[3]).toBeUndefined();
    expect(customBuildingBindings(SYNTHETIC_BINDINGS.building, []).default).toEqual(
      SYNTHETIC_BINDINGS.building,
    );
  });
  it('rejects ambiguous identities and layers', () => {
    expect(() =>
      customBuildingBindings(SYNTHETIC_BINDINGS.building, [building, { ...building, layer: 'other' }]),
    ).toThrow('Duplicate');
    expect(() =>
      customBuildingBindings(SYNTHETIC_BINDINGS.building, [building, { ...building, typeId: 2 }]),
    ).toThrow('Duplicate');
  });
  it('rejects paths outside the delivery directory and invalid scales', () => {
    expect(customBuildingManifest.safeParse({ ...building, sprite: '../other.png' }).success).toBe(false);
    expect(customBuildingManifest.safeParse({ ...building, scale: 0 }).success).toBe(false);
  });
});

describe('map review zoom', () => {
  it.each([
    ['', 1],
    ['assets=original', 1],
    ['assets=custom', 1],
    ['assets=custom&zoom=1', 1],
    ['assets=custom&zoom=NaN', 1],
    ['assets=custom&zoom=-1', 1],
    ['zoom=100', 8],
    ['zoom=0.01', 0.35],
    ['zoom=2oops', 1],
  ])('uses bounded initial zoom for %s', (query, zoom) => {
    expect(mapZoomParam(new URLSearchParams(query))).toBe(zoom);
  });
});

describe('custom building state overlay', () => {
  const overlay = {
    sprite: 'rotor.png',
    frameWidth: 40,
    frameHeight: 30,
    frames: 3,
    columns: 2,
    scale: 0.25,
    bodyPixel: { x: 20, y: -10 },
    idle: 0,
    working: [0, 1, 2],
    ticksPerFrame: 2,
  };
  it('binds the sheet as the type working overlay in its custom layer and scale', () => {
    const manifest = customBuildingManifest.parse({ ...building, overlay });
    const binding = customBuildingBindings(SYNTHETIC_BINDINGS.building, [manifest]);
    expect(binding.byTribe?.[1]?.overlayByType?.[1]).toEqual({
      layer: 'test-building-overlay',
      idle: 0,
      working: [0, 1, 2],
      ticksPerFrame: 2,
    });
    expect(customBuildingFiles(manifest)).toEqual(['test.png', 'rotor.png']);
    expect(customLayerScale(manifest, 'test-building-overlay')).toBe(0.25);
    expect(customLayerScale(manifest, 'test-building')).toBe(0.5);
    const other = { ...building, typeId: 2, layer: 'test-building-overlay' };
    expect(() => customBuildingBindings(0, [manifest, other])).toThrow('Duplicate');
  });
  it('registers every sheet frame so its corner lands on the body pixel in world space', () => {
    const manifest = customBuildingManifest.parse({ ...building, overlay });
    const atlas = customOverlayAtlas(manifest, overlay);
    const body = customBuildingAtlas(manifest).frames.get(0);
    expect(atlas).toMatchObject({ width: 80, height: 60 });
    expect([...atlas.frames.keys()]).toEqual([0, 1, 2]);
    for (const [i, frame] of atlas.frames) {
      expect(frame).toMatchObject({ x: (i % 2) * 40, y: Math.floor(i / 2) * 30, width: 40, height: 30 });
      expect(frame.offsetX * overlay.scale).toBeCloseTo(
        ((body?.offsetX ?? 0) + overlay.bodyPixel.x) * building.scale,
      );
      expect(frame.offsetY * overlay.scale).toBeCloseTo(
        ((body?.offsetY ?? 0) + overlay.bodyPixel.y) * building.scale,
      );
    }
  });
  it('rejects state frames outside the sheet and unsafe sheet names', () => {
    for (const patch of [
      { idle: 3 },
      { working: [0, 3] },
      { working: [] },
      { frames: 0 },
      { sprite: '../rotor.png' },
      { ticksPerFrame: 0 },
      { columns: 0 },
      { frameHeight: 2000, frames: 3, columns: 1 },
    ])
      expect(
        customBuildingManifest.safeParse({ ...building, overlay: { ...overlay, ...patch } }).success,
      ).toBe(false);
  });
});
