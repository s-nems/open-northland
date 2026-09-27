import type { DrawItem } from '../../data/scene/index.js';
import type { MotionTrack } from './motion.js';
import type { ResolvedLayer } from './resolved-layer.js';
import type { PoolFrame } from './sprite-pool.js';

/**
 * The frame-wide inputs of an entity's present and bind, reduced to a counter that bumps when any of
 * them changes. The frame alpha is kept apart, in each stamp, because a bind can outlast it.
 */
export class FrameEpoch {
  current = 0;
  private tick = Number.NaN;
  private enhancedSampling: PoolFrame['enhancedSampling'];
  private pixelArtScaler: PoolFrame['pixelArtScaler'];
  private environmentMotion: PoolFrame['environmentMotion'];
  private shadowStyle: PoolFrame['shadowStyle'];
  private shadowRevision = Number.NaN;
  private offsetX = Number.NaN;
  private offsetY = Number.NaN;
  private scale: number | undefined;
  private screenW = Number.NaN;
  private screenH = Number.NaN;
  private snapResolution: number | undefined;

  advance(frame: PoolFrame, shadowRevision: number): void {
    const camera = frame.camera;
    if (
      frame.tick === this.tick &&
      frame.enhancedSampling === this.enhancedSampling &&
      frame.pixelArtScaler === this.pixelArtScaler &&
      frame.environmentMotion === this.environmentMotion &&
      frame.shadowStyle === this.shadowStyle &&
      shadowRevision === this.shadowRevision &&
      camera.offsetX === this.offsetX &&
      camera.offsetY === this.offsetY &&
      camera.scale === this.scale &&
      frame.screenW === this.screenW &&
      frame.screenH === this.screenH &&
      frame.snapResolution === this.snapResolution
    ) {
      return;
    }
    this.current++;
    this.tick = frame.tick;
    this.enhancedSampling = frame.enhancedSampling;
    this.pixelArtScaler = frame.pixelArtScaler;
    this.environmentMotion = frame.environmentMotion;
    this.shadowStyle = frame.shadowStyle;
    this.shadowRevision = shadowRevision;
    this.offsetX = camera.offsetX;
    this.offsetY = camera.offsetY;
    this.scale = camera.scale;
    this.screenW = frame.screenW;
    this.screenH = frame.screenH;
    this.snapResolution = frame.snapResolution;
  }
}

/**
 * What an entity's last main-frame bind read. Resolved layers are immutable, so the same layer objects
 * at the same drawn anchor bind the same sprites.
 */
export class BindStamp {
  /** `undefined` makes the next frame present and bind. */
  item: DrawItem | undefined;
  epoch = -1;
  /** The frame alpha of the last present, which may have run without a bind. */
  alpha = Number.NaN;
  highlight: boolean | undefined;
  private drawX = Number.NaN;
  private drawY = Number.NaN;
  private drawRotation = Number.NaN;
  /** `null` for the placeholder marker. */
  private layers: ResolvedLayer[] | null = [];

  /** Whether the bind reads the same item, frame-wide inputs and highlight it last read. */
  holds(item: DrawItem, epoch: number, highlight: boolean | undefined): boolean {
    return this.item === item && this.epoch === epoch && this.highlight === highlight;
  }

  /** Whether a fresh present resolved exactly what was bound. */
  presents(motion: MotionTrack, layers: readonly ResolvedLayer[] | null): boolean {
    if (
      motion.drawX !== this.drawX ||
      motion.drawY !== this.drawY ||
      motion.drawRotation !== this.drawRotation
    ) {
      return false;
    }
    const bound = this.layers;
    if (layers === null || bound === null) return layers === bound;
    if (layers.length !== bound.length) return false;
    for (let i = 0; i < layers.length; i++) if (layers[i] !== bound[i]) return false;
    return true;
  }

  record(
    item: DrawItem,
    epoch: number,
    highlight: boolean | undefined,
    motion: MotionTrack,
    layers: readonly ResolvedLayer[] | null,
  ): void {
    this.item = item;
    this.epoch = epoch;
    this.highlight = highlight;
    this.drawX = motion.drawX;
    this.drawY = motion.drawY;
    this.drawRotation = motion.drawRotation;
    if (layers === null) {
      this.layers = null;
      return;
    }
    const bound = this.layers ?? [];
    bound.length = layers.length;
    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i];
      if (layer !== undefined) bound[i] = layer;
    }
    this.layers = bound;
  }
}
