import {
  type Application,
  type Container,
  Geometry,
  Mesh,
  RendererType,
  RenderTarget,
  RenderTexture,
  Shader,
  Texture,
  UniformGroup,
  type WebGLRenderer,
} from 'pixi.js';
import { renderMasked } from '../lighting/night-mask.js';
import { PIXEL_ART_MAGNIFY_GLSL } from '../pixel-art/magnify.js';
import { type GlslProgramSource, glProgramFor } from '../shaders/program-source.js';

/** How the quad reads the frame, as `uUpscale.x`. */
const PRESENT_MODE = { sharp: 0, xbr: 1, direct: 2 } as const;

const VERTEX = `#version 300 es
in vec2 aPosition;
out vec2 vUV;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
uniform vec2 uScreen;
void main(void) {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition * uScreen, 1.0)).xy, 0.0, 1.0);
  vUV = aPosition;
}`;

const FRAGMENT = `#version 300 es
precision highp float;
in vec2 vUV;
out vec4 finalColor;
uniform sampler2D uFrame;
uniform sampler2D uLight;
// The night's lit mask in red, texel for texel with the frame (see lighting/night-mask.ts), filtered
// linearly so a magnified edge blends about as the frame's does.
uniform sampler2D uMask;
// x: a PRESENT_MODE; y: world texels per device pixel.
uniform vec2 uUpscale;
const float PRESENT_XBR = ${PRESENT_MODE.xbr}.0;
const float PRESENT_DIRECT = ${PRESENT_MODE.direct}.0;
// rgb: what a lit texel multiplies by; a: 1 while the night composite is on.
uniform vec4 uLit;
#define MAGNIFY_FETCH(px) texelFetch(uFrame, clamp(px, ivec2(0), textureSize(uFrame, 0) - 1), 0)
${PIXEL_ART_MAGNIFY_GLSL}
void main(void) {
  // The frame is drawn as the canvas is, screen top in its last row.
  vec2 p = vec2(vUV.x, 1.0 - vUV.y) * vec2(textureSize(uFrame, 0));
  vec4 world;
  if (uUpscale.x == PRESENT_DIRECT) {
    world = MAGNIFY_FETCH(ivec2(floor(p)));
  } else if (uUpscale.x == PRESENT_XBR) {
    world = magnifyXbr(p, uUpscale.y);
  } else {
    world = magnifySharp(p, uUpscale.y);
  }
  if (uLit.a < 0.5) {
    finalColor = world;
    return;
  }
  float lit = texture(uMask, vec2(vUV.x, 1.0 - vUV.y)).r;
  vec3 light = mix(texture(uLight, vUV).rgb, uLit.rgb, lit);
  finalColor = vec4(world.rgb * light, 1.0);
}`;

export const OFFSCREEN_WORLD_SOURCE: GlslProgramSource = {
  name: 'offscreen-world',
  vertex: VERTEX,
  fragment: FRAGMENT,
};

/** The stage's black background, which the lit mask clears to as unlit. */
const FRAME_CLEAR: [number, number, number, number] = [0, 0, 0, 1];

type FrameUniforms = UniformGroup & {
  readonly uniforms: {
    readonly uScreen: Float32Array;
    readonly uUpscale: Float32Array;
    readonly uLit: Float32Array;
  };
};

/** The night's composite of a frame: the light map the unlit world multiplies by, and the colour a lit
 *  texel multiplies by instead. */
export interface NightComposite {
  readonly light: Texture;
  readonly lit: readonly [number, number, number];
}

/**
 * The world drawn into a texture and presented by one full-screen quad, while the canvas is denser than
 * the world's `resolution` (a project performance option: the quad magnifies it with the sharp or xBR
 * magnifier) or while a night composite lights it (a project look: see `lighting/scene-light.ts`).
 * Otherwise `scene` stays on the stage and nothing extra draws. The quad takes stage index 0 and `scene`
 * goes back right above it, so `scene` must be the stage's bottom child when this is built: nothing may
 * mount on the stage before the world renderer. The rest of the stage draws natively over the quad.
 *
 * The frame's render target is marked as a root, so Pixi draws into it exactly as into the canvas: the
 * paletted sprites' hand-rolled clip projection and the filters inside the world (the shore waves) agree
 * on one orientation. Verified on pixi.js 8.22 (projection, filter output quad and viewport read `isRoot`;
 * colour attachment does not): re-verify on a Pixi bump.
 */
