import {
  Container,
  Rectangle,
  type Renderer,
  RenderTexture,
  Sprite,
  Texture,
  type TextureSource,
} from 'pixi.js';
import { aabbIntersects, isVisible, TILE_HALF_W, type Viewport } from '../../data/projection/index.js';
import type { Camera } from '../../data/projection/iso.js';
import type { AtlasFrame } from '../../data/sprites/atlas.js';
import { TERRAIN_CHUNK_TILES } from '../terrain/index.js';
import { type GroundWave, groundWaveFrameAt } from './ground-wave.js';
import { type GroundWaveFilter, makeGroundWaveFilter } from './ground-wave-filter.js';

/** Waves are culled in square blocks of the terrain chunk's horizontal pitch before their anchors. */
const BLOCK_PX = TERRAIN_CHUNK_TILES * TILE_HALF_W * 2;

function blockKey(wave: GroundWave): string {
  return `${Math.floor(wave.x / BLOCK_PX)},${Math.floor(wave.y / BLOCK_PX)}`;
}

interface WaveBlock {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  readonly waves: GroundWave[];
}

/**
 * The shore waves. Original behavior: after the ground and the static landscape objects are drawn and
 * before creatures, each wave's current bob copies, for every written texel of value `v`, the pixel `v`
 * rows below it into its place, so the ground under the wave rises by 1 to 6 px while settlers stay put. Here the visible
 * waves render into a screen-sized lift map each frame and a filter on the ground container applies
 * it. Approximations: overlapping waves take the last drawn value instead of chaining their copies,
 * and static landscape objects, which the original lifts with the ground, stay put.
 */
export class GroundWaveLayer {
  /** The render root of the lift map; {@link view} carries the camera under it. */
  private readonly root = new Container();
  private readonly view = new Container();
  private readonly sprites: Sprite[] = [];
  private readonly blocks = new Map<string, WaveBlock>();
  private readonly textures = new Map<AtlasFrame, Texture>();
  private map: RenderTexture | null = null;
  private waveFilter: GroundWaveFilter | null = null;
  private applied = false;

  constructor(
    private readonly renderer: Renderer,
    private readonly ground: Container,
  ) {
    this.root.addChild(this.view);
  }

  /** Call once per map. */
  set(waves: readonly GroundWave[]): void {
    this.blocks.clear();
    this.dropTextures();
    for (const wave of waves) {
      if (wave.frames.length === 0) continue;
      // The frames hold values, not colours: a filtered sample would invent lifts between them.
      wave.source.scaleMode = 'nearest';
      const key = blockKey(wave);
      let block = this.blocks.get(key);
      if (block === undefined) {
        block = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity, waves: [] };
        this.blocks.set(key, block);
      }
      block.waves.push(wave);
      for (const frame of wave.frames) {
        const top = wave.y - (wave.lift ?? 0) + frame.offsetY;
        block.minX = Math.min(block.minX, wave.x + frame.offsetX);
        block.maxX = Math.max(block.maxX, wave.x + frame.offsetX + frame.width);
        block.minY = Math.min(block.minY, top);
        block.maxY = Math.max(block.maxY, top + frame.height);
      }
    }
  }

  /** Take one placed wave out (a script removed it); O(its block). An unknown wave is a no-op. */
  remove(wave: GroundWave): void {
    const waves = this.blocks.get(blockKey(wave))?.waves;
    const index = waves?.indexOf(wave) ?? -1;
    if (index >= 0) waves?.splice(index, 1);
  }

  /**
   * Render this frame's lift map and put the filter on the ground, or take it off when no wave is on
   * screen or `enabled` is false. With any wave on screen the frame pays a screen-sized ground pass
   * and lift-map render on top of the per-wave sprite updates.
   */
  update(
    vp: Viewport,
    camera: Camera,
    screenW: number,
    screenH: number,
    tick: number,
    enabled: boolean,
  ): void {
    let drawn = 0;
    if (enabled) {
      for (const block of this.blocks.values()) {
        if (!aabbIntersects(vp, block)) continue;
        for (const wave of block.waves) {
          if (!isVisible(vp, wave.x, wave.y)) continue;
          const frame = groundWaveFrameAt(wave, tick);
          if (frame === undefined || frame.width <= 0 || frame.height <= 0) continue;
          const sprite = this.sprites[drawn] ?? this.mintSprite();
          sprite.texture = this.textureFor(wave.source, frame);
          sprite.position.set(wave.x + frame.offsetX, wave.y - (wave.lift ?? 0) + frame.offsetY);
          sprite.visible = true;
          drawn++;
        }
      }
    }
    for (let i = drawn; i < this.sprites.length; i++) {
      const sprite = this.sprites[i];
      if (sprite !== undefined) sprite.visible = false;
    }
    if (drawn === 0) {
      this.setApplied(false);
      return;
    }
    const zoom = camera.scale ?? 1;
    this.view.scale.set(zoom);
    this.view.position.set(camera.offsetX, camera.offsetY);
    const map = this.mapSized(screenW, screenH);
    this.renderer.render({ container: this.root, target: map, clear: true });
    this.filterFor(map).bind(map.source, screenW, screenH, zoom, this.renderer.resolution);
    this.setApplied(true);
  }

  /** The lift map is framed on the main camera, so another view of the world draws the ground unlifted. */
  suspend(suspended: boolean): void {
    if (this.waveFilter !== null) this.waveFilter.filter.enabled = !suspended;
  }

  destroy(): void {
    this.setApplied(false);
    this.blocks.clear();
    this.dropTextures();
    this.root.destroy({ children: true });
    this.sprites.length = 0;
    this.map?.destroy(true);
    this.map = null;
    this.waveFilter?.filter.destroy();
    this.waveFilter = null;
  }

  private setApplied(applied: boolean): void {
    if (this.applied === applied || this.waveFilter === null) return;
    this.applied = applied;
    this.ground.filters = applied ? [this.waveFilter.filter] : null;
  }

  private mapSized(screenW: number, screenH: number): RenderTexture {
    const width = Math.max(1, Math.ceil(screenW));
    const height = Math.max(1, Math.ceil(screenH));
    const resolution = this.renderer.resolution;
    const map = this.map;
    if (
      map !== null &&
      map.width === width &&
      map.height === height &&
      map.source.resolution === resolution
    ) {
      return map;
    }
    map?.destroy(true);
    const next = RenderTexture.create({ width, height, resolution, antialias: false });
    next.source.scaleMode = 'nearest';
    this.map = next;
    return next;
  }

  private filterFor(map: RenderTexture): GroundWaveFilter {
    this.waveFilter ??= makeGroundWaveFilter(map.source);
    return this.waveFilter;
  }

  private mintSprite(): Sprite {
    const sprite = new Sprite();
    this.view.addChild(sprite);
    this.sprites.push(sprite);
    return sprite;
  }

  private textureFor(source: TextureSource, frame: AtlasFrame): Texture {
    let texture = this.textures.get(frame);
    if (texture === undefined) {
      texture = new Texture({ source, frame: new Rectangle(frame.x, frame.y, frame.width, frame.height) });
      this.textures.set(frame, texture);
    }
    return texture;
  }

  private dropTextures(): void {
    for (const texture of this.textures.values()) texture.destroy(false);
    this.textures.clear();
  }
}
