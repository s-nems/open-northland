import { Mesh, MeshGeometry, Shader, Sprite, type Texture, UniformGroup } from 'pixi.js';
import { clamp01 } from '../../data/math.js';
import type { DamageAtlas, DamageTile } from '../building-damage/atlas.js';
import { isMagnifiedTexture, pixelArtMagnifyMode } from '../pixel-art-registry.js';
import { glProgramFor } from '../program-source.js';
import { worldBatched } from '../world-batcher.js';
import { DISMANTLE_SOURCE } from './dismantle-shader.js';

interface DismantleAppearance {
  readonly introduced: boolean;
  readonly shade: number;
  readonly alpha: number;
  readonly bake?: Texture;
}

/** One static quad; only four scalar uniforms change while construction unwinds. A full mask atlas
 * falls back to a stationary fade, retaining the last visible pixels and the same lifetime. */
export class DismantleBody {
  readonly display: Mesh<MeshGeometry, Shader> | Sprite;
  private readonly mask: DamageTile | null;
  private readonly values = new Float32Array([0, 0, 1, 1]);
  private readonly uniforms: UniformGroup | undefined;

  constructor(
    private readonly view: Texture,
    removal: Uint8ClampedArray,
    private readonly atlas: DamageAtlas,
    private readonly appearance: DismantleAppearance,
  ) {
    const { width, height } = view;
    this.mask = atlas.allocate(width, height, view);
    if (this.mask === null) {
      this.display = worldBatched(new Sprite(view));
      return;
    }
    atlas.write(this.mask, removal, width, height);
    this.uniforms = new UniformGroup({
      uFrame: { value: new Float32Array([view.frame.x, view.frame.y, width, height]), type: 'vec4<f32>' },
      uMaskOrigin: {
        value: new Float32Array([this.mask.texture.frame.x, this.mask.texture.frame.y]),
        type: 'vec2<f32>',
      },
      uDismantle: { value: this.values, type: 'vec4<f32>' },
    });
    const shader = new Shader({
      glProgram: glProgramFor(DISMANTLE_SOURCE),
      resources: { uTexture: view.source, uRemoval: this.mask.texture.source, dismantle: this.uniforms },
    });
    const geometry = new MeshGeometry({
      positions: new Float32Array([0, 0, width, 0, width, height, 0, height]),
      uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
      indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    });
    this.display = new Mesh({ geometry, shader, texture: view });
  }

  pose(progress: number): void {
    this.display.visible = progress < 1;
    const appearance = this.appearance.introduced ? clamp01(progress / 0.09) : 1;
    if (this.uniforms === undefined) {
      this.display.alpha = this.appearance.alpha * appearance * clamp01((1 - progress) / 0.8);
      return;
    }
    this.values[0] = progress;
    const magnifier = isMagnifiedTexture(this.view) ? pixelArtMagnifyMode() : 0;
    this.values[1] = magnifier || (this.view.source.scaleMode === 'linear' ? 1 : 0);
    this.values[2] = appearance;
    this.values[3] = this.appearance.shade;
    this.uniforms.update();
  }

  destroy(): void {
    if (this.display instanceof Mesh) {
      this.display.geometry.destroy(true);
      this.display.shader?.destroy();
    }
    this.display.destroy();
    this.view.destroy();
    this.appearance.bake?.destroy(true);
    if (this.mask !== null) this.atlas.release(this.mask);
  }
}
