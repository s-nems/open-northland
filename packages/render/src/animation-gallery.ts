import {
  type Application,
  Container,
  Graphics,
  Rectangle,
  Sprite,
  Text,
  Texture,
  type TextureSource,
} from 'pixi.js';
import type { Camera, SpriteLayer } from './pixi-renderer.js';
import type { AtlasFrame } from './sprites.js';

/**
 * A DATA-DRIVEN animation gallery — the animation twin of the all-buildings catalog, for the character
 * instead of the map. It plays every extracted `[bobseq]` of a body bob set straight from the atlas, so a
 * human can validate that each animation decodes and cycles correctly. It is a PURE VIEWER: no sim, no
 * determinism concern (floats + a wall-clock frame counter are fine here, `render` never feeds the sim).
 *
 * Why a gallery and not real settlers: the settler binding wires only a handful of the ~69 civilian
 * sequences to sim states (walk/chop/carry), and most (fights, job work, needs, social) map to no atomic.
 * Driving 69 distinct sim states is impractical, so the gallery reads the sequences from the IR and plays
 * each one directly — the only way to see the WHOLE animation set.
 *
 * Layout: a wrapped grid of animated character cells (body + head overlay, like the settler), one cell
 * per clip, each labelled with its animation name. A single global {@link GalleryDirection} applies to
 * every cell so a human can flip all animations to one of the 8 facings (validate direction) or "full"
 * (play each whole sequence). The 8-direction split assumes `dirs = 8, stride = floor(length/8)` — the
 * same convention `sprites.ts` uses for the settler — because the readable data carries NO per-sequence
 * direction count (no oracle; see docs/FIDELITY.md); "full" always plays the true, complete strip so a
 * non-8-directional clip (e.g. eat/sleep) is watchable rather than mis-split.
 */

/** One animation to show: its label + the `[bobseq]` range, its direction count, and its head base. */
export interface GalleryClip {
  readonly label: string;
  readonly start: number;
  readonly length: number;
  /**
   * Facings this clip is laid out for: **8** (a full compass — `length` is a clean ×8, e.g. walk 96) or
   * **1** (single-direction — `length` isn't ×8, e.g. eat 17, wait 57, a jump 21; the original plays these
   * locked to one facing). Derived by {@link clipDirs}. A single-direction clip ignores the facing selector
   * and always plays its whole strip, so a non-directional animation isn't chopped into fake directions.
   */
  readonly dirs: number;
  /**
   * The bob id base to composite the HEAD from (defaults to {@link start} = head id == body id). Some
   * carry-walk variants have EMPTY head bobs (the head is authored once, on the base walk, and reused); for
   * those this points at the base `human_man_generic_walk` start so the head is borrowed at the SAME
   * (direction, frame) offset — the head faces the walk heading while the body carries the load.
   */
  readonly headStart?: number;
}

/** Which facing every cell plays: a facing index `0..7` (the `CR_Hum_Body` block), or the whole strip. */
export type GalleryDirection = number | 'full';

/** The `CR_Hum_Body` 8-direction convention shared with `sprites.ts`/`scene.ts` (no per-seq count in data). */
export const GALLERY_DIRS = 8;

/**
 * Block index (0..7) to draw for each COMPASS step, in order `N, NE, E, SE, S, SW, W, NW` — inverted from
 * the `CR_Hum_Body` facing table (`0 SW, 1 W, 2 NW, 3 NE, 4 E, 5 SE, 6 S, 7 N`; docs/FIDELITY.md). "Full"
 * mode walks this order so the character turns in a clean circle (N→NE→E→…) instead of the jumbled
 * storage order (SW→W→NW→NE→…) — the "ładne kółko" that makes 8 facings easy to verify.
 */
export const COMPASS_TO_BLOCK: readonly number[] = [7, 3, 4, 5, 6, 0, 1, 2];

/**
 * Slow the cadence so a human can actually watch each frame (advance one anim frame every N view frames).
 * At ~60fps this is ~60/N animation fps: `8` ≈ 7.5fps — calm enough to read each pose. The `?speed=` flag
 * scales on top (e.g. `?speed=0.5` halves it again, `?speed=2` doubles), so this is just the default pace.
 */
const TICKS_PER_FRAME = 8;

/** Cell geometry (px, native atlas scale). Tall enough for a standing human bob + its label above it. */
const CELL_W = 112;
const CELL_H = 148;
/** Feet anchor inside a cell: horizontally centred, near the bottom (the bob's authored offset lifts it up). */
const FOOT_INSET_Y = 26;
/** Label baseline from the cell top. */
const LABEL_Y = 6;

/** One cell's grid placement — pure, so the layout is unit-testable without a GPU. */
export interface GalleryCellBox {
  readonly index: number;
  readonly col: number;
  readonly row: number;
  /** Top-left of the cell. */
  readonly x: number;
  readonly y: number;
}