export class OffscreenWorld {
  private readonly uniforms: FrameUniforms;
  private readonly shader: Shader;
  private readonly present: Mesh<Geometry, Shader>;
  /** Made on the first frame drawn offscreen. */
  private frame: RenderTexture | null = null;
  /** The CSS size {@link frame} was made for: its own width is texels over resolution, which a render
   *  scale such as 1.3 leaves unequal to the screen's. */
  private frameWidth = 0;
  private frameHeight = 0;
  /** The night's lit mask beside {@link frame}, and the target drawing both; made by the first night. */
  private mask: RenderTexture | null = null;
  private masked: RenderTarget | null = null;
  private detached = false;
  /** The scene's children over the world, gathered per night frame. */
  private readonly over: Container[] = [];

  /** `resolution` is the world's texels per CSS pixel on a denser canvas; Infinity never upscales.
   *  `world` is the child of `scene` the night composite lights, and `lit` the render group within it
   *  whose light-bearers write the lit mask; the children over `world` draw without touching it. */
  constructor(
    private readonly app: Application,
    private readonly scene: Container,
    private readonly world: Container,
    private readonly lit: Container,
    private readonly filter: 'sharp' | 'xbr',
    private readonly resolution: number,
  ) {
    this.uniforms = new UniformGroup({
      uScreen: { value: new Float32Array(2), type: 'vec2<f32>' },
      uUpscale: { value: new Float32Array([PRESENT_MODE[filter], 1]), type: 'vec2<f32>' },
      uLit: { value: new Float32Array(4), type: 'vec4<f32>' },
    }) as FrameUniforms;
    this.shader = new Shader({
      glProgram: glProgramFor(OFFSCREEN_WORLD_SOURCE),
      resources: {
        frame: this.uniforms,
        uFrame: Texture.EMPTY.source,
        uLight: Texture.WHITE.source,
        uMask: Texture.EMPTY.source,
      },
    });
    const geometry = new Geometry({
      attributes: { aPosition: { buffer: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), format: 'float32x2' } },
      indexBuffer: new Uint32Array([0, 1, 2, 0, 2, 3]),
    });
    this.present = new Mesh({ geometry, shader: this.shader });
    this.present.label = 'offscreen-world';
    this.present.visible = false;
    app.stage.addChildAt(this.present, 0);
  }

  /** The resolution the world draws at: its own while the canvas is denser, else the canvas's. */
  drawResolution(): number {
    return Math.min(this.resolution, this.app.renderer.resolution);
  }

  /** Render the frame: the world into its texture first while it upscales or composites, then the stage. */
  render(night: NightComposite | null = null): void {
    const renderer = this.app.renderer;
    const dense = renderer.resolution > this.resolution;
    const offscreen = dense || night !== null;
    if (offscreen !== this.detached) this.mount(offscreen);
    if (offscreen) {
      const { width, height } = this.app.screen;
      const resolution = this.drawResolution();
      const frame = this.frameSized(width, height, resolution);
      if (night === null) renderer.render({ container: this.scene, target: frame, clear: true });
      else this.renderLit(frame);
      const u = this.uniforms.uniforms;
      u.uScreen[0] = width;
      u.uScreen[1] = height;
      u.uUpscale[0] = this.presentMode(frame, width, height);
      u.uUpscale[1] = resolution / renderer.resolution;
      if (night === null) {
        u.uLit[3] = 0;
        this.shader.resources.uLight = Texture.WHITE.source;
        this.dropMask();
      } else {
        [u.uLit[0], u.uLit[1], u.uLit[2]] = night.lit;
        u.uLit[3] = 1;
        this.shader.resources.uLight = night.light.source;
      }
      this.uniforms.update();
    }
    this.app.render();
  }

  /** A frame that matches the canvas texel for pixel is read with one fetch: the sharp magnifier's
   *  weights there are 0 and 1. xBR softens edges even at that size, so it keeps its own path. */
  private presentMode(frame: RenderTexture, width: number, height: number): number {
    if (this.filter !== 'sharp') return PRESENT_MODE[this.filter];
    const canvas = this.app.renderer.resolution;
    // The frame's texture drops a fractional texel that a canvas at the same resolution rounds.
    const matches = (texels: number, size: number): boolean =>
      Math.floor(texels) === Math.round(size * canvas);
    return matches(frame.source.pixelWidth, width) && matches(frame.source.pixelHeight, height)
      ? PRESENT_MODE.direct
      : PRESENT_MODE.sharp;
  }

  /** Draw the world with its lit mask, then what `scene` draws over it (the weather, the scene light's
   *  flames, the screen chrome) into the frame alone. */
  private renderLit(frame: RenderTexture): void {
    const renderer = this.app.renderer;
    const over = this.over;
    over.length = 0;
    for (const child of this.scene.children) if (child !== this.world && child.visible) over.push(child);
    for (const child of over) child.visible = false;
    try {
      if (renderer.type === RendererType.WEBGL) {
        const target = this.maskedTarget(frame);
        renderMasked(renderer as WebGLRenderer, this.lit, () =>
          renderer.render({ container: this.scene, target, clear: true, clearColor: FRAME_CLEAR }),
        );
      } else {
        renderer.render({ container: this.scene, target: frame, clear: true });
      }
    } finally {
      for (const child of over) child.visible = true;
    }
    if (over.length === 0) return;
    const shown = this.world.visible;
    this.world.visible = false;
    try {
      renderer.render({ container: this.scene, target: frame, clear: false });
    } finally {
      this.world.visible = shown;
    }
  }

  /** The target drawing `frame` with the lit mask beside it, re-made with the frame. */
  private maskedTarget(frame: RenderTexture): RenderTarget {
    const held = this.masked;
    if (held !== null && held.colorTexture === frame.source) return held;
    this.dropMask();
    const mask = RenderTexture.create({
      width: Math.max(1, this.frameWidth),
      height: Math.max(1, this.frameHeight),
      resolution: frame.source.resolution,
      format: 'r8unorm',
      antialias: false,
    });
    mask.source.scaleMode = 'linear';
    const masked = new RenderTarget({ colorTextures: [frame.source, mask.source], isRoot: true });
    this.mask = mask;
    this.masked = masked;
    this.shader.resources.uMask = mask.source;
    return masked;
  }

  /** Free the lit mask, rebinding the quad first: a source destroyed while still bound makes Pixi warn. */
  private dropMask(): void {
    if (this.mask === null) return;
    this.shader.resources.uMask = Texture.EMPTY.source;
    this.masked?.destroy();
    this.masked = null;
    this.mask.destroy(true);
    this.mask = null;
  }

  destroy(): void {
    this.dropMask();
    const geometry = this.present.geometry;
    this.shader.destroy();
    this.present.destroy();
    geometry.destroy(true);
    this.frame?.destroy(true);
  }

  /** Swap the stage between drawing `scene` itself and drawing its frame. */
  private mount(offscreen: boolean): void {
    this.detached = offscreen;
    this.present.visible = offscreen;
    if (offscreen) {
      this.app.stage.removeChild(this.scene);
      return;
    }
    this.app.stage.addChildAt(this.scene, this.app.stage.getChildIndex(this.present) + 1);
    // A night's frame on a canvas that draws the world natively is not held through the day.
    this.dropMask();
    this.shader.resources.uFrame = Texture.EMPTY.source;
    this.frame?.destroy(true);
    this.frame = null;
  }

  private frameSized(width: number, height: number, resolution: number): RenderTexture {
    const held = this.frame;
    if (
      held !== null &&
      this.frameWidth === width &&
      this.frameHeight === height &&
      held.source.resolution === resolution
    ) {
      return held;
    }
    // Rebind before destroying: a source destroyed while still bound makes Pixi warn.
    this.dropMask();
    const frame = this.makeFrame(width, height, resolution);
    this.frame = frame;
    this.shader.resources.uFrame = frame.source;
    held?.destroy(true);
    return frame;
  }

  private makeFrame(width: number, height: number, resolution: number): RenderTexture {
    this.frameWidth = width;
    this.frameHeight = height;
    const frame = RenderTexture.create({
      width: Math.max(1, width),
      height: Math.max(1, height),
      resolution,
      antialias: false,
    });
    frame.source.scaleMode = 'nearest';
    this.app.renderer.renderTarget.getRenderTarget(frame).isRoot = true;
    return frame;
  }
}
