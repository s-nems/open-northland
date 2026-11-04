import { Container, Matrix, type ObservablePoint, Texture } from 'pixi.js';
import type { AtlasFrame } from '../../data/sprites/index.js';
import { PalettedSprite } from '../paletted-sprite/index.js';
import { OutlineSprite, SelectionGraphics } from '../selection/sprite-effect.js';
import {
  LIFT_TONE_CODE,
  type SelectionStyle,
  selectionLight,
  type TargetFlash,
  type TargetFlashTone,
  targetFlashLight,
} from '../selection/style.js';
import type { TextureCache } from '../textures/texture-cache.js';
import { worldBatched } from '../world-batch/batcher.js';
import { OUTLINE_DIRECTIONS, SELECTION_STAMP, SELECTION_TONE_BAND } from '../world-batch/shader.js';
import type { PooledEntity } from './pooled-entity.js';

const WHITE = LIFT_TONE_CODE.order;

/** A colour lift packed as the world batch reads it: the tone code times the band plus the amount, 0..1. */
function packLift(amount: number, tone: number): number {
  return amount > 0 ? tone * SELECTION_TONE_BAND + amount : 0;
}

// Artistic choice: a narrow ivory core and a dark outer keyline for changing terrain contrast.
// Draw each pass over the whole body before the next; individual layers must not border one another.
const OUTLINE_PASSES = [
  { radius: 2, colour: 0x14211b },
  { radius: 1.25, colour: undefined },
] as const;
// A pick's target wears a band about twice as wide, so it reads apart from the hover outline; the inner
// core pass fills the corners the eight-direction stamps of the wide one leave open.
const WIDE_OUTLINE_PASSES = [
  { radius: 4.5, colour: 0x14211b },
  { radius: 3.25, colour: undefined },
  { radius: 1.75, colour: undefined },
] as const;

/** Screen px the outline reaches past the body art. */
export const OUTLINE_REACH = Math.max(
  ...[...OUTLINE_PASSES, ...WIDE_OUTLINE_PASSES].map((pass) => pass.radius),
);

/** What one entity's outline was last laid from: an unchanged one is not laid again. */
interface OutlineInputs {
  zoom: number;
  colour: number;
  wide: boolean;
  bodySerial: number;
}

/**
 * Take an outline stamp off the picture without a `visible` flip, which rebuilds the instructions of its
 * band: at zero alpha it repacks in place. A quad lets go of its textures, which may be bakes destroyed
 * while it waits.
 */
function hideStamp(stamp: OutlineSprite | SelectionGraphics): void {
  stamp.alpha = 0;
  if (!(stamp instanceof OutlineSprite)) return;
  if (stamp.texture !== Texture.EMPTY) stamp.texture = Texture.EMPTY;
  stamp.bodyTexture = Texture.EMPTY;
}

/** Outline quads sit behind the complete body, so overlapping layers leave no internal outlines.
 * They use the world batch and the existing atlas alpha, without filters or per-entity render targets. */
export class SelectionEffects {
  private readonly outlines = new Map<PooledEntity, Container<OutlineSprite | SelectionGraphics>>();
  private readonly outlineInputs = new Map<PooledEntity, OutlineInputs>();
  private readonly transform = new Matrix();
  /** Each lit entity's lift, packed by {@link packLift}. */
  private readonly lit = new Map<PooledEntity, number>();

  constructor(private readonly textures: TextureCache) {}