/**
 * Lay `count` cells out row-major into `columns` columns of {@link CELL_W}×{@link CELL_H} — the wrapped
 * grid the gallery draws (the all-buildings catalog's row-major placement, generalised). Pure + total.
 */
export function galleryCellLayout(count: number, columns: number): GalleryCellBox[] {
  const cols = Math.max(1, Math.floor(columns));
  const out: GalleryCellBox[] = [];
  for (let index = 0; index < count; index++) {
    const col = index % cols;
    const row = Math.floor(index / cols);
    out.push({ index, col, row, x: col * CELL_W, y: row * CELL_H });
  }
  return out;
}

/**
 * The direction count a sequence `length` is laid out for: a clean ×8 length is 8-directional, anything
 * else is single-direction (the original plays a non-×8 animation locked to one facing). The readable data
 * carries no explicit per-sequence count (no oracle — docs/FIDELITY.md), so this length heuristic is the
 * best available and matches observation (walk 96 → 8; eat 17 / wait 57 / jump 21 → 1). Pure.
 */
export function clipDirs(length: number): number {
  return length > 0 && length % GALLERY_DIRS === 0 ? GALLERY_DIRS : 1;
}

/**
 * The BODY bob a clip draws at a facing + animation `step` (an integer frame counter; the caller applies
 * the {@link TICKS_PER_FRAME} cadence). Cases:
 *  - **single-direction clip** (`dirs <= 1`) → the whole strip in order, IGNORING the requested facing (a
 *    non-directional animation isn't split into fake directions — fixes clicking a facing on e.g. a jump);
 *  - **8-dir + numeric facing** (a `CR_Hum_Body` block index) → that direction's `stride`-frame sub-cycle;
 *  - **8-dir + `'full'`** → rotate through all directions in COMPASS order ({@link COMPASS_TO_BLOCK}), each
 *    playing its full sub-cycle — a clean turning circle rather than the jumbled storage order.
 * Pure.
 */
export function galleryBobId(clip: GalleryClip, direction: GalleryDirection, step: number): number {
  if (clip.dirs <= 1) return clip.start + (step % Math.max(1, clip.length));
  const stride = Math.floor(clip.length / clip.dirs);
  if (stride <= 0) return clip.start;
  if (direction === 'full') {
    const slot = Math.floor(step / stride) % clip.dirs;
    const block = COMPASS_TO_BLOCK[slot] ?? slot;
    return clip.start + block * stride + (step % stride);
  }
  const block = ((direction % clip.dirs) + clip.dirs) % clip.dirs;
  return clip.start + block * stride + (step % stride);
}

/**
 * The HEAD bob to composite for a given body bob: the same offset into the clip's head base. `headStart`
 * defaults to the body `start` (head id == body id, the usual case); a borrowed head (a carry variant with
 * empty own head → the base walk head) keeps the SAME (direction, frame) offset, so the head faces the walk
 * heading while the body carries the load. Pure.
 */
export function headBobId(clip: GalleryClip, bodyBob: number): number {
  return (clip.headStart ?? clip.start) + (bodyBob - clip.start);
}

/**
 * One cell to draw: its {@link GalleryClip} plus the layers that compose it — a body and any overlays
 * (heads). Each cell carries its OWN layers, so a single grid can mix characters or looks: the
 * animation view gives every cell the same (body, head) and varies the clip; the "heads" montage gives
 * every cell the same walk clip and varies the head overlay. An optional {@link label} overrides the
 * clip's own label (the looks montage labels a cell by its head, not the shared walk).
 */
export interface GalleryCellSpec {
  readonly clip: GalleryClip;
  /** The base layer (drawn first). */
  readonly body: SpriteLayer;
  /** Overlay layers drawn on top of the body at the composited head/attachment bob id (usually one head). */
  readonly overlays?: readonly SpriteLayer[];
  /** Label override for this cell (e.g. a head name in the looks montage); defaults to {@link GalleryClip.label}. */
  readonly label?: string;
}

/** One cell's retained display objects (built once, textures swapped per frame). */
interface GalleryCell {
  readonly clip: GalleryClip;
  readonly container: Container;
  /** This cell's layers in draw order (index 0 = body, rest = overlays) — its OWN, not gallery-shared. */
  readonly layers: readonly SpriteLayer[];
  /** One sprite per layer, in the same order. */
  readonly sprites: Sprite[];
}

/**
 * A retained Pixi view of the whole gallery: the grid is built ONCE (containers, sprites, labels), and
 * {@link update} only swaps each cell's frame texture and applies the camera — no per-frame allocation,
 * the same retained discipline as {@link import('./world-renderer.js').WorldRenderer}.
 */
export class AnimationGallery {
  private readonly app: Application;
  private readonly root = new Container();
  private readonly cells: GalleryCell[] = [];
  private readonly textureCache = new Map<AtlasFrame, Texture>();
  private direction: GalleryDirection;
  private readonly columns: number;
  private readonly cellCount: number;

