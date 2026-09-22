import { describe, expect, it } from 'vitest';
import {
  buildGalleryCatalog,
  type GalleryCatalogSources,
  galleryEntries,
  loadGalleryCatalog,
} from '../../src/custom/art-gallery/catalog.js';
import { gallerySelection } from '../../src/custom/art-gallery/selection.js';
import { readGalleryState } from '../../src/custom/art-gallery/state.js';

const character = {
  id: 'new-look',
  name: 'New look',
  width: 64,
  height: 48,
  cellWidth: 8,
  cellHeight: 8,
  columns: 8,
  anchorX: 4,
  anchorY: 7,
  scale: 0.5,
  walkFrames: 1,
  idleFrames: 2,
  walkDuration: 1,
  idleDuration: 3,
  idleFrameDurations: [2.5, 0.5],
  atomicClips: [{ atomicId: 39, frames: 2, duration: 1, frameDurations: [0.25, 0.75] }],
  carryClips: [{ good: 'wood', frames: 1, duration: 1 }],
  sourceBasis: 'Synthetic gallery fixture',
};
function sources(): GalleryCatalogSources {
  return {
    characters: { 'characters/new-look/runtime.json': character },
    buildings: {},
    props: {},
    materials: [],
    images: {
      'characters/new-look/atlas.png': '/new.png',
      'terrain/soil.png': '/soil.png',
    },
  };
}