  update(
    pe: PooledEntity,
    style: SelectionStyle | undefined,
    zoom: number,
    seconds: number,
    outlineColour = 0xf2e8c9,
    flash?: TargetFlash,
    /** A pick target's lift towards `markTone`'s colour, under a flash and the selection pulse; a target
     *  also wears the wide outline band. */
    markLift?: number,
    markTone: TargetFlashTone = 'order',
    /** {@link PooledEntity.bindSerial} when the body's sprites stand where the camera last placed them;
     *  absent lays the outline again whatever it was laid from. */
    bodySerial?: number,
  ): void {
    // Nothing selected and nothing left to clear: every drawn entity asks each frame, so skip the
    // two map lookups below.
    if (style === undefined && flash === undefined && this.lit.size === 0 && this.outlines.size === 0) return;
    if (style === 'pulse' || flash !== undefined || markLift !== undefined || this.lit.has(pe)) {
      // A flash outshines the selection pulse while it plays.
      const flashed = flash === undefined ? 0 : targetFlashLight(flash.progress);
      const lift =
        flash !== undefined && flashed > 0
          ? packLift(flashed, LIFT_TONE_CODE[flash.tone])
          : style === 'pulse' || markLift === undefined
            ? packLift(style === 'pulse' ? selectionLight(seconds) : 0, WHITE)
            : packLift(markLift, LIFT_TONE_CODE[markTone]);
      this.light(pe, lift);
      if (lift === 0) this.lit.delete(pe);
      else this.lit.set(pe, lift);
    }
    if (style !== 'outline') {
      this.clearOutline(pe);
      return;
    }
    const wide = markLift !== undefined;
    let outline = this.outlines.get(pe);
    let inputs = this.outlineInputs.get(pe);
    if (outline === undefined || inputs === undefined) {
      outline = new Container<OutlineSprite | SelectionGraphics>();
      this.outlines.set(pe, outline);
      pe.container.addChildAt(outline, 0);
      inputs = { zoom: Number.NaN, colour: Number.NaN, wide, bodySerial: Number.NaN };
      this.outlineInputs.set(pe, inputs);
    } else if (
      bodySerial === inputs.bodySerial &&
      zoom === inputs.zoom &&
      outlineColour === inputs.colour &&
      wide === inputs.wide
    ) {
      return;
    }
    inputs.zoom = zoom;
    inputs.colour = outlineColour;
    inputs.wide = wide;
    inputs.bodySerial = bodySerial ?? Number.NaN;
    let count = 0;
    for (const pass of wide ? WIDE_OUTLINE_PASSES : OUTLINE_PASSES) {
      const reach = pass.radius / zoom;
      const colour = pass.colour ?? outlineColour;
      for (let i = 0; i < pe.sprites.length; i++) {
        const body = pe.sprites[i];
        if (body === undefined || !body.visible || body.alpha === 0 || (!pe.paletted && pe.pickExempt[i]))
          continue;
        if ('glow' in body && body.glow === true) continue;
        const quad = outlineQuadAt(outline, count++);
        if (quad.tint !== colour) quad.tint = colour;
        quad.alpha = body.alpha;
        let texture: Texture;
        if (body instanceof PalettedSprite) {
          const frame = body.frame;
          const source = body.frameSource;
          if (frame === undefined || source === undefined) {
            hideStamp(quad);
            continue;
          }
          texture = this.textures.castSilhouette(source, frame);
          meshFrameTransform(this.transform, body, frame);
        } else {
          texture = body.texture;
          body.updateLocalTransform();
          frameTransform(this.transform, body.localTransform, body.anchor, texture);
        }
        this.place(quad, texture, reach);
      }
      if (pe.placeholder?.visible === true && pe.placeholder.alpha > 0) {
        for (const [dx, dy] of OUTLINE_DIRECTIONS) {
          let stamp = outline.children[count++];
          if (!(stamp instanceof SelectionGraphics)) {
            stamp?.destroy();
            stamp = worldBatched(new SelectionGraphics({ context: pe.placeholder.context }));
            stamp.selectionEffect = SELECTION_STAMP;
            outline.addChildAt(stamp, count - 1);
          }
          if (stamp.tint !== colour) stamp.tint = colour;
          stamp.alpha = pe.placeholder.alpha;
          pe.placeholder.updateLocalTransform();
          this.transform.copyFrom(pe.placeholder.localTransform);
          this.transform.tx += dx * reach;
          this.transform.ty += dy * reach;
          stamp.setFromMatrix(this.transform);
        }
      }
    }
    for (let i = count; i < outline.children.length; i++) {
      const stamp = outline.children[i];
      if (stamp !== undefined) hideStamp(stamp);
    }
  }

  /**
   * Lay `quad` over the body texels {@link transform} places, grown by whole texels past `reach` (outline
   * container units) on every side, and give it the uv step of one unit of reach along each axis. A body
   * texel stands `scale` units or more across, the transform's smaller singular value.
   */
  private place(quad: OutlineSprite, body: Texture, reach: number): void {
    const { a, b, c, d, tx, ty } = this.transform;
    const det = a * d - b * c;
    if (det === 0) {
      hideStamp(quad);
      return;
    }
    const sum = (a * a + b * b + c * c + d * d) / 2;
    const scale = Math.sqrt(sum - Math.sqrt(Math.max(0, sum * sum - det * det)));
    const margin = Math.ceil(reach / scale);
    // A grown view lives as long as its body texture, so the quad's still serves the same body and margin.
    const held = quad.texture;
    if (
      quad.bodyTexture !== body ||
      held.destroyed ||
      held.frame.width !== body.frame.width + 2 * margin ||
      held.frame.height !== body.frame.height + 2 * margin
    ) {
      quad.bodyTexture = body;
      quad.texture = this.textures.grownView(body, margin);
    }
    // The inverse transform takes a reach step to texels; a texel is a fixed uv step on the page.
    const { uvs, frame } = body;
    const uPerTexel = (uvs.x1 - uvs.x0) / frame.width;
    const vPerTexel = (uvs.y3 - uvs.y0) / frame.height;
    const step = reach / det;
    quad.setReach(d * step * uPerTexel, -b * step * vPerTexel, -c * step * uPerTexel, a * step * vPerTexel);
    this.transform.tx = tx - margin * (a + c);
    this.transform.ty = ty - margin * (b + d);
    quad.setFromMatrix(this.transform);
  }

