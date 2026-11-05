import { type Renderer, WebGLRenderer } from 'pixi.js';
import { bootShaderPrograms } from './catalog.js';
import { glProgramFor, supportsProgram } from './program-source.js';
import { shaderSelection, type WarmupSettings } from './warmup.js';

/** A catalogue program the renderer linked ahead of its first frame. */
export interface RendererLink {
  readonly name: string;
  /** Wall time of the blocking link: milliseconds from a program cache, seconds of Direct3D compile without. */
  readonly ms: number;
}

/**
 * Links every program `settings` select in the renderer's own context, one per turn so a loading label
 * paints between them. Pixi would otherwise link each inside the first frame that draws with it, which
 * blocks that frame for the whole compile where the warm-up's links did not carry over to this
 * context: always in Firefox, which keeps no linked programs.
 */
export async function linkRendererPrograms(
  renderer: Renderer,
  settings: WarmupSettings,
): Promise<readonly RendererLink[]> {
  if (!(renderer instanceof WebGLRenderer)) return [];
  const programs = bootShaderPrograms(renderer.limits.maxBatchableTextures, shaderSelection(settings)).filter(
    (source) => supportsProgram(renderer.gl, source),
  );
  const links: RendererLink[] = [];
  for (const source of programs) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    // A restored context starts with no programs, so the restore links them afresh.
    if (renderer.gl.isContextLost()) break;
    const startedAt = performance.now();
    // Pixi's internal link entry, the one its first draw calls; `test:boot` fails if an upgrade drops it.
    renderer.shader._getProgramData(glProgramFor(source));
    links.push({ name: source.name, ms: performance.now() - startedAt });
  }
  return links;
}
