import { type Application, Container, Graphics, Sprite, Text } from 'pixi.js';
import { type Camera, cameraScreenX, cameraScreenY } from '../../data/projection/index.js';
import { lookupFrame } from '../../data/sprites/index.js';
import { PalettedSprite } from '../paletted-sprite/index.js';
import type { PlayerColourLut, SpriteLayer } from '../sprite-sheet.js';
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
 * A data-driven animation gallery: it plays every extracted `[bobseq]` of a body bob set straight from
 * the atlas, so a human can validate that each animation decodes and cycles correctly. A pure viewer -
 * floats and a wall-clock frame counter are fine here because `render` never feeds the sim.
 *
 * A single global {@link GalleryDirection} applies to every cell, so all animations can be flipped to
 * one of the 8 facings or to "full", which plays each whole sequence.
 */

/**
 * One cell to draw: its {@link GalleryClip} plus the layers that compose it. Each cell carries its own
 * layers, so one grid can mix characters or looks - the animation view varies the clip across a shared
 * body and head, the heads montage varies the head overlay across a shared walk clip.
 */
export interface GalleryCellSpec {
  readonly clip: GalleryClip;
  /** The base layer (drawn first). */
  readonly body: SpriteLayer;
  /** Overlay layers drawn on top of the body at the composited head/attachment bob id. */
  readonly overlays?: readonly SpriteLayer[];
  /** Label override for this cell; defaults to {@link GalleryClip.label}. */
  readonly label?: string;
  /**
   * The player-colour row (0-based) this cell draws in paletted mode, ignored otherwise. The colours
   * montage varies it per cell; a single-colour view sets the same row on every cell.
   */
  readonly player?: number;
}

/** The LUT a paletted gallery reads; see {@link PlayerColourLut} for the rows. */
export type GalleryPalette = Pick<PlayerColourLut, 'source' | 'colours' | 'headRow'>;

/** One cell's retained display objects (built once, textures swapped per frame). */
interface GalleryCell {
  readonly clip: GalleryClip;
  readonly container: Container;
  /** This cell's own layers in draw order: index 0 is the body, the rest are overlays. */
  readonly layers: readonly SpriteLayer[];
  /** One sprite per layer, in the same order. */
  readonly sprites: readonly (Sprite | PalettedSprite)[];
  /** The player-colour row this cell draws in paletted mode; 0 otherwise. */
  readonly player: number;
}

/**
 * A retained Pixi view of the whole gallery: the grid is built once, and {@link update} only swaps
 * each cell's frame texture and applies the camera, with no per-frame allocation.
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
  private readonly palette: GalleryPalette | undefined;

  constructor(
    app: Application,
    opts: {
      readonly cells: readonly GalleryCellSpec[];
      readonly columns: number;
      readonly direction?: GalleryDirection;
      /**
       * The player-colour LUT (a `256 × colours` texture) and its row count. When given, every cell
       * draws through it at the cell's {@link GalleryCellSpec.player} row, its head overlays at the
       * head row; absent, cells take the plain baked-texture path.
       */
      readonly palette?: GalleryPalette;
    },
  ) {
    this.app = app;
    this.columns = Math.max(1, Math.floor(opts.columns));
    this.direction = opts.direction ?? 'full';
    this.cellCount = opts.cells.length;
    this.palette = opts.palette;
    app.stage.addChild(this.root);

    // The feet anchor sits at the cell's horizontal centre, FOOT_INSET_Y up from its bottom, and each
    // layer's frame offset lifts the art from there - the feet-anchored placement a settler uses. The
    // cell's top-left in the container's local space is therefore constant.
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
      // Wrap the label to the cell width so a long name stays inside its cell.
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

  /** The pixel size of the whole grid (so the app can frame it with an initial camera). */
  contentSize(): { readonly width: number; readonly height: number } {
    const rows = Math.max(1, Math.ceil(this.cellCount / this.columns));
    return { width: this.columns * CELL_W, height: rows * CELL_H };
  }

  /**
   * Draw one frame: apply the camera to the grid root, then swap each cell's frame textures for the
   * current `clock` and direction. `clock` is a monotonically rising view-frame counter, and may be
   * fractional because the app scales it by `?speed`.
   */
  update(clock: number, camera: Camera): void {
    this.root.scale.set(camera.scale ?? 1);
    this.root.position.set(camera.offsetX, camera.offsetY);
    // Hold each animation frame for TICKS_PER_FRAME view frames.
    const step = Math.floor(clock / TICKS_PER_FRAME);
    // A custom-shader mesh cannot ride the scene-graph transform, so paletted meshes position
    // themselves in screen space and must mirror the camera the retained Sprites get from `root`.
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
        // Layer 0 is the body; head overlays may borrow another sequence's head bob.
        const bob = i === 0 ? bodyBob : headBobId(cell.clip, bodyBob);
        const frame = lookupFrame(layer.atlas, bob);
        if (frame === null) {
          spr.visible = false;
          continue;
        }
        const palette = this.palette;
        if (spr instanceof PalettedSprite && palette !== undefined) {
          spr.setFrame(layer.source, frame, layer.atlas.width, layer.atlas.height);
          spr.place(originX, originY, scale, resW, resH);
          spr.player = i === 0 ? cell.player : palette.headRow;
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
