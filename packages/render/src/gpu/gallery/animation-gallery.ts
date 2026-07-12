import { type Application, Container, Graphics, Sprite, Text, type TextureSource } from 'pixi.js';
import { type Camera, cameraScreenX, cameraScreenY } from '../../data/iso.js';
import { lookupFrame } from '../../data/sprites/index.js';
import { PalettedSprite } from '../paletted-sprite.js';
import type { SpriteLayer } from '../pixi-app.js';
import { TextureCache } from '../texture-cache.js';
import {
  CELL_H,
  CELL_W,
  FOOT_INSET_Y,
  type GalleryClip,
  type GalleryDirection,
  galleryBobId,
  galleryCellLayout,
  headBobId,
  LABEL_Y,
  TICKS_PER_FRAME,
} from './layout.js';

/**
 * A DATA-DRIVEN animation gallery — the animation twin of the sandbox/catalog, for the character
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
 * same convention the sprite bindings use for the settler — because the readable data carries NO
 * per-sequence direction count (no oracle; see source basis); "full" always plays the true, complete
 * strip so a non-8-directional clip (e.g. eat/sleep) is watchable rather than mis-split.
 */

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
  /**
   * The player-colour row (0-based) this cell draws when the gallery is in **paletted** mode (a `palette`
   * was passed to the {@link AnimationGallery}). Ignored otherwise. Defaults to 0. The colours montage
   * varies this per cell (same look, one cell per player colour); a single-colour view sets it on every cell.
   */
  readonly player?: number;
}

/** One cell's retained display objects (built once, textures swapped per frame). */
interface GalleryCell {
  readonly clip: GalleryClip;
  readonly container: Container;
  /** This cell's layers in draw order (index 0 = body, rest = overlays) — its OWN, not gallery-shared. */
  readonly layers: readonly SpriteLayer[];
  /** One sprite per layer, in the same order — plain {@link Sprite}s, or {@link PalettedSprite}s in paletted mode. */
  readonly sprites: (Sprite | PalettedSprite)[];
  /** The player-colour row this cell draws (paletted mode only); 0 otherwise. */
  readonly player: number;
}

/**
 * A retained Pixi view of the whole gallery: the grid is built ONCE (containers, sprites, labels), and
 * {@link update} only swaps each cell's frame texture and applies the camera — no per-frame allocation,
 * the same retained discipline as {@link import('../world-renderer.js').WorldRenderer}.
 */
export class AnimationGallery {
  private readonly app: Application;
  private readonly root = new Container();
  private readonly cells: GalleryCell[] = [];
  private readonly textures = new TextureCache();
  private direction: GalleryDirection;
  private readonly columns: number;
  private readonly cellCount: number;
  /** When set, cells draw through the player-colour LUT ({@link PalettedSprite}) instead of baked textures. */
  private readonly palette: { readonly source: TextureSource; readonly colours: number } | undefined;

  constructor(
    app: Application,
    opts: {
      readonly cells: readonly GalleryCellSpec[];
      readonly columns: number;
      readonly direction?: GalleryDirection;
      /**
       * The player-colour LUT (a `256 × colours` texture) + its row count. When given, every cell draws
       * through it via {@link PalettedSprite} at the cell's {@link GalleryCellSpec.player} row — the 16
       * player colours the atlas indices are read through. Absent → the plain baked-texture path.
       */
      readonly palette?: { readonly source: TextureSource; readonly colours: number };
    },
  ) {
    this.app = app;
    this.columns = Math.max(1, Math.floor(opts.columns));
    this.direction = opts.direction ?? 'full';
    this.cellCount = opts.cells.length;
    this.palette = opts.palette;
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
      const sprites: (Sprite | PalettedSprite)[] = [];
      for (let i = 0; i < layers.length; i++) {
        const spr =
          this.palette !== undefined
            ? new PalettedSprite(this.palette.source, this.palette.colours)
            : new Sprite();
        sprites.push(spr);
        container.addChild(spr);
      }
      this.root.addChild(container);
      this.cells.push({ clip: spec.clip, container, layers, sprites, player: spec.player ?? 0 });
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
    // Paletted meshes position themselves in screen space (a custom-shader mesh can't ride the scene-graph
    // transform), so mirror the camera the retained Sprites get from `root`: feet anchor = camera applied to
    // the cell container's local position; scale = camera zoom.
    const scale = camera.scale ?? 1;
    const resW = this.app.screen.width;
    const resH = this.app.screen.height;
    for (const cell of this.cells) {
      const bodyBob = galleryBobId(cell.clip, this.direction, step);
      const originX = cameraScreenX(camera, cell.container.position.x);
      const originY = cameraScreenY(camera, cell.container.position.y);
      for (let i = 0; i < cell.layers.length; i++) {
        const layer = cell.layers[i];
        const spr = cell.sprites[i];
        if (layer === undefined || spr === undefined) continue;
        // Layer 0 is the body; the rest are head overlays, which may borrow another sequence's head bob.
        const bob = i === 0 ? bodyBob : headBobId(cell.clip, bodyBob);
        const frame = lookupFrame(layer.atlas, bob);
        if (frame === null) {
          spr.visible = false;
          continue;
        }
        if (spr instanceof PalettedSprite) {
          // Indexed atlas read through the LUT at this cell's player row — the palette drives the colour.
          spr.setFrame(layer.source, frame, layer.atlas.width, layer.atlas.height);
          spr.place(originX, originY, scale, resW, resH);
          spr.player = cell.player;
        } else {
          spr.texture = this.textures.get(layer.source, frame);
          spr.position.set(frame.offsetX, frame.offsetY);
        }
        spr.visible = true;
      }
    }
    this.app.render();
  }

  /** Tear down the retained graph + texture cache. */
  dispose(): void {
    this.root.destroy({ children: true });
    this.textures.clear();
  }
}
