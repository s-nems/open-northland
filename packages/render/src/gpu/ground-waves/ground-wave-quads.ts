import {
  Geometry,
  getAdjustedBlendModeBlend,
  RenderContainer,
  Shader,
  State,
  type Texture,
  type TextureSource,
  WebGLRenderer,
} from 'pixi.js';
import { type GlslProgramSource, glProgramFor } from '../shaders/program-source.js';

/**
 * The wave frames of one lift map redraw, drawn as textured quads straight from one buffer. The vertex
 * arithmetic, the triangle order and the vertex stage follow Pixi's sprite batch for a sprite under a
 * scaled, translated parent, so each texel of the map is the one that batch would write.
 */

const VERTEX = `#version 300 es
  in vec2 aPosition;
  in vec2 aUV;
  uniform mat3 uProjectionMatrix;
  uniform mat3 uWorldTransformMatrix;
  out vec2 vUV;
  void main(void) {
    mat3 worldTransformMatrix = uWorldTransformMatrix;
    mat3 modelMatrix = mat3(
      1.0, 0.0, 0.0,
      0.0, 1.0, 0.0,
      0.0, 0.0, 1.0
    );
    vUV = aUV;
    mat3 modelViewProjectionMatrix = uProjectionMatrix * worldTransformMatrix * modelMatrix;
    gl_Position = vec4((modelViewProjectionMatrix * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  }
`;

const FRAGMENT = `#version 300 es
  in vec2 vUV;
  uniform sampler2D uWave;
  out vec4 finalColor;
  void main(void) {
    finalColor = texture(uWave, vUV);
  }
`;

/** The program that draws wave frames into the lift map. */
export const GROUND_WAVE_QUADS_SOURCE: GlslProgramSource = {
  name: 'ground-wave-quads',
  vertex: VERTEX,
  fragment: FRAGMENT,
};

const VERTICES_PER_QUAD = 4;
const FLOATS_PER_VERTEX = 2;
const FLOATS_PER_QUAD = VERTICES_PER_QUAD * FLOATS_PER_VERTEX;
const INDICES_PER_QUAD = 6;
const BYTES_PER_FLOAT = Float32Array.BYTES_PER_ELEMENT;
/** Quads the first buffers hold; they double when a redraw draws more. */
const INITIAL_QUADS = 64;
/** Buffer sets written in turn, for the reason the lift pass keeps three quad geometries. */
const QUAD_GEOMETRIES = 3;

/** Consecutive quads cut from one atlas page: one draw. */
interface QuadRun {
  source: TextureSource;
  start: number;
  quads: number;
}

interface QuadBuffers {
  readonly geometry: Geometry;
  readonly positions: Float32Array;
  readonly uvs: Float32Array;
  readonly capacity: number;
}

function quadBuffers(capacity: number): QuadBuffers {
  const positions = new Float32Array(capacity * FLOATS_PER_QUAD);
  const uvs = new Float32Array(capacity * FLOATS_PER_QUAD);
  const indices = new Uint32Array(capacity * INDICES_PER_QUAD);
  for (let q = 0; q < capacity; q++) {
    const v = q * VERTICES_PER_QUAD;
    indices.set([v, v + 1, v + 2, v, v + 2, v + 3], q * INDICES_PER_QUAD);
  }
  const geometry = new Geometry({
    attributes: {
      aPosition: { buffer: positions, format: 'float32x2' },
      aUV: { buffer: uvs, format: 'float32x2' },
    },
    indexBuffer: indices,
  });
  return { geometry, positions, uvs, capacity };
}

export class GroundWaveQuads {
  /** Draws the quads of the last redraw wherever a render reaches it. */
  readonly node: RenderContainer;
  private readonly buffers: (QuadBuffers | null)[] = Array.from({ length: QUAD_GEOMETRIES }, () => null);
  private turn = 0;
  private current: QuadBuffers | null = null;
  private readonly runs: QuadRun[] = [];
  private runCount = 0;
  private readonly shader: Shader;
  private readonly state = State.for2d();

  constructor(placeholder: TextureSource) {
    this.shader = new Shader({
      glProgram: glProgramFor(GROUND_WAVE_QUADS_SOURCE),
      resources: { uWave: placeholder },
    });
    this.node = new RenderContainer({
      render: (renderer) => {
        if (renderer instanceof WebGLRenderer) this.draw(renderer);
      },
    });
  }