  constructor(
    app: Application,
    opts: {
      readonly cells: readonly GalleryCellSpec[];
      readonly columns: number;
      readonly direction?: GalleryDirection;
    },
  ) {
    this.app = app;
    this.columns = Math.max(1, Math.floor(opts.columns));
    this.direction = opts.direction ?? 'full';
    this.cellCount = opts.cells.length;
    app.stage.addChild(this.root);

    // The feet anchor sits at the cell's horizontal centre, {@link FOOT_INSET_Y} up from its bottom; each
    // layer's frame offset then lifts the art up from there (the feet-anchored placement WorldRenderer
    // uses for a settler). The cell's own top-left, in the container's local space, is thus constant:
    const localLeft = -CELL_W / 2;
    const localTop = -(CELL_H - FOOT_INSET_Y);
    const boxes = galleryCellLayout(opts.cells.length, this.columns);
    for (const box of boxes) {
      const spec = opts.cells[box.index];
      if (spec === undefined) continue;
      const container = new Container();
      container.position.set(box.x + CELL_W / 2, box.y + CELL_H - FOOT_INSET_Y);
      // A faint cell frame so the grid reads as discrete cells even when a bob is small.
      const frame = new Graphics();
      frame
        .rect(localLeft + 1, localTop + 1, CELL_W - 2, CELL_H - 2)
        .stroke({ color: 0x4a3d2c, width: 1, alpha: 0.6 });
      container.addChild(frame);
      // Wrap the label to the cell width so long names (`generic walk broadsword`) stay inside their cell
      // instead of overrunning the neighbour — the grid must stay readable at a glance.
      const label = new Text({
        text: spec.label ?? spec.clip.label,
        style: {
          fill: 0xe8dcc8,
          fontSize: 10,
          fontFamily: 'ui-monospace,Menlo,monospace',
          wordWrap: true,
          wordWrapWidth: CELL_W - 8,
          align: 'center',
        },
      });
      // Label pinned to the cell top (relative to the feet-anchored container origin).
      label.position.set(localLeft + 4, localTop + LABEL_Y);
      container.addChild(label);
      const layers: readonly SpriteLayer[] = [spec.body, ...(spec.overlays ?? [])];
      const sprites: Sprite[] = [];
      for (let i = 0; i < layers.length; i++) {
        const spr = new Sprite();
        sprites.push(spr);
        container.addChild(spr);
      }
      this.root.addChild(container);
      this.cells.push({ clip: spec.clip, container, layers, sprites });
    }
  }

  /** Set the facing every cell plays (a `0..7` block, or `'full'` for the whole strip). Applied next frame. */
  setDirection(direction: GalleryDirection): void {
    this.direction = direction;
  }

  /** The current direction (for the overlay readout). */
  getDirection(): GalleryDirection {
    return this.direction;
  }

  /** The pixel size of the whole grid (so the app can frame it with an initial camera). */
  contentSize(): { readonly width: number; readonly height: number } {
    const rows = Math.max(1, Math.ceil(this.cellCount / this.columns));
    return { width: this.columns * CELL_W, height: rows * CELL_H };
  }

  /**
   * Draw one frame: apply the camera to the grid root, then swap each cell's frame textures for the
   * current `clock` + direction. `clock` is a monotonically rising counter (a view-frame accumulator; the
   * app scales it by `?speed`, so it may be fractional) — the animation cadence. One `app.render()` at the end.
   */
  update(clock: number, camera: Camera): void {
    this.root.scale.set(camera.scale ?? 1);
    this.root.position.set(camera.offsetX, camera.offsetY);
    // `clock` is a rising view-frame counter; hold each animation frame for TICKS_PER_FRAME of them.
    const step = Math.floor(clock / TICKS_PER_FRAME);
    for (const cell of this.cells) {
      const bodyBob = galleryBobId(cell.clip, this.direction, step);
      for (let i = 0; i < cell.layers.length; i++) {
        const layer = cell.layers[i];
        const spr = cell.sprites[i];
        if (layer === undefined || spr === undefined) continue;
        // Layer 0 is the body; the rest are head overlays, which may borrow another sequence's head bob.
        const bob = i === 0 ? bodyBob : headBobId(cell.clip, bodyBob);
        const frame = layer.atlas.frames.get(bob);
        if (frame === undefined || frame.width === 0 || frame.height === 0) {
          spr.visible = false;
          continue;
        }
        spr.texture = this.textureFor(layer.source, frame);
        spr.position.set(frame.offsetX, frame.offsetY);
        spr.visible = true;
      }
    }
    this.app.render();
  }

  private textureFor(source: TextureSource, frame: AtlasFrame): Texture {
    let tex = this.textureCache.get(frame);
    if (tex === undefined) {
      tex = new Texture({ source, frame: new Rectangle(frame.x, frame.y, frame.width, frame.height) });
      this.textureCache.set(frame, tex);
    }
    return tex;
  }

  /** Tear down the retained graph + texture cache. */
  dispose(): void {
    this.root.destroy({ children: true });
    this.textureCache.clear();
  }
}
