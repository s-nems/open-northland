import { Graphics, Texture } from 'pixi.js';
import { BloodSurfaceSprite } from '../blood/surface-sprite.js';
import { SELECTION_COVER, SELECTION_GHOST_OUTLINE, SELECTION_OUTLINE } from '../world-batch/shader.js';

/** One world-batch value: negative draws a tinted silhouette; non-negative packs a colour lift (see
 *  `SELECTION_TONE_BAND`). */
export class SelectionSprite extends BloodSurfaceSprite {
  private effect = 0;
  private blood = 0;
  private night = 0;
  private depth = 0;

  /** The clip-space z a silhouette draws at, for the occlusion ghosts' depth clip; any other silhouette
   *  keeps 0, and a body ignores it. */
  get clipDepth(): number {
    return this.depth;
  }

  set clipDepth(z: number) {
    if (z === this.depth) return;
    this.depth = z;
    this.onViewUpdate();
  }

  /** The packed `aNight` value of `world-batch/shader.ts`: how lit the layer shows in the night's mask. */
  get nightLit(): number {
    return this.night;
  }

  set nightLit(packed: number) {
    if (packed === this.night) return;
    this.night = packed;
    this.onViewUpdate();
  }

  get bloodEffect(): number {
    return this.blood;
  }

  set bloodEffect(packed: number) {
    if (packed === this.blood) return;
    this.blood = packed;
    this.onViewUpdate();
  }

  get selectionEffect(): number {
    return this.effect;
  }

  set selectionEffect(amount: number) {
    if (amount === this.effect) return;
    this.effect = amount;
    this.onViewUpdate();
  }
}

/**
 * One selection outline pass over one body layer: a quad grown past the body by the outline's reach,
 * whose fragments gather the body's coverage at every offset the outline spreads it to. It draws
 * what the offset copies of the body (`SELECTION_STAMP`) would, in one draw over the body's area.
 */
export class OutlineSprite extends SelectionSprite {
  /** The body's own texture: a tap outside its frame reads nothing. */
  bodyTexture: Texture = Texture.EMPTY;
  /** The uv a tap moves by per unit offset along x (`[0]`, `[1]`) and along y (`[2]`, `[3]`). */
  readonly reachUv = new Float32Array(4);

  constructor() {
    super();
    this.selectionEffect = SELECTION_OUTLINE;
  }

  /** Compared as stored, so a quad that held still repacks nothing. */
  setReach(xu: number, xv: number, yu: number, yv: number): void {
    const reach = this.reachUv;
    const x0 = Math.fround(xu);
    const x1 = Math.fround(xv);
    const y0 = Math.fround(yu);
    const y1 = Math.fround(yv);
    if (reach[0] === x0 && reach[1] === x1 && reach[2] === y0 && reach[3] === y1) return;
    reach[0] = x0;
    reach[1] = x1;
    reach[2] = y0;
    reach[3] = y1;
    this.onViewUpdate();
  }
}

/**
 * One occlusion ghost's outline pass over one body layer: the ring between the body's coverage and the
 * offset copies (`SELECTION_GHOST_OUTLINE`), since no body draws under a ghost to fill its interior.
 */
export class GhostOutlineSprite extends OutlineSprite {
  constructor() {
    super();
    this.selectionEffect = SELECTION_GHOST_OUTLINE;
  }
}

/**
 * An occluder's copy in the occlusion ghosts' depth clip (`SELECTION_COVER`), drawn only inside
 * {@link clip}: the part of the quad on which a ghost tests the depth it writes.
 */
export class CoverSprite extends SelectionSprite {
  /** The drawn part as minX, minY, maxX, maxY in the units of the sprite's own bounds; the whole quad
   *  until {@link setClip} narrows it. */
  readonly clip = new Float32Array([
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
  ]);

  constructor() {
    super();
    this.selectionEffect = SELECTION_COVER;
  }

  /** Compared as stored, so a clip that held still repacks nothing. */
  setClip(minX: number, minY: number, maxX: number, maxY: number): void {
    const clip = this.clip;
    const x0 = Math.fround(minX);
    const y0 = Math.fround(minY);
    const x1 = Math.fround(maxX);
    const y1 = Math.fround(maxY);
    if (clip[0] === x0 && clip[1] === y0 && clip[2] === x1 && clip[3] === y1) return;
    clip[0] = x0;
    clip[1] = y0;
    clip[2] = x1;
    clip[3] = y1;
    this.onViewUpdate();
  }
}

export class SelectionGraphics extends Graphics {
  private effect = 0;
  private depth = 0;
  /** As {@link SelectionSprite.clipDepth}. */
  get clipDepth(): number {
    return this.depth;
  }
  set clipDepth(z: number) {
    if (z === this.depth) return;
    this.depth = z;
    this.onViewUpdate();
  }
  get selectionEffect(): number {
    return this.effect;
  }
  set selectionEffect(amount: number) {
    if (amount === this.effect) return;
    this.effect = amount;
    this.onViewUpdate();
  }
}

export function spriteSelectionEffect(sprite: object | null): number {
  return sprite instanceof SelectionSprite || sprite instanceof SelectionGraphics
    ? sprite.selectionEffect
    : 0;
}

/** The outline quad an element draws, or null for any other element. */
export function outlineOf(sprite: object | null): OutlineSprite | null {
  return sprite instanceof OutlineSprite ? sprite : null;
}

export function spriteNightLit(sprite: object | null): number {
  return sprite instanceof SelectionSprite ? sprite.nightLit : 0;
}

export function spriteBloodEffect(sprite: object | null): number {
  return sprite instanceof SelectionSprite ? sprite.bloodEffect : 0;
}