describe('custom art gallery catalog', () => {
  it('discovers goods and selects them in their own gallery category', () => {
    const input = sources();
    const manifest = {
      id: 'wood',
      image: 'atlas.png',
      width: 60,
      height: 10,
      scale: 0.5,
      frames: Array.from({ length: 6 }, (_, i) => ({
        x: i * 10,
        y: 0,
        width: 10,
        height: 10,
        anchor: { x: 5, y: 8 },
      })),
      sourceBasis: 'Synthetic fixture',
    };
    const catalog = buildGalleryCatalog({
      ...input,
      goods: { 'goods/wood/runtime.json': manifest },
      images: { ...input.images, 'goods/wood/atlas.png': '/wood.png' },
    });
    const entries = galleryEntries(catalog);
    const state = readGalleryState(new URLSearchParams('tab=goods&asset=goods/wood'));
    expect(gallerySelection(entries, state).selected).toMatchObject({
      kind: 'good',
      id: 'goods/wood',
      image: '/wood.png',
    });
    expect(catalog.goods[0]?.atlas.frames.size).toBe(6);
    expect(() => buildGalleryCatalog({ ...input, goods: { 'goods/wood/runtime.json': manifest } })).toThrow(
      'image missing',
    );
  });

  it('resolves the optional shadow image beside its building and rejects missing delivery pixels', () => {
    const input = sources();
    const buildings = {
      'buildings/home/runtime.json': {
        tribeId: 1,
        typeId: 2,
        layer: 'home',
        sprite: 'body.png',
        width: 20,
        height: 20,
        scale: 0.5,
        entrancePixel: { x: 10, y: 18 },
        doorNode: { x: 0, y: 0 },
        sourceBasis: 'Synthetic shadow fixture',
        shadow: { sprite: 'shadow.png', width: 30, height: 25, entrancePixel: { x: 15, y: 18 } },
      },
    };
    const images = {
      ...input.images,
      'buildings/home/body.png': '/body.png',
      'buildings/home/shadow.png': '/shadow.png',
    };
    expect(buildGalleryCatalog({ ...input, buildings, images }).buildings[0]?.shadowImage).toBe(
      '/shadow.png',
    );
    expect(() =>
      buildGalleryCatalog({
        ...input,
        buildings,
        images: { ...input.images, 'buildings/home/body.png': '/body.png' },
      }),
    ).toThrow('Gallery image missing');
  });
  it('discovers a new appearance and preserves runtime frame geometry and nonuniform timing', () => {
    const catalog = buildGalleryCatalog(sources());
    const look = catalog.characters[0];
    expect(look?.id).toBe('characters/new-look');
    expect(look?.clips.map((entry) => entry.id)).toEqual(['idle', 'walk', 'atomic-39', 'carry-wood']);
    expect(look?.clips[3]?.binding).toMatchObject({ start: 40, dirs: 8, stride: 1 });
    expect(look?.clips[0]?.binding).toMatchObject({
      start: 8,
      dirs: 8,
      stride: 2,
      frameDurations: [30, 6],
    });
    expect(look?.clips[2]?.binding).toMatchObject({
      start: 24,
      dirs: 8,
      stride: 2,
      frameDurations: [3, 9],
    });
    expect(look?.atlas.frames.get(39)).toEqual({
      x: 56,
      y: 32,
      width: 8,
      height: 8,
      offsetX: -4,
      offsetY: -7,
    });
  });

  it('rejects missing images, duplicate appearances and malformed delivered manifests', () => {
    expect(() => buildGalleryCatalog({ ...sources(), images: {} })).toThrow('Gallery image missing');
    expect(() =>
      buildGalleryCatalog({
        ...sources(),
        characters: {
          'characters/a/runtime.json': character,
          'characters/b/runtime.json': character,
        },
        images: {
          ...sources().images,
          'characters/a/atlas.png': '/a.png',
          'characters/b/atlas.png': '/b.png',
        },
      }),
    ).toThrow('Duplicate gallery asset');
    expect(() =>
      buildGalleryCatalog({
        ...sources(),
        characters: {
          'characters/new-look/runtime.json': { ...character, width: 1 },
        },
      }),
    ).toThrow();
  });

  it('discovers construction masks and uses the game door projection', () => {
    const catalog = buildGalleryCatalog({
      ...sources(),
      buildings: {
        'buildings/new-house/runtime.json': {
          tribeId: 1,
          typeId: 99,
          layer: 'own-new-house',
          sprite: 'final.png',
          width: 100,
          height: 80,
          scale: 0.5,
          entrancePixel: { x: 50, y: 70 },
          doorNode: { x: 0, y: 0 },
          sourceBasis: 'Synthetic fixture',
          construction: [
            {
              sprite: 'final.png',
              timeMask: 'time.png',
              fromPct: 0,
              toPct: 100,
            },
          ],
        },
      },
      images: {
        ...sources().images,
        'buildings/new-house/final.png': '/house.png',
        'buildings/new-house/time.png': '/time.png',
      },
    });
    expect(catalog.buildings[0]?.construction).toEqual([
      { image: '/house.png', timeMask: '/time.png', fromPct: 0, toPct: 100 },
    ]);
    expect(catalog.buildings[0]?.atlas.frames.get(0)).toMatchObject({
      offsetX: -50,
      offsetY: -70,
    });
  });

  it('resolves Vite candidate glob keys without reconstructing their alias prefix', () => {
    const prefix = '/@fs/work/art-gallery/.art-build/terrain/ferns/preview/custom';
    const published = loadGalleryCatalog();
    const material = published.materials[0];
    if (material === undefined) throw new Error('Expected delivered terrain fixture');
    const input = sources();
    const catalog = buildGalleryCatalog({
      ...input,
      characters: { [`${prefix}/characters/new-look/runtime.json`]: character },
      materials: [material.manifest],
      images: {
        [`${prefix}/characters/new-look/atlas.png`]: '/candidate/atlas.png',
        [`${prefix}/terrain/soil.png`]: '/candidate/soil.png',
        [`${prefix}/terrain/${material.manifest.image}`]: '/candidate/material.png',
      },
    });
    expect(catalog.characters[0]?.image).toBe('/candidate/atlas.png');
    expect(catalog.materials[0]?.image).toBe('/candidate/material.png');
    expect(catalog.soilImage).toBe(
      material.manifest.image === 'soil.png' ? '/candidate/material.png' : '/candidate/soil.png',
    );
  });

  it('loads every delivered category without requiring game content', () => {
    const catalog = loadGalleryCatalog();
    expect(catalog.characters.length).toBeGreaterThan(0);
    expect(catalog.buildings.length).toBeGreaterThan(0);
    expect(catalog.props.length).toBeGreaterThan(0);
    expect(catalog.materials.length).toBeGreaterThan(0);
    expect(galleryEntries(catalog)).toHaveLength(
      catalog.characters.length +
        catalog.buildings.length +
        catalog.props.length +
        catalog.materials.length +
        catalog.goods.length,
    );
    expect(new Set(galleryEntries(catalog).map((entry) => entry.id)).size).toBe(
      galleryEntries(catalog).length,
    );
  });
});
