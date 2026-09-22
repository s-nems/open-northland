/// <reference types="vite/client" />
import type {
  CustomBuildingManifest,
  CustomCharacterManifest,
  CustomGoodManifest,
  CustomPropManifest,
  CustomTerrainMaterial,
} from '@open-northland/art-contracts/custom';
import type { SpriteAtlas, SpriteFrameRef } from '@open-northland/render';
import { customBuildingAtlas, customBuildingManifest } from '../content/building-manifest.js';
import {
  customCharacterAtlas,
  customCharacterBinding,
  customCharacterCarryLooks,
  customCharacterManifest,
} from '../content/character-manifest.js';
import { customGoodAtlas, customGoodManifest } from '../content/good-manifest.js';
import { customTerrainMaterials } from '../content/materials.js';
import { customPropAtlas, customPropManifest } from '../content/prop-manifest.js';

export interface GalleryClip {
  readonly id: string;
  readonly label: string;
  readonly binding: SpriteFrameRef;
}

interface GallerySprite {
  readonly id: string;
  readonly name: string;
  readonly image: string;
  readonly scale: number;
  readonly atlas: SpriteAtlas;
}

export interface GalleryCharacter extends GallerySprite {
  readonly kind: 'character';
  readonly shadowImage?: string;
  readonly manifest: CustomCharacterManifest;
  readonly clips: readonly GalleryClip[];
}

export interface GalleryConstruction {
  readonly image: string;
  readonly timeMask: string;
  readonly fromPct: number;
  readonly toPct: number;
}

export interface GalleryBuilding extends GallerySprite {
  readonly kind: 'building';
  readonly manifest: CustomBuildingManifest;
  readonly construction: readonly GalleryConstruction[];
  readonly shadowImage?: string;
  readonly overlayImage?: string;
}

export interface GalleryProp extends GallerySprite {
  readonly kind: 'prop';
  readonly manifest: CustomPropManifest;
}

export interface GalleryMaterial {
  readonly kind: 'material';
  readonly id: string;
  readonly name: string;
  readonly image: string;
  readonly manifest: CustomTerrainMaterial;
}

export interface GalleryGood extends GallerySprite {
  readonly kind: 'good';
  readonly manifest: CustomGoodManifest;
}
export type GalleryEntry = GalleryCharacter | GalleryBuilding | GalleryProp | GalleryMaterial | GalleryGood;

export interface GalleryCatalog {
  readonly characters: readonly GalleryCharacter[];
  readonly buildings: readonly GalleryBuilding[];
  readonly props: readonly GalleryProp[];
  readonly materials: readonly GalleryMaterial[];
  readonly goods: readonly GalleryGood[];
  readonly soilImage: string;
}

export interface GalleryCatalogSources {
  readonly characters: Readonly<Record<string, unknown>>;
  readonly buildings: Readonly<Record<string, unknown>>;
  readonly props: Readonly<Record<string, unknown>>;
  readonly goods?: Readonly<Record<string, unknown>>;
  readonly images: Readonly<Record<string, string>>;
  readonly materials: readonly CustomTerrainMaterial[];
}

function siblingImage(images: GalleryCatalogSources['images'], path: string, filename: string): string {
  const sibling = path.slice(0, path.lastIndexOf('/') + 1) + filename;
  const image = images[sibling];
  if (image === undefined) throw new Error(`Gallery image missing: ${sibling}`);
  return image;
}

function terrainImage(images: GalleryCatalogSources['images'], filename: string): string {
  const matches = Object.entries(images).filter(
    ([path]) => path === `terrain/${filename}` || path.endsWith(`/terrain/${filename}`),
  );
  if (matches.length !== 1 || matches[0] === undefined)
    throw new Error(`Gallery terrain image missing or ambiguous: ${filename}`);
  return matches[0][1];
}

function clip(id: string, label: string, binding: number | SpriteFrameRef | undefined): GalleryClip {
  if (binding === undefined || typeof binding === 'number') throw new Error(`Gallery clip missing: ${id}`);
  return { id, label, binding };
}

function sortedUnique<T extends { readonly id: string }>(entries: T[]): readonly T[] {
  const ids = new Set<string>();
  for (const entry of entries) {
    if (ids.has(entry.id)) throw new Error(`Duplicate gallery asset: ${entry.id}`);
    ids.add(entry.id);
  }
  return entries.sort((a, b) => a.id.localeCompare(b.id));
}

