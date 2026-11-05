import { type BLEND_MODES, type Renderer, WebGLRenderer } from 'pixi.js';
import { DUAL_SOURCE_BLEND } from '../shaders/program-source.js';

/** The blend the merged grade and veil draw with: the frame times the second source, plus the first;
 *  alpha is the first source's. Pixi knows it by this name once {@link registerAirBlend} added it. */
export const AIR_BLEND = 'weather-air' as BLEND_MODES;

/** Whether {@link AIR_BLEND} is registered with the renderer's current context. */
export interface AirBlend {
  ready: boolean;
}

const registered = new WeakMap<Renderer, AirBlend>();

/**
 * Adds {@link AIR_BLEND} to `renderer`'s blend modes, again after a restored context; null where the
 * context cannot blend with two sources. Undocumented Pixi behaviour, verified on pixi.js 8.22,
 * re-verify on a bump: the GL state system looks a mesh's blend mode up by name in its protected
 * `blendModesMap`, which it rebuilds on every context change, and a name no advanced blend mode
 * claims draws without a filter.
 */
export function registerAirBlend(renderer: Renderer): AirBlend | null {
  if (!(renderer instanceof WebGLRenderer)) return null;
  const held = registered.get(renderer);
  if (held !== undefined) return held;
  const blend: AirBlend = { ready: false };
  const register = (gl: WebGL2RenderingContext): void => {
    const dual = gl.getExtension(DUAL_SOURCE_BLEND);
    blend.ready = dual !== null;
    if (dual === null) return;
    const modes = (renderer.state as unknown as { blendModesMap: Record<string, number[]> }).blendModesMap;
    modes[AIR_BLEND] = [gl.ONE, dual.SRC1_COLOR_WEBGL, gl.ONE, dual.SRC1_ALPHA_WEBGL];
  };
  register(renderer.gl);
  if (!blend.ready) return null;
  registered.set(renderer, blend);
  // Added after the state system's own listener, so it runs once the map is rebuilt.
  renderer.runners.contextChange.add({ contextChange: register });
  return blend;
}
