/** A GL program's two stages as the GLSL the game hands Pixi, before Pixi's own preprocessing. */
export interface GlslProgramSource {
  readonly vertex: string;
  readonly fragment: string;
}