export function buildGalleryCatalog(sources: GalleryCatalogSources): GalleryCatalog {
  const characters = sortedUnique(
    Object.entries(sources.characters).map(([path, raw]): GalleryCharacter => {
      const manifest = customCharacterManifest.parse(raw);
      const binding = customCharacterBinding(manifest, []);
      return {
        kind: 'character',
        ...(manifest.shadow
          ? { shadowImage: siblingImage(sources.images, path, manifest.shadow.sprite) }
          : {}),
        id: `characters/${manifest.id}`,
        name: manifest.name,
        image: siblingImage(sources.images, path, 'atlas.png'),
        scale: manifest.scale,
        atlas: customCharacterAtlas(manifest),
        manifest,
        clips: [
          clip('idle', 'Idle', binding.idle),
          clip('walk', 'Walk', binding.moving),
          ...(manifest.atomicClips ?? []).map((atomic) =>
            clip(
              `atomic-${atomic.atomicId}`,
              `Atomic ${atomic.atomicId}`,
              binding.byAtomic?.[atomic.atomicId],
            ),
          ),
          ...[...customCharacterCarryLooks(manifest)].map(([good, look]) =>
            clip(`carry-${good}`, `Carry ${good}`, look.moving),
          ),
        ],
      };
    }),
  );
  const buildings = sortedUnique(
    Object.entries(sources.buildings).map(([path, raw]): GalleryBuilding => {
      const manifest = customBuildingManifest.parse(raw);
      const directory = path.split('/').at(-2);
      if (directory === undefined) throw new Error(`Gallery building path invalid: ${path}`);
      return {
        kind: 'building',
        id: `buildings/${directory}`,
        name: directory,
        image: siblingImage(sources.images, path, manifest.sprite),
        scale: manifest.scale,
        atlas: customBuildingAtlas(manifest),
        manifest,
        construction: (manifest.construction ?? []).map((stage) => ({
          image: siblingImage(sources.images, path, stage.sprite),
          timeMask: siblingImage(sources.images, path, stage.timeMask),
          fromPct: stage.fromPct,
          toPct: stage.toPct,
        })),
        ...(manifest.shadow === undefined
          ? {}
          : { shadowImage: siblingImage(sources.images, path, manifest.shadow.sprite) }),
        ...(manifest.overlay === undefined
          ? {}
          : { overlayImage: siblingImage(sources.images, path, manifest.overlay.sprite) }),
      };
    }),
  );
  const props = sortedUnique(
    Object.entries(sources.props).map(([path, raw]): GalleryProp => {
      const manifest = customPropManifest.parse(raw);
      return {
        kind: 'prop',
        id: `props/${manifest.id}`,
        name: manifest.id,
        image: siblingImage(sources.images, path, manifest.image),
        scale: manifest.scale,
        atlas: customPropAtlas(manifest),
        manifest,
      };
    }),
  );
  return {
    characters,
    buildings,
    props,
    materials: sortedUnique(
      sources.materials.map(
        (manifest): GalleryMaterial => ({
          kind: 'material',
          id: `terrain/${manifest.id}`,
          name: manifest.id,
          image: terrainImage(sources.images, manifest.image),
          manifest,
        }),
      ),
    ),
    goods: sortedUnique(
      Object.entries(sources.goods ?? {}).map(([path, raw]): GalleryGood => {
        const manifest = customGoodManifest.parse(raw);
        return {
          kind: 'good',
          id: `goods/${manifest.id}`,
          name: manifest.id,
          image: siblingImage(sources.images, path, manifest.image),
          scale: manifest.scale,
          atlas: customGoodAtlas(manifest),
          manifest,
        };
      }),
    ),
    soilImage: terrainImage(sources.images, 'soil.png'),
  };
}

export function loadGalleryCatalog(): GalleryCatalog {
  return buildGalleryCatalog({
    characters: import.meta.glob('../../assets/custom/characters/*/runtime.json', {
      eager: true,
      import: 'default',
    }),
    buildings: import.meta.glob('../../assets/custom/buildings/*/runtime.json', {
      eager: true,
      import: 'default',
    }),
    goods: import.meta.glob('../../assets/custom/goods/*/runtime.json', { eager: true, import: 'default' }),
    props: import.meta.glob('../../assets/custom/props/*/runtime.json', {
      eager: true,
      import: 'default',
    }),
    images: import.meta.glob<string>('../../assets/custom/**/*.png', {
      eager: true,
      query: '?url',
      import: 'default',
    }),
    materials: customTerrainMaterials,
  });
}

export function galleryEntries(catalog: GalleryCatalog): readonly GalleryEntry[] {
  return [
    ...catalog.characters,
    ...catalog.buildings,
    ...catalog.materials,
    ...catalog.props,
    ...catalog.goods,
  ];
}
