import type { DrawItem } from '../../data/scene/index.js';
import { planSiteOf } from './bind-layers.js';
import type { MotionTrack } from './motion.js';
import type { ResolvedLayer } from './resolved-layer.js';
import type { PoolFrame } from './sprite-pool.js';

/**
 * The frame-wide inputs of an entity's present and bind, reduced to counters that bump when any of them
 * changes: {@link current} for every input, {@link bind} for those the bind itself reads. The frame alpha
 * is kept apart, in each stamp, because a bind can outlast it. The camera and the screen size are no
 * input of either: they place only the paletted layers, which {@link viewMoved} tells the pool to
 * re-place, so a pan keeps every bind.
 */
export class FrameEpoch {
  current = 0;
  /** Bumps with {@link current} except on the tick, wind and motion setting, which reach a bind only
   *  through the layers a present resolves. */
  bind = 0;
  /** Whether the last {@link advance} moved the camera or resized the screen. */
  viewMoved = true;
  private tick = Number.NaN;
  private enhancedSampling: PoolFrame['enhancedSampling'];
  private pixelArtScaler: PoolFrame['pixelArtScaler'];
  private environmentMotion: PoolFrame['environmentMotion'];
  /** Whether weather wind blows. The wind itself moves with the frame clock, which already re-presents
   *  every swaying entity, so only its arrival or end (the setting switched while paused) bumps. */
  private windy = false;
  private shadowStyle: PoolFrame['shadowStyle'];
  private textureRevision = Number.NaN;
  private offsetX = Number.NaN;
  private offsetY = Number.NaN;
  private scale: number | undefined;
  private screenW = Number.NaN;
  private screenH = Number.NaN;
  private snapResolution: number | undefined;

  advance(frame: PoolFrame, textureRevision: number): void {
    const camera = frame.camera;
    this.viewMoved =
      camera.offsetX !== this.offsetX ||
      camera.offsetY !== this.offsetY ||
      camera.scale !== this.scale ||
      frame.screenW !== this.screenW ||
      frame.screenH !== this.screenH;
    this.offsetX = camera.offsetX;
    this.offsetY = camera.offsetY;
    this.scale = camera.scale;
    this.screenW = frame.screenW;
    this.screenH = frame.screenH;
    const windy = (frame.wind?.strength ?? 0) > 0;
    const bindHolds =
      frame.enhancedSampling === this.enhancedSampling &&
      frame.pixelArtScaler === this.pixelArtScaler &&
      frame.shadowStyle === this.shadowStyle &&
      textureRevision === this.textureRevision &&
      frame.snapResolution === this.snapResolution;
    if (
      bindHolds &&
      windy === this.windy &&
      frame.tick === this.tick &&
      frame.environmentMotion === this.environmentMotion
    ) {
      return;
    }
    this.current++;
    if (!bindHolds) this.bind++;
    this.tick = frame.tick;
    this.enhancedSampling = frame.enhancedSampling;
    this.pixelArtScaler = frame.pixelArtScaler;
    this.environmentMotion = frame.environmentMotion;
    this.windy = windy;
    this.shadowStyle = frame.shadowStyle;
    this.textureRevision = textureRevision;
    this.snapResolution = frame.snapResolution;
  }
}

/** An epoch no frame reaches, so a stamp holding it never holds. */
const RETRY_EPOCH = -2;

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
  private bindEpoch = -1;
  private drawX = Number.NaN;
  private drawY = Number.NaN;
  private drawRotation = Number.NaN;
  /** `null` for the placeholder marker. */
  private layers: ResolvedLayer[] | null = [];
  /** The item fields the bind and the depth key read besides the layers: a new draw item of an
   *  unchanged entity, which every scene build brings, binds nothing new while they hold. */
  private kind: DrawItem['kind'] | undefined;
  private ghost = false;
  private isFlag = false;
  private x = Number.NaN;
  private y = Number.NaN;
  private lift = 0;
  private site: DrawItem['palisadeSite'] | DrawItem['roadSite'];
  private builtPct: number | undefined;
  private upgradePct: number | undefined;
  private player: number | undefined;
  /** Whether a bound layer leans with the vegetation clock. */
  private sways = false;

  /** Whether the bind reads the same item, frame-wide inputs and highlight it last read. */
  holds(item: DrawItem, epoch: number, highlight: boolean | undefined): boolean {
    return this.item === item && this.epoch === epoch && this.highlight === highlight;
  }

  /** Whether a bind of `item` under these bind inputs reads what the last one did, apart from the layers
   *  and the drawn anchor {@link presents} compares. */
  bindHolds(item: DrawItem, bindEpoch: number, highlight: boolean | undefined): boolean {
    if (this.bindEpoch !== bindEpoch || this.highlight !== highlight) return false;
    // Draw items are immutable, so the item last bound or carried still holds its fields. Reading them
    // off the many item shapes would box every numeric one on each frame of a still scene.
    if (this.item === item) return true;
    return (
      this.kind === item.kind &&
      this.ghost === (item.ghost === true) &&
      this.isFlag === (item.isFlag === true) &&
      this.x === item.x &&
      this.y === item.y &&
      this.lift === (item.lift ?? 0) &&
      this.site === planSiteOf(item) &&
      this.builtPct === item.builtPct &&
      this.upgradePct === item.upgradePct &&
      this.player === item.player
    );
  }

  /** Whether the last bind drew a stand-in for a bake the budget turned away. */
  get retrying(): boolean {
    return this.bindEpoch === RETRY_EPOCH;
  }

  /** Make the next frame present and bind again, as a frame-wide input change would. */
  retry(): void {
    this.epoch = RETRY_EPOCH;
    this.bindEpoch = RETRY_EPOCH;
  }

  /** Whether the bound layers hold still with the frame clocks: none of them sways. */
  get clockFree(): boolean {
    return !this.sways;
  }

  /** Whether `item` carries the same fields, each the same value, as the item last bound or carried. */
  sameItem(item: DrawItem): boolean {
    const last = this.item;
    if (last === item) return true;
    if (last === undefined) return false;
    let fields = 0;
    for (const key in item) {
      if (item[key as keyof DrawItem] !== last[key as keyof DrawItem]) return false;
      fields++;
    }
    for (const _ in last) fields--;
    return fields === 0;
  }

  /** Take `item` and the frame's epoch as bound without binding: {@link bindHolds} and {@link presents}
   *  held, so the sprites already show what a bind would set. */
  carry(item: DrawItem, epoch: number): void {
    this.item = item;
    this.epoch = epoch;
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
    epoch: FrameEpoch,
    highlight: boolean | undefined,
    motion: MotionTrack,
    layers: readonly ResolvedLayer[] | null,
  ): void {
    this.item = item;
    this.epoch = epoch.current;
    this.bindEpoch = epoch.bind;
    this.highlight = highlight;
    this.kind = item.kind;
    this.ghost = item.ghost === true;
    this.isFlag = item.isFlag === true;
    this.x = item.x;
    this.y = item.y;
    this.lift = item.lift ?? 0;
    this.site = planSiteOf(item);
    this.builtPct = item.builtPct;
    this.upgradePct = item.upgradePct;
    this.player = item.player;
    this.drawX = motion.drawX;
    this.drawY = motion.drawY;
    this.drawRotation = motion.drawRotation;
    this.sways = false;
    if (layers === null) {
      this.layers = null;
      return;
    }
    const bound = this.layers ?? [];
    bound.length = layers.length;
    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i];
      if (layer === undefined) continue;
      bound[i] = layer;
      if (layer.shear !== undefined) this.sways = true;
    }
    this.layers = bound;
  }
}
