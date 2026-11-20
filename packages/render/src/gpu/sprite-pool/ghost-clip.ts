import { Container, RenderContainer, type Renderer, WebGLRenderer } from 'pixi.js';

/** The painter-depth span the clip spreads over the depth range: above the feet rows of the largest
 *  map's sorted pass, and narrow enough that a 24-bit depth buffer still tells a paint step apart. */
const CLIP_DEPTH_SPAN = 2 ** 17;
/** Every colour channel of a draw buffer. */
const ALL_CHANNELS = 0b1111;

/** The clip-space z of a painter depth: the nearer a sprite paints, the smaller its z. */
export function clipDepthOf(depth: number): number {
  return 1 - 2 * Math.min(1, Math.max(0, depth / CLIP_DEPTH_SPAN));
}

/**
 * The occlusion ghosts' depth clip: the covers draw first and write only depth, each at its painter
 * depth, then a mark draws only where a cover nearer than its unit wrote. So a mark shows on the hidden
 * part of its unit alone, and never on a building the unit stands in front of.
 *
 * Undocumented Pixi behaviour, verified on pixi.js 8.22, re-verify on a bump: the state system applies
 * only the bits that differ between two states, and no 2D state enables the depth test, so the raw depth
 * state set here holds across the batches between the gates. The last gate puts back what Pixi assumes.
 */
export class GhostClip {
  /** The occluder copies, drawn without colour. */
  readonly covers = new Container();
  /** The ghost stamps the covers clip. */
  readonly marks = new Container();
  /** Whether a ghost shows this frame; an idle clip leaves the depth buffer alone. */
  active = false;

  constructor(overlay: Container) {
    overlay.addChild(
      new RenderContainer((renderer) => this.beginCovers(renderer)),
      this.covers,
      new RenderContainer((renderer) => this.beginMarks(renderer)),
      this.marks,
      new RenderContainer((renderer) => this.end(renderer)),
    );
  }

  private beginCovers(renderer: Renderer): void {
    if (!this.active || !(renderer instanceof WebGLRenderer)) return;
    renderer.renderTarget.ensureDepthStencil();
    const gl = renderer.gl;
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    gl.clearDepth(1);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    renderer.colorMask.setMask(0);
  }

  private beginMarks(renderer: Renderer): void {
    if (!this.active || !(renderer instanceof WebGLRenderer)) return;
    const gl = renderer.gl;
    renderer.colorMask.setMask(ALL_CHANNELS);
    gl.depthMask(false);
    gl.depthFunc(gl.GREATER);
  }

  private end(renderer: Renderer): void {
    if (!this.active || !(renderer instanceof WebGLRenderer)) return;
    const gl = renderer.gl;
    gl.disable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
  }
}
