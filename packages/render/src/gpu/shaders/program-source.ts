import { GlProgram } from 'pixi.js';

/** The WebGL extension that blends with a second fragment output (`SRC1_COLOR` and its kin). */
export const DUAL_SOURCE_BLEND = 'WEBGL_blend_func_extended';

/** A WebGL extension a program needs enabled in its context to compile. */
export type ShaderExtension = typeof DUAL_SOURCE_BLEND;

/** A GL program's two stages as the GLSL the game hands Pixi, before Pixi's own preprocessing. */
export interface GlslProgramSource {
  /** Stable and path-like, `<program>/<variant>` for a generated variant: the shader checks report by
   *  it, and Pixi stamps it into the compiled text. */
  readonly name: string;
  readonly vertex: string;
  readonly fragment: string;
  /** Needed by the program, which no context without it compiles. */
  readonly extension?: ShaderExtension;
}

const VERSION_LINE = '#version 300 es\n';
const EXTENSION_DIRECTIVE = /^[ \t]*#extension[^\n]*\n/gm;

/** GLSL ES 3.00 takes `#extension` only before any other token, while Pixi puts its precision
 *  statements above the source it is given: the directives move back up under the version line. */
function hoistExtensions(text: string): string {
  const directives = text.match(EXTENSION_DIRECTIVE);
  if (directives === null || !text.startsWith(VERSION_LINE)) return text;
  const rest = text.slice(VERSION_LINE.length).replace(EXTENSION_DIRECTIVE, '');
  return `${VERSION_LINE}${directives.map((line) => `${line.trim()}\n`).join('')}${rest}`;
}

/**
 * The one Pixi program for `source` in this process. Pixi numbers repeated program names into the
 * compiled text, so a second instance of the same source would compile as a different program; one
 * instance keeps the text the shader warm-up links and the text the renderer links identical, which is
 * what lets the browser's program cache answer the renderer's link.
 */
export function glProgramFor(source: GlslProgramSource): GlProgram {
  const program = GlProgram.from(source);
  if (source.extension !== undefined) {
    // Pixi compiles the text these fields hold, which its types mark read-only after preprocessing.
    const text = program as { vertex: string; fragment: string };
    text.vertex = hoistExtensions(text.vertex);
    text.fragment = hoistExtensions(text.fragment);
  }
  return program;
}

/** Whether `gl` compiles `source`, enabling its extension there. */
export function supportsProgram(gl: WebGL2RenderingContext, source: GlslProgramSource): boolean {
  return source.extension === undefined || gl.getExtension(source.extension) !== null;
}
