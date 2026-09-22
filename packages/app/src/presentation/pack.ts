/// <reference types="vite/client" />
import type { ElevationField, SpriteSheet, TerrainTextureSet } from '@open-northland/render';
import type { Renderer, Texture } from 'pixi.js';
import type { ContentIr } from '../content/ir/rows.js';
import type { LoadedMapObjects, MapObjectsData } from '../content/objects.js';
import type { GoodRef } from '../content/settler-gfx/index.js';

/** A good's icon as a DOM surface draws it: the sheet URL and the icon's rect on it. */
export interface GoodIconSource {
  readonly url: string;
  readonly sheet: { readonly width: number; readonly height: number };
  readonly rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
}

/**
 * World art that replaces the original game's: sprites, ground, map objects and goods icons. The map
 * geometry, simulation and HUD stay the same. While a pack draws the world, the decoded minimap and the
 * original overlay atlases (combat bones, settler bubbles, building signs) stay off.
 */
export interface PresentationPack {
  spriteSheet(ir: ContentIr | null, goods: readonly GoodRef[], params: URLSearchParams): Promise<SpriteSheet>;
  terrain(renderer: Renderer, ir: ContentIr | null): Promise<TerrainTextureSet>;
  /** The synthetic scenes' ground, whose open terrain carries no decoded ground-pattern name. */
  sceneTerrain(terrain: TerrainTextureSet): TerrainTextureSet;
  mapObjects(
    renderer: Renderer,
    objects: MapObjectsData,
    ir: ContentIr,
    elevation: ElevationField,
  ): Promise<LoadedMapObjects>;
  /** A good's DOM icon, or undefined to fall back to the original's frame. */
  goodIconSource(goodId: string): GoodIconSource | undefined;
  /** Goods icons the Pixi panels draw from this pack's families on `sheet`. */
  goodTextures(sheet: SpriteSheet | undefined): ReadonlyMap<string, Texture>;
}

interface PackModule {
  readonly presentationPack: (params: URLSearchParams) => PresentationPack | null;
}

// A checkout with custom art adds this module; without it the game draws the original's art.
const checkout = Object.values(import.meta.glob<PackModule>('../custom/pack.ts', { eager: true }))[0];

/** The pack drawing the world for this session, or null for the original game's art. */
export function presentationPack(params: URLSearchParams): PresentationPack | null {
  return checkout?.presentationPack(params) ?? null;
}
