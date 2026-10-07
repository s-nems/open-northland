import { GlProgram } from 'pixi.js';

/** A GL program's two stages as the GLSL the game hands Pixi, before Pixi's own preprocessing. */
export interface GlslProgramSource {
  /** Stable and path-like, `<program>/<variant>` for a generated variant: the shader checks report by
   *  it, and Pixi stamps it into the compiled text. */
  readonly name: string;
  readonly vertex: string;
  readonly fragment: string;
}

/**
 * The one Pixi program for `source` in this process. Pixi numbers repeated program names into the
 * compiled text, so a second instance of the same source would compile as a different program; one
 * instance keeps the text the shader warm-up links and the text the renderer links identical, which is
 * what lets the browser's program cache answer the renderer's link.
 */
export function glProgramFor(source: GlslProgramSource): GlProgram {
  return GlProgram.from(source);
}
