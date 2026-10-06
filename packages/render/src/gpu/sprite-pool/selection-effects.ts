import { Container, Matrix } from 'pixi.js';
import { PalettedSprite } from '../paletted-sprite/index.js';
import { type SelectionStyle, selectionLight } from '../selection-style.js';
import { SelectionGraphics, SelectionSprite } from '../sprite-selection-effect.js';
import type { TextureCache } from '../texture-cache.js';
import { worldBatched } from '../world-batcher.js';
import type { PooledEntity } from './pooled-entity.js';

const DIAGONAL = Math.SQRT1_2;
const OFFSETS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [DIAGONAL, DIAGONAL],
  [-DIAGONAL, DIAGONAL],
  [DIAGONAL, -DIAGONAL],
  [-DIAGONAL, -DIAGONAL],
] as const;

// Artistic choice: a narrow ivory core and a dark outer keyline for changing terrain contrast.
// Draw each pass over the whole body before the next; individual layers must not border one another.
const OUTLINE_PASSES = [
  { radius: 2, colour: 0x14211b },
  { radius: 1.25, colour: undefined },
] as const;

/** Silhouette stamps sit behind the complete body, so overlapping layers leave no internal outlines.
 * They use the world batch and the existing atlas alpha, without filters or per-entity render targets. */
export class SelectionEffects {
  private readonly outlines = new Map<PooledEntity, Container<SelectionSprite | SelectionGraphics>>();
  private readonly transform = new Matrix();
  private readonly lit = new Map<PooledEntity, number>();

  constructor(private readonly textures: TextureCache) {}

  update(
    pe: PooledEntity,
    style: SelectionStyle | undefined,
    zoom: number,
    seconds: number,
    outlineColour = 0xf2e8c9,
  ): void {
    // Nothing selected and nothing left to clear: every drawn entity asks each frame, so skip the
    // two map lookups below.
    if (style === undefined && this.lit.size === 0 && this.outlines.size === 0) return;
    if (style === 'pulse' || this.lit.has(pe)) {
      const light = style === 'pulse' ? selectionLight(seconds) : 0;
      this.light(pe, light);
      if (light === 0) this.lit.delete(pe);
      else this.lit.set(pe, light);
    }
    if (style !== 'outline') {
      this.clearOutline(pe);
      return;
    }
    let outline = this.outlines.get(pe);
    if (outline === undefined) {
      outline = new Container<SelectionSprite | SelectionGraphics>();
      this.outlines.set(pe, outline);
      pe.container.addChildAt(outline, 0);
    }
    let count = 0;
    for (const pass of OUTLINE_PASSES) {
      const { radius } = pass;
      const colour = pass.colour ?? outlineColour;
      for (let i = 0; i < pe.sprites.length; i++) {
        const body = pe.sprites[i];
        if (body === undefined || !body.visible || body.alpha === 0 || (!pe.paletted && pe.pickExempt[i]))
          continue;
        if ('glow' in body && body.glow === true) continue;
        for (const [dx, dy] of OFFSETS) {
          let stamp = outline.children[count++];
          if (!(stamp instanceof SelectionSprite)) {
            stamp?.destroy();
            stamp = worldBatched(new SelectionSprite());
            stamp.selectionEffect = -1;
            outline.addChildAt(stamp, count - 1);
          }
          if (stamp.tint !== colour) stamp.tint = colour;
          stamp.alpha = body.alpha;
          if (body instanceof PalettedSprite) {
            const frame = body.frame;
            const source = body.frameSource;
            if (frame === undefined || source === undefined) {
              stamp.visible = false;
              continue;
            }
            stamp.texture = this.textures.castSilhouette(source, frame);
            stamp.scale.set(body.artScale);
            // Match the mesh's x += shear * y transform, including the frame's authored origin.
            stamp.setFromMatrix(
              this.transform.set(
                body.artScale,
                0,
                body.shear * body.artScale,
                body.artScale,
                body.artDx + (frame.offsetX + body.shear * frame.offsetY) * body.artScale,
                body.artDy + frame.offsetY * body.artScale,
              ),
            );
          } else {
            stamp.texture = body.texture;
            body.updateLocalTransform();
            stamp.setFromMatrix(body.localTransform);
            stamp.anchor.copyFrom(body.anchor);
          }
          stamp.position.x += (dx * radius) / zoom;
          stamp.position.y += (dy * radius) / zoom;
          stamp.visible = true;
        }
      }
      if (pe.placeholder?.visible === true && pe.placeholder.alpha > 0) {
        for (const [dx, dy] of OFFSETS) {
          let stamp = outline.children[count++];
          if (!(stamp instanceof SelectionGraphics)) {
            stamp?.destroy();
            stamp = worldBatched(new SelectionGraphics({ context: pe.placeholder.context }));
            stamp.selectionEffect = -1;
            outline.addChildAt(stamp, count - 1);
          }
          if (stamp.tint !== colour) stamp.tint = colour;
          stamp.alpha = pe.placeholder.alpha;
          pe.placeholder.updateLocalTransform();
          stamp.setFromMatrix(pe.placeholder.localTransform);
          stamp.position.x += (dx * radius) / zoom;
          stamp.position.y += (dy * radius) / zoom;
          stamp.visible = true;
        }
      }
    }
    for (let i = count; i < outline.children.length; i++) {
      const stamp = outline.children[i];
      if (stamp !== undefined) stamp.visible = false;
    }
  }

  /** Portrait and map insets borrow the world without its selection emphasis. */
  setVisible(visible: boolean): void {
    for (const outline of this.outlines.values()) outline.visible = visible;
    for (const [pe, light] of this.lit) this.light(pe, visible ? light : 0);
  }

  private light(pe: PooledEntity, amount: number): void {
    for (let i = 0; i < pe.sprites.length; i++) {
      const sprite = pe.sprites[i];
      if (sprite === undefined) continue;
      const excluded = (!pe.paletted && pe.pickExempt[i]) || ('glow' in sprite && sprite.glow === true);
      const light = excluded ? 0 : amount;
      if (sprite instanceof PalettedSprite) sprite.selectionLight = light;
      else sprite.selectionEffect = light;
    }
    if (pe.placeholder !== undefined) pe.placeholder.selectionEffect = amount;
  }

  clear(pe: PooledEntity): void {
    this.update(pe, undefined, 1, 0);
  }

  private clearOutline(pe: PooledEntity): void {
    const outline = this.outlines.get(pe);
    if (outline === undefined) return;
    outline.destroy({ children: true });
    this.outlines.delete(pe);
  }
}