  /** Portrait and map insets borrow the world without its selection emphasis. The outlines go to zero
   *  alpha rather than invisible: Pixi repacks an alpha change in place, where a visibility flip rebuilds
   *  the instructions of every band holding an outline, once to hide and once to show. */
  setVisible(visible: boolean): void {
    const alpha = visible ? 1 : 0;
    for (const outline of this.outlines.values()) outline.alpha = alpha;
    for (const [pe, lift] of this.lit) this.light(pe, visible ? lift : 0);
  }

  private light(pe: PooledEntity, lift: number): void {
    // The paletted shader takes the amount and the tone apart.
    const tone = Math.floor(lift / SELECTION_TONE_BAND);
    const amount = lift - tone * SELECTION_TONE_BAND;
    for (let i = 0; i < pe.sprites.length; i++) {
      const sprite = pe.sprites[i];
      if (sprite === undefined) continue;
      const excluded = (!pe.paletted && pe.pickExempt[i]) || ('glow' in sprite && sprite.glow === true);
      if (sprite instanceof PalettedSprite) sprite.setSelectionLight(excluded ? 0 : amount, tone);
      else sprite.selectionEffect = excluded ? 0 : lift;
    }
    if (pe.placeholder !== undefined) pe.placeholder.selectionEffect = lift;
  }

  clear(pe: PooledEntity): void {
    this.update(pe, undefined, 1, 0);
  }

  private clearOutline(pe: PooledEntity): void {
    const outline = this.outlines.get(pe);
    if (outline === undefined) return;
    outline.destroy({ children: true });
    this.outlines.delete(pe);
    this.outlineInputs.delete(pe);
  }
}

/** The outline quad at `index` among `outline`'s children, minted over whatever stood there. */
function outlineQuadAt(outline: Container<OutlineSprite | SelectionGraphics>, index: number): OutlineSprite {
  const held = outline.children[index];
  if (held instanceof OutlineSprite) return held;
  held?.destroy();
  const quad = worldBatched(new OutlineSprite());
  outline.addChildAt(quad, index);
  return quad;
}

/** `out` set to `local`'s placement of `texture`'s frame texels, from the quad Pixi lays a sprite on. */
function frameTransform(out: Matrix, local: Matrix, anchor: ObservablePoint, texture: Texture): Matrix {
  const { orig, trim, frame } = texture;
  const width = trim?.width ?? orig.width;
  const height = trim?.height ?? orig.height;
  const left = (trim?.x ?? 0) - anchor.x * orig.width;
  const top = (trim?.y ?? 0) - anchor.y * orig.height;
  const sx = width / frame.width;
  const sy = height / frame.height;
  return out.set(
    local.a * sx,
    local.b * sx,
    local.c * sy,
    local.d * sy,
    local.a * left + local.c * top + local.tx,
    local.b * left + local.d * top + local.ty,
  );
}

/**
 * `out` set to the mesh's placement of `frame`'s texels: the frame's tilt about its bottom-centre, then the
 * mesh's `x += shear * y` and art scale, from the frame's authored origin.
 */
function meshFrameTransform(out: Matrix, body: PalettedSprite, frame: AtlasFrame): Matrix {
  const s = body.artScale;
  const shear = body.shear;
  const tilt = frame.tilt ?? 0;
  const cos = Math.cos(tilt);
  const sin = Math.sin(tilt);
  // The texel origin lands at pivot + R(origin - pivot), R turning clockwise with screen y down.
  const pivotX = frame.offsetX + frame.width / 2;
  const pivotY = frame.offsetY + frame.height;
  const fromX = frame.offsetX - pivotX;
  const fromY = frame.offsetY - pivotY;
  const x = pivotX + fromX * cos - fromY * sin;
  const y = pivotY + fromX * sin + fromY * cos;
  return out.set(
    s * (cos + shear * sin),
    s * sin,
    s * (shear * cos - sin),
    s * cos,
    body.artDx + s * (x + shear * y),
    body.artDy + s * y,
  );
}