  /**
   * Redraw from `count` frames: `textures[i]` with its top-left corner at `corners[2i], corners[2i + 1]`,
   * each scaled by `scale` about the origin and then moved by the offset, as a parent container of that
   * scale and position would place its sprites. A later frame draws over the earlier ones.
   */
  set(
    count: number,
    textures: readonly Texture[],
    corners: Float64Array,
    scale: number,
    offsetX: number,
    offsetY: number,
  ): void {
    this.turn = (this.turn + 1) % QUAD_GEOMETRIES;
    let buffers = this.buffers[this.turn] ?? null;
    if (buffers === null || count > buffers.capacity) {
      const capacity = Math.max(INITIAL_QUADS, (buffers?.capacity ?? 0) * 2, count);
      buffers?.geometry.destroy(true);
      buffers = quadBuffers(capacity);
      this.buffers[this.turn] = buffers;
    }
    this.current = buffers;
    this.runCount = 0;
    const { positions, uvs } = buffers;
    let quads = 0;
    let run: QuadRun | undefined;
    for (let i = 0; i < count; i++) {
      const texture = textures[i];
      if (texture === undefined) continue;
      // A sprite under the parent: the parent's matrix applied to the sprite's own corner, then the
      // scaled frame size added, in the order Pixi's group transform and quad packing take them.
      const x0 = (corners[i * 2] ?? 0) * scale + offsetX;
      const y0 = (corners[i * 2 + 1] ?? 0) * scale + offsetY;
      const x1 = scale * texture.orig.width + x0;
      const y1 = scale * texture.orig.height + y0;
      const at = quads * FLOATS_PER_QUAD;
      positions[at] = x0;
      positions[at + 1] = y0;
      positions[at + 2] = x1;
      positions[at + 3] = y0;
      positions[at + 4] = x1;
      positions[at + 5] = y1;
      positions[at + 6] = x0;
      positions[at + 7] = y1;
      const frame = texture.uvs;
      uvs[at] = frame.x0;
      uvs[at + 1] = frame.y0;
      uvs[at + 2] = frame.x1;
      uvs[at + 3] = frame.y1;
      uvs[at + 4] = frame.x2;
      uvs[at + 5] = frame.y2;
      uvs[at + 6] = frame.x3;
      uvs[at + 7] = frame.y3;
      if (run === undefined || run.source !== texture.source) run = this.openRun(texture.source, quads);
      run.quads++;
      quads++;
    }
    const written = quads * FLOATS_PER_QUAD * BYTES_PER_FLOAT;
    buffers.geometry.getBuffer('aPosition').update(written);
    buffers.geometry.getBuffer('aUV').update(written);
  }

  /** The next run, empty, starting at quad `start`; run records are reused across redraws. */
  private openRun(source: TextureSource, start: number): QuadRun {
    let run = this.runs[this.runCount];
    if (run === undefined) {
      run = { source, start, quads: 0 };
      this.runs.push(run);
    } else {
      run.source = source;
      run.start = start;
      run.quads = 0;
    }
    this.runCount++;
    return run;
  }

  destroy(): void {
    this.node.destroy();
    this.shader.destroy();
    for (const buffers of this.buffers) buffers?.geometry.destroy(true);
    this.buffers.fill(null);
    this.current = null;
    this.runs.length = 0;
    this.runCount = 0;
  }

  private draw(renderer: WebGLRenderer): void {
    const geometry = this.current?.geometry;
    if (geometry === undefined) return;
    this.shader.groups[100] = renderer.globalUniforms.bindGroup;
    for (let i = 0; i < this.runCount; i++) {
      const run = this.runs[i];
      if (run === undefined) continue;
      this.shader.resources.uWave = run.source;
      // A page loaded with straight alpha blends as Pixi's batch would blend its sprites.
      this.state.blendMode = getAdjustedBlendModeBlend('normal', run.source);
      renderer.encoder.draw({
        geometry,
        shader: this.shader,
        state: this.state,
        start: run.start * INDICES_PER_QUAD,
        size: run.quads * INDICES_PER_QUAD,
      });
    }
  }
}
